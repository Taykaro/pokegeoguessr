# Jouer en ligne (mode Multi de l'application)

Dans l'appli, l'écran d'accueil propose **Solo**, **Admin** et **Multijoueur**.
Le mode Multi relie tout le monde au **serveur en ligne : https://pokegeo.net**.
Chacun joue sur son émulateur ; les rounds, scores et victoires sont partagés
dans une **room**.

---

## 1. Hébergement du serveur (NAS + Cloudflare Tunnel)

Le serveur tourne sur le NAS UGREEN dans Docker, et **Cloudflare Tunnel** le rend
public sur `pokegeo.net` sans ouvrir de port sur la box. Seul le jeu est
exposé ; le reste du NAS reste privé.

- **Ce qui est déployé** : uniquement le code serveur + le site + les photos
  (`server/`, `public/`, `gamepacks/hgss_photos/`, `config.json`,
  `package*.json`), jamais la ROM ni BizHawk.
- **Sur le NAS** :
  - `/volume2/docker/pokegeoguessr/` : le jeu (`compose.yaml`, `app/` = code
    déployé + `Dockerfile`, `data/` = stats persistantes, `.env` = secrets).
  - `/volume2/docker/cloudflared/` : le tunnel (`compose.yaml`, `.env` = jeton,
    à (re)saisir avec `ssh -t nas /volume2/docker/cloudflared/set-token.sh`).
- **Mettre à jour le site** après un commit : `sh tools/deploy-nas.sh`
  (déploie le dernier commit, pas les modifications non commitées).

> Toujours allumé, pas de mise en veille comme sur un hébergeur gratuit. Les
> stats (`data/`) sont conservées et sauvegardées chaque nuit avec le NAS.

---

## 2. Jouer à plusieurs

Chaque joueur (toi inclus) :
1. Lance l'appli (`npm run app`, ou le `.exe` une fois packagé).
2. Clique **🌍 Multijoueur**.
3. Entre : **pseudo**, **même nom de room** que les autres (ex : `soiree`), et
   l'adresse du serveur (`https://pokegeo.net`, déjà pré-remplie).
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
- `zoomIntervalSec` : temps entre deux dézooms (défaut 120 s). Baisse-le pour des
  rounds plus rapides.
- `marginTiles` : tolérance de position pour gagner (défaut 3 tuiles).

## Note
Chaque joueur a besoin de sa propre ROM (légalement obtenue). Le serveur en ligne
n'héberge que les photos et la logique, pas la ROM.
