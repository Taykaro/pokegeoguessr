# PokéGeoGuessr — instructions projet

GeoGuessr multijoueur dans Pokémon SoulSilver (FR). Le serveur montre une photo
zoomée d'un lieu qui se dézoome ; le premier joueur qui amène son personnage en
jeu sur le lieu (± marge) gagne le point. La position du joueur est lue en RAM
dans BizHawk (script Lua) et relayée au serveur.

**Avant de travailler, lis [HANDOFF.md](HANDOFF.md)** : il contient l'état complet
du projet, ce qui marche, les adresses RAM / formats ROM déjà trouvés, et
surtout **ce qui a déjà été essayé et a échoué** (pour ne pas refaire les mêmes
impasses — notamment toute la saga « téléportation »).

## Stack
- Serveur : Node + Express + Socket.IO + pngjs (`server/`). Les crops sont faits
  côté serveur (pas de fuite de la carte au client).
- Client web : `public/` (page de jeu + `sim.html` simulateur de test).
- Pont émulateur : `bridge/` (script Lua BizHawk + relais `watch.js`).
- Données par jeu : `gamepacks/` (format « game pack » : `map.png` + `pack.json`).
- Outils ROM : `tools/` (extraction carte de collision + warps depuis la ROM).

## Démarrage
```bash
npm install
npm run genmap        # carte de test (pack testpack)
npm start             # http://localhost:3000  (+ /sim.html)
```
`config.json` : port, pack actif (`hgss` ou `testpack`), intervalle de dézoom, marge.

## Faits clés (détails dans HANDOFF.md)
- ROM : SoulSilver **France**, gamecode **IPGF**. Position RAM :
  `base = u32[0x020231F8]`, `X = u16[base+0x02]`, `Y = u16[base-0x0E]`,
  coordonnées globales de la matrice monde, +1 par tuile.
- Extraction ROM qui marche : `tools/extract-walkability.js` (praticabilité) et
  `tools/extract-warps.js` (tous les warps). Ne PAS refaire à la main.
- Détection de victoire = comparaison de coordonnées (déjà fonctionnelle). La
  cartographie ne sert QU'À fabriquer les photos.

## Conventions
- Français pour les échanges et commentaires.
- Les chemins absolus Windows des scripts de `scratchpad` ne sont PAS portables ;
  les outils réutilisables sont dans `tools/` et `bridge/` (dans le repo).
