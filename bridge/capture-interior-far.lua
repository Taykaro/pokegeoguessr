--[[
  Capture Mont Mortar à 6 points ARBITRAIRES loin des portes — flux final.
  Pas de Vol : la save propre spawn déjà devant la porte du CP (352,397).
  ROM patchée (PokeGeoCaptureMortar.nds) : warps 0-5 de Mont Mortar repointés
  vers des coordonnées centrales. Boucle : load hub -> rescan du warp de la
  porte en RAM -> patch destMap/anchor -> marche Up jusqu'à transition ->
  capture. Arrivée attendue en RAM = coords patchées + (0,28).
]]

local SP = "C:/Users/tayka/AppData/Local/Temp/claude/C--Users-tayka-Documents-Project-Taykaro-INC/01ebbd3d-3303-4489-a26f-4de6d0ff2046/scratchpad"
local LOG = SP .. "/captures10/log.txt"
local HUB = SP .. "/captures10/hub.State"

local DOMAIN = "Main RAM"
local BASE = 0x02000000
local PTR = 0x020231F8
local HDR = 119
-- anchors et coords patchées (fichier) -> arrivée RAM attendue = +(0,28)
local targets = {
  { anc = 0, ex = 83, ey = 44+28 },
  { anc = 1, ex = 24, ey = 12+28 },
  { anc = 2, ex = 43, ey = 50+28 },
  { anc = 3, ex = 65, ey = 10+28 },
  { anc = 4, ex = 18, ey = 42+28 },
  { anc = 5, ex = 60, ey = 33+28 },
}

local function r16(a) return memory.read_u16_le(a - BASE, DOMAIN) end
local function r32(a) return memory.read_u32_le(a - BASE, DOMAIN) end
local function w16(a, v) memory.write_u16_le(a - BASE, v, DOMAIN) end
local function log(s) local f=io.open(LOG,"a"); if f then f:write(s.."\n"); f:close() end; console.log(s) end
local function waitFrames(n) for _=1,n do emu.frameadvance() end end
local function press(btn, hold) hold=hold or 6; for _=1,hold do joypad.set({[btn]=true}); emu.frameadvance() end; for _=1,4 do emu.frameadvance() end end
local function getPos()
  local b=r32(PTR); if b<0x02000000 or b>=0x02400000 then return nil end
  local x=r16(b+0x02); local y=r16(b-0x0E)
  if x==0 and y==0 then return nil end
  if x>2000 or y>2000 then return nil end
  return x,y
end
local function findDoorWarp()
  local CHUNK=0x10000
  for b=0,0x400000-CHUNK,CHUNK do
    local arr=memory.read_bytes_as_array(b,CHUNK+12,DOMAIN)
    for i=1,CHUNK do
      if arr[i]==0xB9 and arr[i+1]==0x00 and arr[i+2]==0x00 and arr[i+3]==0x00 and arr[i+4]==0x00 and arr[i+5]==0x00 and arr[i+6]==0x00 and arr[i+7]==0x00 then
        local addr=BASE+b+(i-1)-4; local pos=r32(addr)
        if (pos%0x10000)==352 and math.floor(pos/0x10000)==368 then return addr end
      end
    end
  end
end

client.speedmode(800)
log("=== Mont Mortar loin des portes (final) ===")

waitFrames(300)
local booted=false
for i=1,220 do press("A",12); waitFrames(18); local x,y=getPos(); if x then booted=true break end end
if not booted then log("ECHEC boot"); client.exit() end
for i=1,15 do press("B",10) waitFrames(15) end
waitFrames(120)
local sx,sy=getPos()
log(string.format("en jeu, spawn X=%d Y=%d", sx or -1, sy or -1))
if not (sx==352 and sy==397) then log("!! spawn inattendu, abandon"); client.exit() end
savestate.save(HUB)
log("hub cree (devant la porte)")

for _,t in ipairs(targets) do
  savestate.load(HUB); waitFrames(30)
  local warp=findDoorWarp()
  if not warp then log(string.format('{"anchor":%d,"ok":false,"err":"warp introuvable"}',t.anc))
  else
    w16(warp+4, HDR); w16(warp+6, t.anc)
    local entered=false
    for step=1,20 do
      for _=1,16 do joypad.set({Up=true}); emu.frameadvance() end
      for _=1,6 do emu.frameadvance() end
      local x,y=getPos(); if x and not (x==352 and y==397) then entered=true break end
    end
    for f=1,700 do emu.frameadvance() end
    for i=1,6 do press("B",6) waitFrames(15) end
    waitFrames(60)
    local gx,gy=getPos()
    local ok = entered and gx==t.ex and gy==t.ey
    client.screenshot(string.format("%s/captures10/mortar_far_anchor%02d.png", SP, t.anc))
    log(string.format('{"anchor":%d,"attendu":[%d,%d],"obtenu":[%s,%s],"ok":%s}',
      t.anc, t.ex, t.ey, tostring(gx), tostring(gy), tostring(ok)))
  end
end
log("=== termine ===")
client.exit()
