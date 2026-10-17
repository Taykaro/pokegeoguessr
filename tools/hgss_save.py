"""Lecture / édition minimale d'une sauvegarde Pokémon HeartGold/SoulSilver (.sav).

Format repris de PKHeX (SAV4HGSS / PK4) :
- 2 partitions de 0x40000 ; dans chacune, bloc « général » (0xF628 octets, à 0)
  et bloc « stockage » (0x12310 octets, à 0xF700). La copie la plus récente
  de chaque bloc se lit aux compteurs placés 0x14 octets avant la fin du bloc.
- Somme de contrôle d'un bloc = CRC16-CCITT de tout le bloc sauf le pied de
  0x10 octets, écrite dans ses 2 derniers octets.
- Équipe : nombre à général+0x94, Pokémon à général+0x98 (6 x 236 octets).
  Boîtes : stockage + boîte*0x1000 + case*136.
- Pokémon (PK4) : PID, somme de contrôle, 4 blocs de 32 octets mélangés selon
  le PID et chiffrés (PRNG amorcé par la somme de contrôle) ; en équipe, 100
  octets de stats de combat chiffrés avec le PID.

Usage :
  python tools/hgss_save.py lister <save.sav>
  python tools/hgss_save.py echanger <save.sav> <sortie.sav> <case_equipe> <boite> <case_boite>
    (numéros à partir de 1 ; met le Pokémon de la boîte dans l'équipe et inversement)
"""
import struct
import sys

PART = 0x40000
GEN_SIZE, STO_START, STO_SIZE = 0xF628, 0xF700, 0x12310
PARTY_COUNT, PARTY_OFS, PARTY_SIZE, STORED_SIZE = 0x94, 0x98, 236, 136
BOX_COUNT, BOX_SLOTS, BOX_STRIDE = 18, 30, 0x1000
ORDERS = ["ABCD", "ABDC", "ACBD", "ACDB", "ADBC", "ADCB", "BACD", "BADC", "BCAD", "BCDA", "BDAC", "BDCA",
          "CABD", "CADB", "CBAD", "CBDA", "CDAB", "CDBA", "DABC", "DACB", "DBAC", "DBCA", "DCAB", "DCBA"]
NATURE_MOD = {  # nature -> (stat augmentée, stat diminuée), index 1=Atq 2=Déf 3=Vit 4=AtqSp 5=DéfSp
    1: (1, 2), 2: (1, 3), 3: (1, 4), 4: (1, 5), 5: (2, 1), 7: (2, 3), 8: (2, 4), 9: (2, 5), 10: (3, 1), 11: (3, 2),
    13: (3, 4), 14: (3, 5), 15: (4, 1), 16: (4, 2), 17: (4, 3), 19: (4, 5), 20: (5, 1), 21: (5, 2), 22: (5, 3), 23: (5, 4)}
ARCEUS = 493


