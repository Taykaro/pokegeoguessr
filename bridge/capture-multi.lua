--[[
  Capture automatique multi-zones — même méthode que capture-bourgeon.lua
  (détournement des 30 lignes de la table de Vol, séquence menu fixe),
  avec header de zone par cible. Cibles chargées depuis targets-multi.lua.
]]

local SP = "C:/Users/tayka/AppData/Local/Temp/claude/C--Users-tayka-Documents-Project-Taykaro-INC/01ebbd3d-3303-4489-a26f-4de6d0ff2046/scratchpad"
local LOG = SP .. "/captures2/log.txt"
local HUB = SP .. "/captures2/hub.State"

local DOMAIN = "Main RAM"
local BASE = 0x02000000
local PTR = 0x020231F8
local FLY = 0x020F9E64

local targets = dofile(SP .. "/targets-multi.lua")

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

local function pokeFlyTable(hdr, tx, ty)
  -- table de Vol en coordonnées MATRICE : Y_matrice = Y_RAM - 28
  for row = 0, 29 do
    local a = FLY + row * 18
    w16(a + 6, hdr)
    w16(a + 8, tx)
    w16(a + 10, ty - 28)
  end
end

client.speedmode(800)
log("=== demarrage capture multi-zones ===")

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

for _, t in ipairs(targets) do
  savestate.load(HUB)
  waitFrames(40)
  pokeFlyTable(t.hdr, t.x, t.y)
  waitFrames(10)

  press("X", 8);    waitFrames(70)
  press("Down", 6); waitFrames(25)
  press("A", 8);    waitFrames(120)
  press("Down", 6); waitFrames(25)
  press("A", 8);    waitFrames(80)
  press("Left", 6); waitFrames(25)
  press("A", 8);    waitFrames(260)
  press("A", 8);    waitFrames(80)
  press("A", 8)

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
  waitFrames(100)
  local shot = string.format("%s/captures2/spot_%02d_%s.png", SP, t.id, t.name)
  client.screenshot(shot)
  log(string.format('{"id":%d,"zone":"%s","cible":[%d,%d],"obtenu":[%d,%d],"ok":%s}',
    t.id, t.name, t.x, t.y, gx, gy, tostring(ok)))
end

log("=== termine ===")
client.exit()
