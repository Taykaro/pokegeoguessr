# 🎯 PokéGeoGuessr

> Un **GeoGuessr multijoueur dans Pokémon SoulSilver**. Le jeu montre une photo
> d'un lieu qui se dézoome petit à petit ; le premier joueur qui **amène son
> personnage** sur place (dans l'émulateur) marque le point. Tout se joue **dans
> le navigateur** — pas d'installation.

**▶ Bêta en ligne : https://pokegeoguessr.onrender.com**
**💬 Discord : _(à venir)_**

<!-- Ajoute ici un GIF de 15-20 s d'une manche (l'atout marketing n°1). -->

## Comment jouer

1. Ouvre le site, **crée ou rejoins un salon** (difficulté, région, nombre de
   joueurs max, mot de passe optionnel).
2. Charge **ta propre ROM SoulSilver (.nds)** — elle reste sur ta machine, rien
   n'est envoyé au serveur. L'émulateur démarre dans l'onglet.
3. Tout le monde se balade un peu ; quand chacun est prêt, **le meneur lance**.
4. Une photo très zoomée apparaît puis se **dézoome**. Cours jusqu'au lieu avec
   ton perso : trouver tôt (image encore floue) rapporte plus de points. Une
   **fenêtre « clutch »** laisse ~30 s aux autres pour te rejoindre.
5. **Premier à 10 points** gagne la partie.

Indices **chaud/froid** en Poké Ball → Master Ball, 3 modes de difficulté,
manette tactile pour jouer au téléphone, révélation de fin de manche sur la
carte du Pokégear.

## Sous le capot

- **Serveur** : Node + Express + **Socket.IO** — salons, rounds, dézoom, détection
  de victoire par **comparaison de coordonnées**.
- **Émulateur navigateur** : melonDS compilé en **WASM** (DS Anywhere / WebMelon),
  BIOS libre — aucun BIOS proprio requis.
- **Lecture de position** : scan de la RAM de l'émulateur (gamecode `IPGF`) pour
  lire les coordonnées du joueur, comparées à la cible ± une marge.
- **Photos** : vraies captures du jeu, recadrées et zoomées **côté serveur** (la
  carte complète ne fuit jamais au client, pas de triche possible).

## Dev local

```bash
npm install
npm start        # http://localhost:3000
```

`config.json` : intervalle de dézoom, marge de détection, score cible, durée de
la fenêtre clutch. `public/sim.html` = simulateur (déplacement aux flèches) pour
tester la boucle de jeu **sans émulateur ni ROM**.

## Structure

```
server/                serveur de partie (Node + Socket.IO)
public/                client web (jeu + simulateur + assets)
gamepacks/hgss_photos/ pack SoulSilver servi aux joueurs (photos + calibration)
tools/                 extraction ROM (praticabilité, warps, points intérieurs…)
bridge/                pont pour émulateur externe (mode avancé, optionnel)
config.json            réglages de partie
```

## Statut

**Bêta.** Retours et idées bienvenus sur le Discord. Le serveur d'hébergement
va changer pour tenir la charge.

## ⚖️ Avis

Projet de **fan**, **sans aucun lien avec Nintendo, Game Freak ou The Pokémon
Company**. Aucune ROM n'est fournie ni distribuée — chaque joueur utilise **sa
propre copie légale** du jeu. « Pokémon », « SoulSilver » et les éléments
associés appartiennent à leurs détenteurs respectifs. Le code de ce dépôt est
sous licence MIT ; il ne couvre pas les contenus appartenant à des tiers.
