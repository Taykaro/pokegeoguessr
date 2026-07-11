--[[
  Harnais de capture par lot avec checkpoint/reprise.
  - Jobs : dofile(JOBS) -> liste { id, name, hdr, x, y } (extérieurs, via Vol).
  - results.jsonl : 1 ligne JSON par job, écrite immédiatement (checkpoint).
  - Reprise : les ids déjà présents dans results.jsonl sont sautés
    (réussis ET ratés — les ratés attendent des instructions humaines).
  - Échec : screenshot diagnostic fail_<id>.png + quarantaine.
  - 3 échecs consécutifs -> arrêt propre + STATUS.txt (raison + où on en est).
]]

local SP = "C:/Users/tayka/AppData/Local/Temp/claude/C--Users-tayka-Documents-Project-Taykaro-INC/01ebbd3d-3303-4489-a26f-4de6d0ff2046/scratchpad"
local DIR = SP .. "/batchdemo"
local JOBS = DIR .. "/jobs.lua"
local RESULTS = DIR .. "/results.jsonl"
local STATUS = DIR .. "/STATUS.txt"
local LOG = DIR .. "/log.txt"
local HUB = DIR .. "/hub.State"
local MAX_CONSECUTIVE_FAILS = 3

local DOMAIN = "Main RAM"
local BASE = 0x02000000
local PTR = 0x020231F8
local FLY = 0x020F9E64

local function r16(a) return memory.read_u16_le(a - BASE, DOMAIN) end
local function r32(a) return memory.read_u32_le(a - BASE, DOMAIN) end
local function w16(a, v) memory.write_u16_le(a - BASE, v, DOMAIN) end
local function log(s) local f=io.open(LOG,"a"); if f then f:write(s.."\n"); f:close() end; console.log(s) end
local function appendResult(s) local f=io.open(RESULTS,"a"); if f then f:write(s.."\n"); f:close() end end
local function writeStatus(s) local f=io.open(STATUS,"w"); if f then f:write(s); f:close() end end
local function waitFrames(n) for _=1,n do emu.frameadvance() end end
local function press(btn, hold) hold=hold or 6; for _=1,hold do joypad.set({[btn]=true}); emu.frameadvance() end; for _=1,4 do emu.frameadvance() end end
local function getPos()
  local b=r32(PTR); if b<0x02000000 or b>=0x02400000 then return nil end
  local x=r16(b+0x02); local y=r16(b-0x0E)
  if x==0 and y==0 then return nil end
  if x>2000 or y>2000 then return nil end
  return x,y
end
local function pokeFlyTable(hdr,tx,ty) for row=0,29 do local a=FLY+row*18; w16(a+6,hdr); w16(a+8,tx); w16(a+10,ty-28) end end

-- ---- reprise : ids déjà traités ----
local done = {}
do
  local f = io.open(RESULTS, "r")
  if f then
    for line in f:lines() do
      local id = line:match('"id":(%d+)')
      if id then done[tonumber(id)] = true end
    end
    f:close()
  end
end

local jobs = dofile(JOBS)
local todo = 0
for _, j in ipairs(jobs) do if not done[j.id] then todo = todo + 1 end end
log(string.format("=== batch : %d jobs, %d restants ===", #jobs, todo))
if todo == 0 then
  writeStatus("TERMINE : tous les jobs sont traites (voir results.jsonl).")
  log("rien a faire"); client.exit()
end

client.speedmode(800)

-- ---- boot + hub ----
waitFrames(300)
local booted=false
for i=1,220 do press("A",12); waitFrames(18); local x,y=getPos(); if x then booted=true break end end
if not booted then
  writeStatus("STOP : echec du boot (position illisible apres 220 A). Rien n'a ete tente.")
  log("ECHEC boot"); client.exit()
end
for i=1,15 do press("B",10) waitFrames(15) end
waitFrames(120)
local sx,sy=getPos()
log(string.format("en jeu, spawn X=%d Y=%d", sx or -1, sy or -1))
if not (sx and math.abs(sx-344)<20 and math.abs(sy-402)<20) then
  writeStatus(string.format("STOP : spawn inattendu (%d,%d) — mauvaise save ? Rien n'a ete tente.", sx or -1, sy or -1))
  client.exit()
end
savestate.save(HUB)

-- ---- boucle des jobs ----
local consecutiveFails = 0
for _, t in ipairs(jobs) do
  if not done[t.id] then
    savestate.load(HUB); waitFrames(30)
    pokeFlyTable(t.hdr, t.x, t.y)
    waitFrames(10)
    press("X",8); waitFrames(70); press("Down",6); waitFrames(25); press("A",8); waitFrames(120)
    press("Down",6); waitFrames(25); press("A",8); waitFrames(80); press("Left",6); waitFrames(25)
    press("A",8); waitFrames(260); press("A",8); waitFrames(80); press("A",8)
    local ok, gx, gy = false, -1, -1
    local stable = 0
    for f = 1, 1800 do
      emu.frameadvance()
      local x, y = getPos()
      if x then
        gx, gy = x, y
        if x == t.x and y == t.y then stable = stable + 1; if stable >= 30 then ok = true break end
        else stable = 0 end
      end
    end
    waitFrames(100)
    if ok then
      client.screenshot(string.format("%s/spot_%03d_%s.png", DIR, t.id, t.name))
      appendResult(string.format('{"id":%d,"zone":"%s","cible":[%d,%d],"obtenu":[%d,%d],"ok":true}', t.id, t.name, t.x, t.y, gx, gy))
      log(string.format("OK %d %s", t.id, t.name))
      consecutiveFails = 0
    else
      client.screenshot(string.format("%s/fail_%03d_%s.png", DIR, t.id, t.name))
      appendResult(string.format('{"id":%d,"zone":"%s","cible":[%d,%d],"obtenu":[%d,%d],"ok":false}', t.id, t.name, t.x, t.y, gx, gy))
      log(string.format("ECHEC %d %s : attendu (%d,%d) obtenu (%d,%d) -> quarantaine + diag", t.id, t.name, t.x, t.y, gx, gy))
      consecutiveFails = consecutiveFails + 1
      if consecutiveFails >= MAX_CONSECUTIVE_FAILS then
        writeStatus(string.format(
          "STOP : %d echecs consecutifs (dernier : job %d %s, obtenu (%d,%d)).\n" ..
          "Probleme systemique probable (menu coince, save, dialogue).\n" ..
          "Progression sauvee dans results.jsonl ; screenshots fail_*.png pour diagnostic.\n" ..
          "Relancer le meme script = reprise automatique apres instructions.",
          consecutiveFails, t.id, t.name, gx, gy))
        log("STOP : trop d'echecs consecutifs"); client.exit()
      end
    end
  end
end

writeStatus("TERMINE : batch complet (voir results.jsonl).")
log("=== termine ===")
client.exit()
