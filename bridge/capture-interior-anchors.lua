--[[
  Démo multi-angles SANS marcher : même intérieur (Mont Mortar 1F, header 119),
  plusieurs valeurs d'anchor -> le perso apparaît à des positions dispersées.
  Réutilise le sas de la porte du CP de Doublonville.
]]

local SP = "C:/Users/tayka/AppData/Local/Temp/claude/C--Users-tayka-Documents-Project-Taykaro-INC/01ebbd3d-3303-4489-a26f-4de6d0ff2046/scratchpad"
local LOG = SP .. "/captures5/log.txt"
local HUB = SP .. "/captures2/hub.State"

local DOMAIN = "Main RAM"
local BASE = 0x02000000
local PTR = 0x020231F8
local FLY = 0x020F9E64
local HDR = 119  -- MOUNT_MORTAR_1F_ENTRANCE
local ANCHORS = { 0, 2, 4, 7, 10 }

local function r16(a) return memory.read_u16_le(a - BASE, DOMAIN) end
local function r32(a) return memory.read_u32_le(a - BASE, DOMAIN) end
local function w16(a, v) memory.write_u16_le(a - BASE, v, DOMAIN) end
local function log(s) local f=io.open(LOG,"a"); if f then f:write(s.."\n"); f:close() end; console.log(s) end
local function waitFrames(n) for _=1,n do emu.frameadvance() end end
local function press(btn, hold) hold=hold or 6; for _=1,hold do joypad.set({[btn]=true}); emu.frameadvance() end; for _=1,4 do emu.frameadvance() end end
local function getPos()
  local b=r32(PTR); if b<0x02000000 or b>=0x02400000 then return nil end
  return r16(b+0x02), r16(b-0x0E)
end
local function pokeFlyTable(hdr,tx,ty) for row=0,29 do local a=FLY+row*18; w16(a+6,hdr); w16(a+8,tx); w16(a+10,ty-28) end end
local function findDoorWarp()
  local CHUNK=0x10000
  for base=0,0x400000-CHUNK,CHUNK do
    local arr=memory.read_bytes_as_array(base,CHUNK+12,DOMAIN)
    for i=1,CHUNK do
      if arr[i]==0xB9 and arr[i+1]==0x00 and arr[i+2]==0x00 and arr[i+3]==0x00
         and arr[i+4]==0x00 and arr[i+5]==0x00 and arr[i+6]==0x00 and arr[i+7]==0x00 then
        local addr=BASE+base+(i-1)-4
        local pos=r32(addr)
        if (pos%0x10000)==352 and math.floor(pos/0x10000)==368 then return addr end
      end
    end
  end
  return nil
end
local function flyToDoor()
  pokeFlyTable(76,352,397); waitFrames(10)
  press("X",8); waitFrames(70); press("Down",6); waitFrames(25)
  press("A",8); waitFrames(120); press("Down",6); waitFrames(25)
  press("A",8); waitFrames(80); press("Left",6); waitFrames(25)
  press("A",8); waitFrames(260); press("A",8); waitFrames(80); press("A",8)
  local stable=0
  for f=1,1800 do emu.frameadvance(); local x,y=getPos()
    if x and x==352 and y==397 then stable=stable+1; if stable>=30 then break end else stable=0 end end
  waitFrames(60)
end

client.speedmode(800)
log("=== demo multi-anchors Mont Mortar ===")
local id=0
for _,anc in ipairs(ANCHORS) do
  id=id+1
  savestate.load(HUB); waitFrames(30)
  flyToDoor()
  local warp=findDoorWarp()
  if not warp then log(string.format('{"id":%d,"anchor":%d,"ok":false,"err":"warp introuvable"}',id,anc))
  else
    w16(warp+4, HDR); w16(warp+6, anc)
    for step=1,20 do
      for _=1,16 do joypad.set({Up=true}); emu.frameadvance() end
      for _=1,6 do emu.frameadvance() end
      local x,y=getPos(); if x and not (x==352 and y==397) then break end
    end
    local gx,gy=-1,-1
    for f=1,700 do emu.frameadvance(); local x,y=getPos(); if x then gx,gy=x,y end end
    for i=1,6 do press("B",6) waitFrames(15) end
    waitFrames(60)
    client.screenshot(string.format("%s/captures5/mortar_anchor%02d.png", SP, anc))
    log(string.format('{"id":%d,"anchor":%d,"arrivee":[%d,%d]}', id, anc, gx, gy))
  end
end
log("=== termine ===")
client.exit()
