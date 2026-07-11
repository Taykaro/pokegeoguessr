--[[
  PokéGeoGuessr — pont BizHawk pour Pokémon SoulSilver (FR)
  =========================================================
  Charger dans BizHawk (core melonDS) : Tools > Lua Console > Open Script.
  Lancer aussi le relais :  node bridge/watch.js --name TonPseudo

  La position du joueur est lue via une chaîne de pointeurs découverte par
  calibration automatique (voir bridge/calibrate.lua pour d'autres versions
  du jeu) : base = [PTR], X = u16[base+2], Y = u16[base-14].
  Coordonnées globales sur la matrice du monde (mêmes unités partout en
  extérieur). Validée sur SoulSilver FR (gamecode IPGF), BizHawk 2.11 melonDS.
]]

-- ========================== CONFIG ==========================
local POS_FILE = "pokegeo_pos.json" -- écrit à côté de EmuHawk.exe

-- chaînes connues par version du jeu (gamecode lu en RAM)
-- mapid = adresse RAM de l'ID de carte courant (en-tête), pour distinguer les
-- intérieurs (coords locales non uniques). Épinglée par intersection sur 5
-- intérieurs (session 4). En extérieur cet ID varie par zone mais est ignoré
-- (coords globales uniques).
local GAMES = {
  IPGF = { ptr = 0x020231F8, xoff = 0x02, yoff = -0x0E, mapid = 0x0227D460, name = "SoulSilver (FR)" },
}
-- ============================================================

local DOMAIN = "Main RAM"
local BASE = 0x02000000

local function r16(addr) return memory.read_u16_le(addr - BASE, DOMAIN) end
local function r32(addr) return memory.read_u32_le(addr - BASE, DOMAIN) end

local function gameCode()
  local code = ""
  for i = 12, 15 do
    local b = memory.readbyte(0x3FFE00 + i, DOMAIN)
    if b >= 32 and b < 127 then code = code .. string.char(b) end
  end
  return code
end

local game = nil
local lastWritten = ""
local frame = 0

while true do
  frame = frame + 1

  if not game then
    if frame % 60 == 0 then
      local code = gameCode()
      game = GAMES[code]
      if not game and code ~= "" then
        gui.text(10, 10, "PokeGeo : version non supportee (" .. code .. ")")
        gui.text(10, 26, "Utilise bridge/calibrate.lua pour trouver la chaine de cette version.")
      end
    end
    if frame < 60 then gui.text(10, 10, "PokeGeo : en attente du jeu...") end
  else
    local b = r32(game.ptr)
    if b >= 0x02000000 and b < 0x02400000 then
      local x = r16(b + game.xoff)
      local y = r16(b + game.yoff)
      local mid = game.mapid and r16(game.mapid) or 0
      gui.text(10, 10, string.format("PokeGeo | %s | map:%d X:%d Y:%d", game.name, mid, x, y))
      if frame % 10 == 0 then
        local json = string.format('{"mapID":%d,"x":%d,"y":%d}', mid, x, y)
        if json ~= lastWritten then
          local f = io.open(POS_FILE, "w")
          if f then f:write(json) f:close() lastWritten = json end
        end
      end
    else
      gui.text(10, 10, "PokeGeo | " .. game.name .. " | (pas en jeu)")
    end
  end

  emu.frameadvance()
end
