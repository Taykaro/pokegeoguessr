# Portage vers un nouveau jeu (Platine, Noir/Blanc, …)

But de ce doc : **ne rien reperdre**. Tout ce qu'on a trouvé sur SoulSilver/HeartGold
est ici, séparé en **méthode réutilisable** (marche pour n'importe quel jeu DS Pokémon)
et **valeurs spécifiques au jeu** (à re-dériver pour Platine / Noir-Blanc).

Le jeu repose sur 3 briques indépendantes :
1. **Lecture de position/mapID en RAM** (savoir où est le joueur) → calibration navigateur.
2. **Banque de photos** (montrer un lieu) → pipeline de capture par téléport.
3. **Serveur/UI** (déjà générique : `server/`, `public/play.html`).

Seules 1 et 2 demandent du travail par jeu.

---

## 1) Lecture de position + mapID (calibration navigateur)

**Méthode game-agnostique, outils prêts dans `tools/calibrate/` :**

- `find-position.js` — collé dans la console (F12) EN JEU : fait marcher le perso
  tout seul (injection D-pad via `WebMelon._internal.emulatorButtonInput`, le clavier
  ne passe pas depuis la console) et repère par diff mémoire les u16 qui suivent le
  déplacement = **X / Y**.
- `find-mapid.js` — remonte les pointeurs depuis une **valeur connue** (ex. le mapID
  que la version FR affiche) jusqu'à un **global stable**, vérifié après changement de
  map ET après rechargement de page.

**Principes clés (valables pour tous les jeux) :**
- La **base RAM DS** dans le heap WASM = l'offset avec le PLUS de pointeurs vers le
  heap. ⚠️ Le gamecode existe **en double** (ROM chargée en mémoire) → ne jamais
  prendre le 1er match, sinon on lit `0xFFFFFFFF` partout.
- Injecter le mouvement (pas le clavier) pour éviter les soucis de focus.
- Un **global stable entre parties** est dans la **section données basse**
  (~`0x0200xxxx`–`0x020Cxxxx` pour HGSS) ; la zone plus haute (`0x0226xxxx`+) est
  **dynamique et bouge à chaque partie** → ne PAS hardcoder une adresse là-haut.
- Toujours **vérifier la stabilité en rechargeant la page** avant d'intégrer.
- Robustesse en prod : lire **plusieurs pointeurs et voter** (≥2/≥3 d'accord) plutôt
  qu'un seul (cf. `ADDR_EN.mapReaders` / vote dans `readPosCfg` de `play.html`).

**Où ça s'intègre :** `public/play.html`, table `ADDR_BY_CODE` par gamecode.
Chaque entrée = `{ posPtrs, posX, posY, (map… ou mapReaders) }`. Voir `ADDR_DEFAULT`
(FR/EU HGSS) et `ADDR_EN` (anglais HGSS) comme modèles.

**Valeurs SPÉCIFIQUES déjà trouvées (référence, NE marchent que sur HGSS) :**
| Version | gamecode | Position | mapID |
|---|---|---|---|
| SoulSilver/HeartGold FR-EU | IPGF / IPKF | `base=u32[0x020231F8]`, `X=u16[base+2]`, `Y=u16[base-0x0E]` | `u32[u32[u32[0x021D1130]+0x20]]` |
| SoulSilver/HeartGold anglais | IPGE / IPKE | `base=u32[0x020C0120…]` (plusieurs globals, ≥3 d'accord), `X=+0x376`, `Y=+0x366` | via `mapReaders` : `u32[…u32[0x0200B5A0]+0xA74+0xE8+0x34C]` (globals bas 0x0200Bxxx, +replis) |

Pour **Platine / Noir-Blanc** : gamecodes différents (Platine `CPU*`, N/B `IRB*`/`IRA*`),
adresses **toutes différentes** → relancer `find-position.js` puis `find-mapid.js`, et
ajouter une entrée dans `ADDR_BY_CODE`. La **numérotation des maps est identique entre
régions d'un même jeu** (d'où la calibration mapID en comparant FR ↔ anglais au même lieu).

---

## 2) Banque de photos (capture par téléport)

**Ne jamais déplacer le perso à la main** (photos collées aux murs/portes) → on
**téléporte** en patchant les warps directement dans une copie du `.nds` (aucun repack).

**Pipeline (outils dans `tools/` et `bridge/`) :**
1. `tools/extract-walkability.js` + `tools/extract-warps.js` — praticabilité + warps depuis la ROM.
2. `tools/pick-interior-points.js <header> <bank> <N>` — points centraux marchables (dédup, loin des portes).
3. `tools/patch-interior-warps.js` — repointe les warps vers ces coords dans une ROM patchée.
4. Capture Lua BizHawk — recharger un hub, téléporter, entrer, `client.screenshot`
   (implémentations de référence : `bridge/capture-interiors.lua`, `bridge/batch-capture.lua`).
5. `tools/export-captures.js` + `tools/build-photo-pack.js` + `tools/filter-photos.js`
   — recadrer l'écran haut et **indexer dans `gamepacks/<jeu>/pack.json`**.

**Format de sortie** (game-agnostique) : `gamepacks/<jeu>/pack.json` +
`0000.png…` — chaque photo = `{ gx, gy, mapID, interior, zone }`. Le serveur
(`server/pack.js`, `checkWin`) ne dépend pas du jeu : extérieur compare X,Y globaux
(mapID ignoré), intérieur exige `mapID == cible.mapID`.

**PIÈGES transférables (ne pas refaire) :**
- `destMap` d'un warp ≠ index de fichier events : c'est un **ID d'en-tête** ; le vrai
  index est `eventsBank` (+16 dans la `MapHeader`). Confondre = écran vide.
- **Ne PAS toucher aux scripts** d'events (hijack) : régressions non comprises. Se
  limiter au patch `destMap`/`anchor` des warps.
- **Écrire la position en RAM = échec** (lecture seule, le jeu recalcule). D'où le téléport par warp.
- BizHawk remplace les `_` par des espaces dans les noms de fichiers `.SaveRAM`.
- L'émulateur WASM **ne tourne pas** dans le navigateur intégré de Claude ni facilement
  en BizHawk headless pour l'intro tactile → calibrer dans un **vrai navigateur**.

Ces adresses/formats de fichiers (MapHeader, table de Vol, offset `0x020F6BC4`…) sont
**HGSS-spécifiques** ; pour un autre jeu, re-dériver via DSPRE (`RomInfo.cs`) + les repos
de décompilation (`pret/pokeplatinum`, `pret/pokeheartgold`, `pok020`/BW).

---

## Checklist « nouveau jeu »
- [ ] Récupérer la ROM + une save terminée (spawn dans un hub central).
- [ ] `find-position.js` en jeu → X/Y ; `find-mapid.js` (compare 2 lieux connus) → mapID stable.
- [ ] Vérifier la stabilité après **rechargement** de page + prendre plusieurs pointeurs (vote).
- [ ] Ajouter l'entrée `ADDR_BY_CODE[<gamecode>]` dans `public/play.html`.
- [ ] Extraire walkability + warps ; générer les cibles ; capturer par téléport.
- [ ] `build-photo-pack.js` → `gamepacks/<jeu>/pack.json` ; pointer `config.json` dessus.
- [ ] Tester : position suit le perso, extérieurs ET intérieurs se gagnent.
