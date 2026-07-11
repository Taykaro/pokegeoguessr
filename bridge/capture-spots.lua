--[[
  Capture automatique PokéGeoGuessr — 10 points de Bourgeon.
  Technique : détournement de TOUTES les lignes de la table de Vol ARM9
  (0x020F9E64, 30 lignes de 18 octets) -> quelle que soit la ville sur laquelle
  le curseur de la carte de Vol se trouve, A->A vole vers la cible injectée.
  Aucune navigation D-pad nécessaire (c'était le point fragile).
]]

local SP = "C:/Users/tayka/AppData/Local/Temp/claude/C--Users-tayka-Documents-Project-Taykaro-INC/01ebbd3d-3303-4489-a26f-4de6d0ff2046/scratchpad"
local LOG = SP .. "/captures/log.txt"
local HUB = SP .. "/captures/hub.State"

local DOMAIN = "Main RAM"
local BASE = 0x02000000
local PTR = 0x020231F8
local FLY = 0x020F9E64
local NEW_BARK = 60

-- cibles (coord RAM), toutes praticables à pied, hors tuiles-warp
local targets = {
  { id = 1,  x = 700, y = 426 },
  { id = 2,  x = 700, y = 430 },
  { id = 3,  x = 672, y = 424 },
  { id = 4,  x = 683, y = 440 },
  { id = 5,  x = 686, y = 422 },
  { id = 6,  x = 695, y = 440 },
  { id = 7,  x = 674, y = 436 },
  { id = 8,  x = 688, y = 432 },
  { id = 9,  x = 680, y = 428 },
  { id = 10, x = 693, y = 420 },
}

local function r16(a) return memory.read_u16_le(a - BASE, DOMAIN) end
local function r32(a) return memory.read_u32_le(a - BASE, DOMAIN) end
local function w16(a, v) memory.write_u16_le(a - BASE, v, DOMAIN) end

local function log(s)
  local f = io.open(LOG, "a")
  if f then f:write(s .. "\n") f:close() end
  console.log(s)
end

local function waitFrames(n)
  for _ = 1, n do emu.frameadvance() end
end

local function press(btn, hold)
  hold = hold or 6
  for _ = 1, hold do joypad.set({ [btn] = true }) emu.frameadvance() end
  for _ = 1, 4 do emu.frameadvance() end
end

local function getPos()
  local b = r32(PTR)
  if b < 0x02000000 or b >= 0x02400000 then return nil end
  local x = r16(b + 0x02)
  local y = r16(b - 0x0E)
  if x == 0 and y == 0 then return nil end
  if x > 2000 or y > 2000 then return nil end
  return x, y
end

local function pokeFlyTable(tx, ty)
  -- la table de Vol est en coordonnées MATRICE : Y_matrice = Y_RAM - 28
  for row = 0, 29 do
    local a = FLY + row * 18
    w16(a + 6, NEW_BARK)  -- headerFly
    w16(a + 8, tx)        -- globalX (X identique RAM/matrice)
    w16(a + 10, ty - 28)  -- globalY
  end
end

client.speedmode(800)
log("=== demarrage capture ===")

-- ---------- boot de la save : mash A jusqu'a etre en jeu, puis B ----------
waitFrames(300)
local booted = false
for i = 1, 220 do
  press("A", 12)
  waitFrames(18)
  local x, y = getPos()
  if x then booted = true break end
end
if not booted then
  log("ECHEC: pas de position apres le mash A")
  client.exit()
end
for i = 1, 15 do press("B", 10) waitFrames(15) end
waitFrames(120)
local sx, sy = getPos()
log(string.format("en jeu, spawn X=%d Y=%d", sx or -1, sy or -1))

savestate.save(HUB)
log("savestate hub cree")

-- ---------- boucle de capture ----------
for _, t in ipairs(targets) do
  savestate.load(HUB)
  waitFrames(40)
  pokeFlyTable(t.x, t.y)
  waitFrames(10)

  -- sequence Vol (HANDOFF section 6) : X > Down > A > Down > A > Left > A > A > A
  press("X", 8);    waitFrames(70)
  press("Down", 6); waitFrames(25)
  press("A", 8);    waitFrames(120)  -- ouvre l'equipe
  press("Down", 6); waitFrames(25)
  press("A", 8);    waitFrames(80)   -- Ho-Oh, prompt d'action
  press("Left", 6); waitFrames(25)
  press("A", 8);    waitFrames(260)  -- Vol -> la carte s'ouvre
  press("A", 8);    waitFrames(80)   -- selection ville (detournee)
  press("A", 8)                       -- confirme "Voler jusqu'a ... ?"

  -- attente atterrissage : position == cible, stable
  local ok, gx, gy = false, -1, -1
  local stable = 0
  for f = 1, 1800 do
    emu.frameadvance()
    local x, y = getPos()
    if x then
      gx, gy = x, y
      if x == t.x and y == t.y then
        stable = stable + 1
        if stable >= 30 then ok = true break end
      else
        stable = 0
      end
    end
  end
  waitFrames(100) -- fin du fondu
  local shot = string.format("%s/captures/spot_%02d.png", SP, t.id)
  client.screenshot(shot)
  log(string.format('{"id":%d,"cible":[%d,%d],"obtenu":[%d,%d],"ok":%s}',
    t.id, t.x, t.y, gx, gy, tostring(ok)))
end

log("=== termine ===")
client.exit()
