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
-- mapidPtr = adresse STATIQUE (fixe à chaque boot) de sFieldSysPtr (décomp
-- pret/pokeheartgold, src/field_system.c : "static FieldSystem *sFieldSysPtr").
-- Chaîne : sFieldSysPtr -> FieldSystem (+0x20 = Location*) -> Location (+0x00
-- = mapId, int). Validée sur reboot froid (session 5) : 76 dehors -> 185 en
-- entrant naturellement au CP de Doublonville, sur DEUX boots différents.
-- ⚠️ Un premier essai (0x0227D460, trouvé via patch RAM de warp) était FAUX :
-- c'était un artefact du mécanisme de patch, pas une vraie adresse de jeu —
-- elle changeait à chaque boot. La bonne méthode : chercher une adresse dont
-- la VALEUR pointe (double déréférence) vers un mapId cohérent, ET qui reste
-- la MÊME ADRESSE sur un reboot complet (statique, pas heap).
local GAMES = {
  IPGF = { ptr = 0x020231F8, xoff = 0x02, yoff = -0x0E, mapidPtr = 0x021D1130, name = "SoulSilver (FR)" },
}
-- ============================================================

local DOMAIN = "Main RAM"
local BASE = 0x02000000

local function r16(addr) return memory.read_u16_le(addr - BASE, DOMAIN) end
local function r32(addr) return memory.read_u32_le(addr - BASE, DOMAIN) end

-- Lit l'ID de carte courant via la chaîne sFieldSysPtr -> Location -> mapId.
-- Renvoie 0 si un maillon de la chaîne n'est pas encore initialisé (ex. tout
-- début du boot, avant que FieldSystem existe).
local function readMapId(mapidPtr)
  if not mapidPtr then return 0 end
  local fieldSys = r32(mapidPtr)
  if fieldSys < 0x02100000 or fieldSys >= 0x02400000 then return 0 end
  local ok, location = pcall(r32, fieldSys + 0x20)
  if not ok or location < 0x02100000 or location >= 0x02400000 then return 0 end
  local ok2, mapId = pcall(r32, location)
  return (ok2 and mapId) or 0
end

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
      local mid = readMapId(game.mapidPtr)
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