def crc16_ccitt(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if crc & 0x8000 else (crc << 1)
            crc &= 0xFFFF
    return crc


def newer(b, end_ofs):
    """0 si la partition 1 a la copie la plus récente du bloc, sinon 1 (logique PKHeX)."""
    o1 = end_ofs - 0x14
    o2 = o1 + PART
    for k in (0, 4):
        c1, c2 = struct.unpack_from("<I", b, o1 + k)[0], struct.unpack_from("<I", b, o2 + k)[0]
        if c1 == 0xFFFFFFFF and c2 != 0xFFFFFFFE:
            return 1
        if c2 == 0xFFFFFFFF and c1 != 0xFFFFFFFE:
            return 0
        if c1 != c2:
            return 0 if c1 > c2 else 1
    return 0


def prng_xor(data, seed):
    out = bytearray(data)
    for i in range(0, len(out), 2):
        seed = (0x41C64E6D * seed + 0x6073) & 0xFFFFFFFF
        w = struct.unpack_from("<H", out, i)[0] ^ (seed >> 16)
        struct.pack_into("<H", out, i, w)
    return out


def decrypt(raw):
    """Pokémon chiffré (136 ou 236 octets) -> données en clair, blocs remis dans l'ordre A,B,C,D."""
    pid, _, chk = struct.unpack_from("<IHH", raw, 0)
    blocks = prng_xor(raw[8:136], chk)
    order = ORDERS[((pid & 0x3E000) >> 13) % 24]
    plain = bytearray(raw[:8]) + bytearray(128)
    for pos, letter in enumerate(order):
        dst = "ABCD".index(letter)
        plain[8 + dst * 32: 8 + dst * 32 + 32] = blocks[pos * 32: pos * 32 + 32]
    if len(raw) > 136:
        plain += prng_xor(raw[136:], pid)
    return plain


def encrypt(plain):
    """Inverse de decrypt (recalcule la somme de contrôle des blocs)."""
    pid = struct.unpack_from("<I", plain, 0)[0]
    chk = sum(struct.unpack_from("<64H", plain, 8)) & 0xFFFF
    order = ORDERS[((pid & 0x3E000) >> 13) % 24]
    shuffled = bytearray(128)
    for pos, letter in enumerate(order):
        src = "ABCD".index(letter)
        shuffled[pos * 32: pos * 32 + 32] = plain[8 + src * 32: 8 + src * 32 + 32]
    out = bytearray(plain[:8])
    struct.pack_into("<H", out, 6, chk)
    out += prng_xor(shuffled, chk)
    if len(plain) > 136:
        out += prng_xor(plain[136:], pid)
    return out


def info(plain):
    pid = struct.unpack_from("<I", plain, 0)[0]
    species, item, tid, sid, exp = struct.unpack_from("<HHHHI", plain, 0x08)
    ivs = struct.unpack_from("<I", plain, 0x38)[0]
    shiny = ((tid ^ sid ^ (pid >> 16) ^ (pid & 0xFFFF)) < 8)
    return {
        "espece": species, "pid": pid, "exp": exp, "dresseur": tid, "secret": sid,
        "shiny": shiny, "fatidique": bool(plain[0x40] & 1), "nature": pid % 25,
        "ivs": [(ivs >> (5 * i)) & 31 for i in range(6)], "evs": list(plain[0x18:0x1E]),
        "checksum_ok": (sum(struct.unpack_from("<64H", plain, 8)) & 0xFFFF) == struct.unpack_from("<H", plain, 6)[0],
        "niveau": plain[0x8C] if len(plain) > 136 else None,
    }


def level_from_exp(exp):
    """Arceus = croissance lente : exp(n) = 5n³/4."""
    lvl = 1
    while lvl < 100 and 5 * (lvl + 1) ** 3 // 4 <= exp:
        lvl += 1
    return lvl


def party_stats(plain, base=120):
    """Stats de combat d'un Arceus (stats de base toutes à 120), formule de 4e génération."""
    i = info(plain)
    lvl = level_from_exp(i["exp"])
    ivs, evs = i["ivs"], i["evs"]  # ordre PV, Atq, Déf, Vit, AtqSp, DéfSp (IV) ; EV : PV, Atq, Déf, Vit, AtqSp, DéfSp
    hp = (2 * base + ivs[0] + evs[0] // 4) * lvl // 100 + lvl + 10
    others = []
    up, down = NATURE_MOD.get(i["nature"], (0, 0))
    for s in range(1, 6):
        v = (2 * base + ivs[s] + evs[s] // 4) * lvl // 100 + 5
        if s == up:
            v = v * 110 // 100
        elif s == down:
            v = v * 90 // 100
        others.append(v)
    atk, df, spe, spa, spd = others
    stats = bytearray(100)
    stats[4] = lvl
    struct.pack_into("<7H", stats, 6, hp, hp, atk, df, spe, spa, spd)
    return stats


class Save:
    def __init__(self, path):
        self.b = bytearray(open(path, "rb").read())
        self.gen = newer(self.b, GEN_SIZE) * PART
        self.sto = newer(self.b, STO_START + STO_SIZE) * PART + STO_START

    def block_ok(self, start, size):
        stored = struct.unpack_from("<H", self.b, start + size - 2)[0]
        return crc16_ccitt(self.b[start: start + size - 0x10]) == stored

    def fix_checksums(self):
        for start, size in ((self.gen, GEN_SIZE), (self.sto, STO_SIZE)):
            struct.pack_into("<H", self.b, start + size - 2, crc16_ccitt(self.b[start: start + size - 0x10]))

    def party_ofs(self, slot):
        return self.gen + PARTY_OFS + slot * PARTY_SIZE

    def box_ofs(self, box, slot):
        return self.sto + box * BOX_STRIDE + slot * STORED_SIZE

    def party(self):
        n = self.b[self.gen + PARTY_COUNT]
        return [decrypt(self.b[self.party_ofs(i): self.party_ofs(i) + PARTY_SIZE]) for i in range(n)]

    def boxes(self):
        for box in range(BOX_COUNT):
            for slot in range(BOX_SLOTS):
                raw = self.b[self.box_ofs(box, slot): self.box_ofs(box, slot) + STORED_SIZE]
                if raw[:4] == b"\0\0\0\0" and raw[6:8] == b"\0\0":
                    continue
                yield box, slot, decrypt(raw)


def lister(path):
    s = Save(path)
    print(f"bloc général partition {s.gen // PART + 1} (CRC ok: {s.block_ok(s.gen, GEN_SIZE)}), "
          f"stockage partition {(s.sto - STO_START) // PART + 1} (CRC ok: {s.block_ok(s.sto, STO_SIZE)})")
    for i, p in enumerate(s.party()):
        d = info(p)
        tag = " <- ARCEUS" if d["espece"] == ARCEUS else ""
        print(f"équipe {i + 1}: espèce {d['espece']} niv {d['niveau']} shiny={d['shiny']} fatidique={d['fatidique']}{tag}")
    for box, slot, p in s.boxes():
        d = info(p)
        if d["espece"] == ARCEUS:
            print(f"boîte {box + 1} case {slot + 1}: ARCEUS niv~{level_from_exp(d['exp'])} shiny={d['shiny']} "
                  f"fatidique={d['fatidique']} somme_ok={d['checksum_ok']}")


def echanger(src, dst, party_slot, box, box_slot):
    s = Save(src)
    po, bo = s.party_ofs(party_slot - 1), s.box_ofs(box - 1, box_slot - 1)
    party_raw = bytes(s.b[po: po + PARTY_SIZE])
    box_plain = decrypt(bytes(s.b[bo: bo + STORED_SIZE]))
    assert info(box_plain)["checksum_ok"], "Pokémon de la boîte illisible"
    # Boîte <- partie « stockée » du Pokémon d'équipe (136 premiers octets, déjà chiffrés)
    s.b[bo: bo + STORED_SIZE] = party_raw[:STORED_SIZE]
    # Équipe <- Pokémon de la boîte + stats de combat calculées
    s.b[po: po + PARTY_SIZE] = encrypt(box_plain + party_stats(box_plain))
    s.fix_checksums()
    open(dst, "wb").write(s.b)
    print("échange écrit dans", dst)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "lister":
        lister(sys.argv[2])
    elif cmd == "echanger":
        echanger(sys.argv[2], sys.argv[3], *map(int, sys.argv[4:7]))
