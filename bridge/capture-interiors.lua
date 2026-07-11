--[[
  Capture d'intérieurs par patch RAM du warp de la porte du CP de Doublonville.
  Chaque itération : recharge le hub, vole devant la porte (352,397), repère
  l'entrée warp active en RAM (motif destMap=185 + zéros), écrase destMap/anchor
  vers l'intérieur cible, entre (Up), efface un éventuel dialogue (B), capture.
  Cibles = intérieurs SANS script d'entrée (pas le labo du prof).
]]

local SP = "C:/Users/tayka/AppData/Local/Temp/claude/C--Users-tayka-Documents-Project-Taykaro-INC/01ebbd3d-3303-4489-a26f-4de6d0ff2046/scratchpad"
local LOG = SP .. "/captures4/log.txt"
local HUB = SP .. "/captures2/hub.State"

local DOMAIN = "Main RAM"
local BASE = 0x02000000
local PTR = 0x020231F8
local FLY = 0x020F9E64

-- intérieurs cibles (destMap = ID header). Aucun script d'entrée connu.
local targets = {
  { id = 1, name = "CP_DOUBLONVILLE",  hdr = 185 },
  { id = 2, name = "ARENE_DOUBLONVILLE", hdr = 137 },
  { id = 3, name = "GRAND_MAGASIN_1F", hdr = 191 },
}

local function r16(a) return memory.read_u16_le(a - BASE, DOMAIN) end
local function r32(a) return memory.read_u32_le(a - BASE, DOMAIN) end
local function w16(a, v) memory.write_u16_le(a - BASE, v, DOMAIN) end

local function log(s)
  local f = io.open(LOG, "a"); if f then f:write(s .. "\n"); f:close() end
  console.log(s)
end
local function waitFrames(n) for _ = 1, n do emu.frameadvance() end end
local function press(btn, hold)
  hold = hold or 6
  for _ = 1, hold do joypad.set({ [btn] = true }) emu.frameadvance() end
  for _ = 1, 4 do emu.frameadvance() end
end
local function getPos()
  local b = r32(PTR)
  if b < 0x02000000 or b >= 0x02400000 then return nil end
  local x = r16(b + 0x02); local y = r16(b - 0x0E)
  return x, y
end
local function pokeFlyTable(hdr, tx, ty)
  for row = 0, 29 do
    local a = FLY + row * 18
    w16(a + 6, hdr); w16(a + 8, tx); w16(a + 10, ty - 28)
  end
end

-- repère l'entrée du warp de la porte du CP : destMap=185 (B9 00) suivi de
-- anchor u16 + height u32 = 0, et position (352,368) juste avant (comme le POC
-- validé, qui trouvait 0x022A176C). Renvoie l'adresse du champ position.
local function findDoorWarp()
  local CHUNK = 0x10000
  for base = 0, 0x400000 - CHUNK, CHUNK do
    local arr = memory.read_bytes_as_array(base, CHUNK + 12, DOMAIN)
    for i = 1, CHUNK do
      if arr[i] == 0xB9 and arr[i+1] == 0x00 and arr[i+2] == 0x00 and arr[i+3] == 0x00
         and arr[i+4] == 0x00 and arr[i+5] == 0x00 and arr[i+6] == 0x00 and arr[i+7] == 0x00 then
        local addr = BASE + base + (i - 1) - 4  -- champ position (u32) avant destMap
        local pos = r32(addr)
        if (pos % 0x10000) == 352 and math.floor(pos / 0x10000) == 368 then
          return addr
        end
      end
    end
  end
  return nil
end

local function flyToDoor()
  pokeFlyTable(76, 352, 397)  -- header 76 = GOLDENROD, case devant la porte
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
  local stable = 0
  for f = 1, 1800 do
    emu.frameadvance()
    local x, y = getPos()
    if x and x == 352 and y == 397 then stable = stable + 1; if stable >= 30 then break end
    else stable = 0 end
  end
  waitFrames(60)
end

client.speedmode(800)
log("=== capture interieurs ===")

for _, t in ipairs(targets) do
  savestate.load(HUB)
  waitFrames(30)
  flyToDoor()
  local ax, ay = getPos()

  local warp = findDoorWarp()
  if not warp then
    log(string.format('{"id":%d,"zone":"%s","ok":false,"err":"warp introuvable"}', t.id, t.name))
  else
    w16(warp + 4, t.hdr)  -- destMap
    w16(warp + 6, 0)      -- anchor
    -- entrée robuste : marcher vers le nord jusqu'à ce que la position quitte
    -- (352,397) (= transition déclenchée), timeout ~300 frames.
    local entered = false
    for step = 1, 20 do
      for _ = 1, 16 do joypad.set({ Up = true }); emu.frameadvance() end
      for _ = 1, 6 do emu.frameadvance() end
      local x, y = getPos()
      if x and not (x == 352 and y == 397) then entered = true; break end
    end
    -- laisser la transition se terminer
    local gx, gy = -1, -1
    for f = 1, 700 do emu.frameadvance(); local x, y = getPos(); if x then gx, gy = x, y end end
    for i = 1, 8 do press("B", 6) waitFrames(20) end
    waitFrames(60)
    client.screenshot(string.format("%s/captures4/int_%02d_%s.png", SP, t.id, t.name))
    log(string.format('{"id":%d,"zone":"%s","warp":"0x%08X","devant":[%d,%d],"arrivee":[%d,%d],"ok":%s}',
      t.id, t.name, warp, ax or -1, ay or -1, gx, gy, tostring(entered)))
  end
end

log("=== termine ===")
client.exit()
