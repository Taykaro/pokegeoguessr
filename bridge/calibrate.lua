-- Sonde 14 : essais en étoile depuis un checkpoint savestate.
-- Depuis le même état : essai "droite", essai "attente", essai "haut".
-- X = bouge sur droite, immobile sinon. Y = bouge sur haut, immobile sinon.
-- Puis chaînes de pointeurs, reboot complet, intersection.
local DIR = "C:/Users/tayka/AppData/Local/Temp/claude/C--Users-tayka-Documents-Project-Taykaro-INC/dadeb24f-3296-41a7-99c1-278b24c66d39/scratchpad/"
local OUT = DIR .. "probe14_result.txt"
local DOMAIN = "Main RAM"
local BASE = 0x02000000
local RAM_SIZE = 0x400000
local CHUNK = 0x10000
local STATIC_END = 0x02180000
local MAX_OFF = 0x30000
local CP = DIR .. "cp14.State"

pcall(function() client.speedmode(800) end)
local f0 = io.open(OUT, "w") f0:write("") f0:close()
local function log(msg) local f = io.open(OUT, "a") f:write(msg .. "\n") f:close() end
local function advance(n) for _ = 1, n do emu.frameadvance() end end
local function hold(btn, holdF, releaseF)
  for _ = 1, holdF do joypad.set({ [btn] = true }) emu.frameadvance() end
  for _ = 1, releaseF do emu.frameadvance() end
end
local function r16(addr) return memory.read_u16_le(addr - BASE, DOMAIN) end
local function fullSnapshot()
  local chunks = {}
  for c = 0, (RAM_SIZE / CHUNK) - 1 do
    chunks[c] = memory.read_bytes_as_array(c * CHUNK, CHUNK, DOMAIN)
  end
  return chunks
end
local TRIAL_FRAMES = 3 + 25 + 35 + 50 -- face + move

local function moveTrial(dir) hold(dir, 3, 25) hold(dir, 35, 50) end

local function boot()
  for _ = 1, 200 do hold("A", 8, 8) end
  for _ = 1, 15 do hold("B", 8, 8) end
  advance(180)
end

-- essaie un axe : renvoie la table addr->valeur des candidats (ou nil)
local function axisCandidates(s0, dir, lo, hi)
  savestate.load(CP)
  moveTrial(dir)
  local cands = {}
  local n = 0
  local sM = fullSnapshot()
  for c = 0, (RAM_SIZE / CHUNK) - 1 do
    local a, b = s0[c], sM[c]
    for i = 1, CHUNK - 1, 2 do
      local va = a[i] + a[i + 1] * 256
      local d = b[i] + b[i + 1] * 256 - va
      if d >= lo and d <= hi and d ~= 0 then
        cands[BASE + c * CHUNK + i - 1] = va
        n = n + 1
      end
    end
  end
  return cands, n
end

local function filterStill(cands, label)
  -- depuis le checkpoint : attente pure, les candidats ne doivent pas bouger
  savestate.load(CP)
  advance(TRIAL_FRAMES)
  local out = {}
  local n = 0
  for addr, v0 in pairs(cands) do
    if r16(addr) == v0 then out[addr] = v0 n = n + 1 end
  end
  log(label .. "_apres_attente=" .. n)
  return out, n
end

local function filterOtherAxis(cands, dir, label)
  -- déplacement sur l'autre axe : les candidats ne doivent pas bouger
  savestate.load(CP)
  moveTrial(dir)
  local out = {}
  local n = 0
  for addr, v0 in pairs(cands) do
    if r16(addr) == v0 then out[addr] = v0 n = n + 1 end
  end
  log(label .. "_apres_axe_perp=" .. n)
  return out, n
end

local function isolate(bootLabel)
  savestate.save(CP)
  local s0 = fullSnapshot()

  -- X : droite (+1..4) sinon gauche (-4..-1)
  local candsX, nX = axisCandidates(s0, "Right", 1, 4)
  log(bootLabel .. " X_move_right=" .. nX)
  if nX == 0 then
    candsX, nX = axisCandidates(s0, "Left", -4, -1)
    log(bootLabel .. " X_move_left=" .. nX)
  end
  if nX == 0 then return nil end
  candsX = filterStill(candsX, bootLabel .. " X")
  candsX, nX = filterOtherAxis(candsX, "Up", bootLabel .. " X")
  if nX == 0 then
    return nil
  end

  -- Y : haut (-4..-1) sinon bas (+1..4)
  local candsY, nY = axisCandidates(s0, "Up", -4, -1)
  log(bootLabel .. " Y_move_up=" .. nY)
  if nY == 0 then
    candsY, nY = axisCandidates(s0, "Down", 1, 4)
    log(bootLabel .. " Y_move_down=" .. nY)
  end
  if nY > 0 then
    candsY = filterStill(candsY, bootLabel .. " Y")
    candsY, nY = filterOtherAxis(candsY, "Right", bootLabel .. " Y")
  end

  -- structure : privilégie les X dont addr-16 est un candidat Y
  local finals = {}
  local n = 0
  for addr, v in pairs(candsX) do
    local hasY = candsY[addr - 16] ~= nil
    finals[addr] = v
    n = n + 1
    log(string.format("%s PLAYER_X@0x%08X=%d Y_at_-16=%s", bootLabel, addr, v, tostring(hasY)))
    if n >= 20 then log("...") break end
  end
  return finals
end

local function findChains(cands, bootLabel)
  savestate.load(CP)
  advance(10)
  local chains = {}
  for c = 0, ((STATIC_END - BASE) / CHUNK) - 1 do
    local bytes = memory.read_bytes_as_array(c * CHUNK, CHUNK, DOMAIN)
    for i = 1, CHUNK - 3, 4 do
      local v = bytes[i] + bytes[i + 1] * 256 + bytes[i + 2] * 65536 + bytes[i + 3] * 16777216
      if v >= 0x02000000 and v < 0x02400000 then
        for addr in pairs(cands) do
          local off = addr - v
          if off >= 0 and off <= MAX_OFF then
            chains[(BASE + c * CHUNK + i - 1) .. "_" .. off] = { BASE + c * CHUNK + i - 1, off }
          end
        end
      end
    end
  end
  local count = 0
  for _ in pairs(chains) do count = count + 1 end
  log(bootLabel .. " chains=" .. count)
  return chains
end

log("=== BOOT1 ===")
boot()
client.screenshot(DIR .. "probe14_boot1.png")
local cands1 = isolate("B1")
if not cands1 then log("RESULT=FAIL boot1") client.exit() return end
local chains1 = findChains(cands1, "B1")

log("=== REBOOT ===")
client.reboot_core()
advance(60)
boot()
client.screenshot(DIR .. "probe14_boot2.png")
local cands2 = isolate("B2")
if not cands2 then log("RESULT=FAIL boot2") client.exit() return end
local chains2 = findChains(cands2, "B2")

local finals = {}
for key, ch in pairs(chains1) do
  if chains2[key] then finals[#finals + 1] = ch end
end
log("chains_communes=" .. #finals)
table.sort(finals, function(a, b) return a[2] < b[2] end)
local shown = 0
for _, ch in ipairs(finals) do
  local p, off = ch[1], ch[2]
  local basev = memory.read_u32_le(p - BASE, DOMAIN)
  log(string.format("CHAIN P=0x%08X off=0x%X -> X=%d Y=%d", p, off, r16(basev + off), r16(basev + off - 16)))
  shown = shown + 1
  if shown >= 40 then log("...") break end
end

log("RESULT=OK")
client.exit()
