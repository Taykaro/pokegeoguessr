# PokéGeoGuessr

GeoGuessr multijoueur dans Pokémon : le serveur montre un screenshot très zoomé
d'un endroit de la carte, l'image se dézoome progressivement, et le premier
joueur qui amène **son personnage en jeu** sur place (± une petite marge) gagne
le point. Round suivant automatique.

## Démarrage rapide (test sans ROM)

```bash
npm install
npm run genmap     # génère la carte de test
npm start          # serveur sur http://localhost:3000
```

- **Page de jeu** : http://localhost:3000 — pseudo + room, montre l'image à trouver.
- **Simulateur** : http://localhost:3000/sim.html — remplace l'émulateur, on se
  déplace aux flèches. Ouvre les deux avec le même pseudo (deux onglets), et une
  deuxième paire dans une fenêtre privée pour simuler un adversaire.

Pour tester vite, baisse `zoomIntervalSec` dans [config.json](config.json)
(300 s = les 5 min du vrai jeu, mets 20 pour les tests).

## Jouer en ligne

Le serveur est un simple process Node : héberge-le sur une petite VM, ou expose
ton port 3000 (tunnel type `cloudflared tunnel` / `ngrok`, ou redirection de
port). Les autres joueurs ouvrent l'URL, chacun lance son émulateur + bridge en
pointant `--server http://ton-url`.

## Avec le vrai jeu (SoulSilver)

Chaque joueur a besoin de :

1. **Sa ROM SoulSilver** (dump personnel — non fournie).
2. **BizHawk** (émulateur, gratuit) avec le core melonDS.
3. La **save partagée** (partie finie, équipe full CS — créée avec PKHeX, fournie avec le pack).
4. Le script **[bridge/hgss.lua](bridge/hgss.lua)** chargé dans BizHawk
   (Tools > Lua Console) — calibration des adresses RAM la première fois,
   instructions dans le script.
5. Le **relais** : `node bridge/watch.js --name TonPseudo --server http://...`

## Structure

```
server/          serveur de partie (Node + Socket.IO)
public/          client web (jeu + simulateur)
bridge/          pont émulateur : script Lua BizHawk + relais Node
gamepacks/
  testpack/      carte générée pour tester sans ROM
  hgss/          pack SoulSilver (à compléter — voir son README)
tools/           générateur de carte de test
config.json      port, pack actif, intervalle de dézoom, marge
```

## Ajouter un jeu

Un jeu = un « game pack » : `map.png` (carte complète, 16 px/tuile) +
`pack.json` (correspondance mapID → offsets globaux, zones jouables, zooms) +
un script Lua de lecture de position + une save prête à jouer. Le serveur et le
client ne changent pas.
