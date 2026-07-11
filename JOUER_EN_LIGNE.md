# Jouer en ligne (mode Multi de l'application)

Dans l'appli, l'écran d'accueil propose **Solo**, **Admin** et **Multijoueur**.
Le mode Multi relie tout le monde à un **serveur en ligne** (que tu déploies une
fois, gratuitement). Chacun joue sur son émulateur ; les rounds, scores et
victoires sont partagés dans une **room**.

---

## 1. Déployer le serveur une fois (gratuit — Render.com)

Le serveur = juste le code + les photos (pas la ROM ni BizHawk, exclus par
`.gitignore`).

1. Mets le projet sur **GitHub** (repo privé possible) :
   ```bash
   git init
   git add .
   git commit -m "PokeGeoGuessr"
   # crée un repo vide sur github.com, puis :
   git remote add origin https://github.com/TON_PSEUDO/pokegeoguessr.git
   git push -u origin main
   ```
2. Sur **https://render.com** (compte gratuit) :
   - **New +** → **Web Service** → connecte ton repo GitHub.
   - Runtime **Node**, Build `npm install`, Start `npm start` (détecté auto).
   - Plan **Free** → **Create Web Service**.
3. Render te donne une **URL** du type `https://pokegeoguessr-xxxx.onrender.com`.
   C'est l'adresse à mettre dans le mode Multi.

> Gratuit : le serveur s'endort après ~15 min d'inactivité et met ~30 s à se
> réveiller au premier joueur. Normal, ça ne coûte rien.

---

## 2. Jouer à plusieurs

Chaque joueur (toi inclus) :
1. Lance l'appli (`npm run app`, ou le `.exe` une fois packagé).
2. Clique **🌍 Multijoueur**.
3. Entre : **pseudo**, **même nom de room** que les autres (ex : `soiree`), et
   l'**URL Render**.
4. Clique **Rejoindre** → tout le monde voit la même photo, et le premier arrivé
   sur le lieu marque le point (affiché chez tous), puis round suivant.

BizHawk se lance et se place à gauche : choisis **Continuer** pour charger la
sauvegarde, puis déplace-toi pour trouver le lieu.

---

## Modes Solo / Admin (hors ligne)
- **Solo** : joue seul, serveur local embarqué, rien à installer en plus.
- **Admin** : comme Solo + affichage de la cible/coordonnées et bouton « passer
  la map » (pour tes tests).

## Réglages (`config.json`)
- `zoomIntervalSec` : temps entre deux dézooms (défaut 300 s). Baisse-le pour des
  rounds plus rapides.
- `marginTiles` : tolérance de position pour gagner (défaut 3 tuiles).

## Note
Chaque joueur a besoin de sa propre ROM (légalement obtenue). Le serveur en ligne
n'héberge que les photos et la logique, pas la ROM.
