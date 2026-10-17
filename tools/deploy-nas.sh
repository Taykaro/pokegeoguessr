#!/bin/sh
# Déploie le DERNIER COMMIT sur le NAS (https://pokegeo.net).
# Les modifications non commitées ne partent PAS (git archive HEAD).
# Prérequis : hôte SSH "nas" dans ~/.ssh/config (voir JOUER_EN_LIGNE.md).
set -e
cd "$(dirname "$0")/.."
APP=/volume2/docker/pokegeoguessr/app

echo "Déploiement de $(git rev-parse --short HEAD) sur le NAS..."
# On vide l'ancien code (le Dockerfile propre au NAS est conservé) pour que les
# fichiers supprimés du dépôt disparaissent aussi du serveur.
ssh nas "cd $APP && rm -rf server public gamepacks"
git archive --format=tar HEAD server public gamepacks/hgss_photos config.json package.json package-lock.json \
  | ssh nas "tar -xf - -C $APP"
ssh nas 'cd /volume2/docker/pokegeoguessr && docker compose -p pokegeoguessr up -d --build 2>&1 | grep -vE "^#|buildx" | tail -3'
curl -s -o /dev/null -w "pokegeo.net : HTTP %{http_code}\n" https://pokegeo.net/play.html
