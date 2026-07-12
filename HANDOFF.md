# PokéGeoGuessr — état complet du projet (handoff)

> Document de passation pour une nouvelle session Claude (VS Code / Linux).
> Il remplace la « mémoire » locale de la machine Windows (qui ne suit pas le
> changement d'OS). Lis-le en entier avant d'agir.

## 1. Concept

GeoGuessr multijoueur dans **Pokémon SoulSilver (FR)**. Le serveur tire un lieu
au hasard, montre une **photo très zoomée** qui **se dézoome** progressivement.
Chaque joueur joue sur SON émulateur ; le premier qui amène son personnage sur
le lieu (± marge de quelques tuiles) gagne le point, puis round suivant.

- **Vérification victoire = comparaison de coordonnées** lues en RAM. C'est
  simple et **déjà fonctionnel**. La cartographie ne sert QU'À produire les photos.

**Lot UI/fun (session 5)** :
- **Jauge chaud/froid en balls** : chaque joueur = une ball (Poké < Super <
  Hyper < Master, mappées aux paliers lost/region/warm/goat) + une barre de
  proximité animée. `%` calculé serveur (`hintPct`, bandes croissantes avec le
  rang de la ball). SVG des balls générés côté client (`ballSVG`). Rendu par
  diff clé=nom (transition CSS de la largeur ; reflow forcé, PAS de rAF — rAF/
  transition sont en pause dans un onglet hors-écran, d'où les tests via
  `getBoundingClientRect` après désactivation de la transition).
- **Premier à N points** (`config.winScore=10`, `podiumSec=12`) : `win()`
  déclenche `endGame()` au seuil -> event `game:over` {winner, standings,
  seconds} -> podium client (overlay `#podium`) -> reset scores + nouvelle
  partie. `publicState` expose `winScore`.

**Lot expérience de jeu (session 5)** : 4 features ajoutées.
- **Score au temps** : trouver tôt (photo encore très zoomée) rapporte plus.
  `win()` donne `crops.length - level` points (4→1 sur 4 niveaux).
- **Filtres région/type** : la room est créée avec un filtre `{region, type}`
  choisi dans le menu (`f-region`/`f-type`), passé en param d'URL → join →
  `Room.filter` → `pack.randomTarget(filter)` / `pack.filteredPhotos` (cache).
  Région d'une photo via `pack.photoRegion` (extérieur = sa position, intérieur
  = sa porte). Appliqué à la CRÉATION de la room seulement.
- **Révélation de fin de round** : `minimap.png` = copie de `walkmask.png`
  (1504×572), en espace RAM **1:1** (1 px = 1 tuile, `gy` direct, vérifié).
  Servie par `/minimap`. `round:won` embarque `reveal` (cible + positions monde
  des joueurs) ; le client dessine sur un `<canvas id="reveal">`.
- **Sons** : synthèse WebAudio (aucun asset, pas d'audio Pokémon copyrighté),
  cues par palier chaud/froid au dézoom + jingle de victoire, bouton mute.

**Calibration géographique (indice chaud/froid, session 5)** : sur la matrice
monde, les coords ext. `gx`/`gy` sont des tuiles globales ; **1 « carte »
(chunk) = 32 tuiles**. Frontière Johto/Kanto sur l'axe X : **Johto ≈ gx
256-830, Kanto ≈ gx 896-1438**, transition (Mont Argenté/Tohjo) vers **gx 865**
(constante `REGION_BOUNDARY_GX` dans `server/pack.js`). Distance en cartes =
`max(|dx|,|dy|)/32` (Chebyshev). Sert au tableau chaud/froid par joueur
(`pack.proximityHint` → paliers goat ≤2 / warm ≤5 / region / lost, messages
dans `game.js` `hintMessage`, tableau `#hints` côté client, recalculé à chaque
dézoom via `publicState`). ⚠️ **Symétrie porte côté JOUEUR aussi** (`pack.playerWorldPos`) : quand un
joueur est DANS un intérieur connu (son `mapID` est une clé de `interiorDoors`),
on prend la porte du bâtiment comme sa position monde, pas ses coords LOCALES.
Sinon ces coords locales (ex. 34,55), si elles tombaient dans les bornes du
monde, étaient prises pour des coords overworld → « perdu » aberrant (bug :
deux joueurs dans des bâtiments de zones différentes avaient tous les deux
« perdu »). Aucun mapID overworld ne collisionne avec les clés de portes
(vérifié 76/60/32). Utilisé par `proximityHint` ET `worldPosOf` (révélation).

Pour les cibles **intérieures**, on mesure la distance jusqu'à la **porte
overworld** du bâtiment (le joueur chasse en extérieur vers l'entrée) :
table `mapID → (gx,gy)` construite par `tools/build-interior-doors.js` et
embarquée dans `pack.json` (`interiorDoors`). Méthode : dans les warps
(`extract-warps.js`), on cherche celui dont `destMap == mapID` intérieur ; sa
position est en coords MATRICE → coord RAM = `(px, py+28)` (même calibration
que le reste). Bâtiments à étages : on remonte le graphe des warps
(2F→1F→rue) jusqu'à une carte overworld. La table couvre **TOUS les intérieurs du jeu** (404 headers non-overworld avec
banque d'events), pas seulement ceux qui ont des photos — sinon un joueur qui
entre dans une grotte non capturée (ex. **Grotte Union, map 99**) n'a aucune
porte donc aucun chaud/froid (bug remonté). L'overworld est identifié via la
matrice monde (NARC a/0/4/1, section headers) pour NE PAS donner de porte aux
cartes overworld (sinon leurs coords globales seraient écrasées → chaud/froid
extérieur cassé) — vérifié : 0 collision. **377/404** intérieurs résolus ;
27 échecs = cartes événement/scénario (Sinjoh, concours de capture, salles
cachées Ruines Alph, Power Plant cassé) ou maps inutilisées/JP → pas d'indice.
Validé : mapID 185 → (352,396), map 99 (Union Cave) → (462,458).
Reconstruire : `node tools/build-interior-doors.js <scratch_warps> "<ROM.nds>"`
puis réinjecter dans `pack.json` (`interiorDoors`).
- Multijoueur : chacun son émulateur + pont ; le serveur centralise rounds/scores.

## 2. Ce qui MARCHE (validé de bout en bout)

- **Serveur + client web** (`server/`, `public/`) : rooms, rounds, dézoom (5
  niveaux), détection victoire (marge configurable), scores, reconnexion.
  Crops côté serveur (anti-triche). Testé avec `testpack` (carte générée) et avec
  la vraie ROM.
- **Lecture position RAM** (SoulSilver FR / IPGF) :
  `base = u32[0x020231F8]` ; `X = u16[base+0x02]` ; `Y = u16[base-0x0E]`.
  Coordonnées **globales** de la matrice monde, +1 par tuile. Fichier :
  `bridge/hgss.lua` (table `GAMES` par gamecode).
- **Pont émulateur → serveur** : `hgss.lua` écrit `pokegeo_pos.json`, `bridge/watch.js`
  le POST au serveur (`/pos`). ⚠️ BizHawk Lua écrit les fichiers relatifs dans le
  **dossier du script**, donc `watch.js` cherche par défaut dans `bridge/`.
- **Premier round réel gagné** avec la vraie ROM (cible devant le CP de
  Doublonville, victoire relayée).
- **Extraction carte de collision depuis la ROM** : `tools/extract-walkability.js`
  → `gamepacks/hgss/walkmask.png` (blanc = à pied, bleu = Surf, en coordonnées
  JEU/RAM). ⚠️ RE-CALIBRÉ le 2026-07-07 (session 4) : l'ancien mapping
  (DX=-54,-30 + indexation transposée, « validé 290/306 ») était FAUX — il
  s'était verrouillé sur la copie BÊTA de Doublonville présente dans la
  matrice. Modèle correct : **matrice = RAM − (0,28)** (X identique !),
  indexation row-major, praticable = `(coll & 0x80) == 0` (voir §3). Validé
  par : warp CP Doublonville, 5/5 portes Bourgeon, superposition visuelle
  walkmask/mewmaps exacte sur Doublonville, rendu identique à un export DSPRE
  de Bourgeon. **C'est la « liste des lieux jouables », extraite
  automatiquement — ne pas cartographier à la main.**
- **Extraction de tous les warps depuis la ROM** : `tools/extract-warps.js`
  → `warps.json` (1317 warps, 491 fichiers). Donne la liste des zones + toutes
  les destinations + coordonnées.
- **Automatisation BizHawk headless** : `EmuHawk.exe --lua=script.lua rom.nds` ;
  en Lua : `joypad.set`, `savestate.save/load`, `client.screenshot`,
  `client.reboot_core`, `client.exit`, `client.speedmode(800)`. Boot d'une save =
  ~200 appuis A + 15 B puis attendre. Appuis < ~30 frames peu fiables au boot.
- **Vol (Fly) du jeu** : fiable, dessert 16 villes. Séquence menu depuis le spawn
  Doublonville : `X → Down → A` (équipe) `→ Right` (Lugia) `→ Down + Left` (Ho-Oh,
  qui a Vol) `→ A → LEFT` (colonne CS) `→ A` (Vol) `→ A → A`. Le menu tactile HGSS
  se pilote au clavier : `X` pour focus, d-pad pour naviguer (curseur PERSISTANT
  entre ouvertures, colonnes bouclantes).

## 3. Formats ROM décodés (NARC, via système de fichiers NDS)

En-tête NDS : FNT à `u32[0x40]`, FAT à `u32[0x48]`. Parsing NARC (BTAF/BTNF/GMIF)
et lecture d'un fichier par chemin : voir `tools/extract-warps.js` (réutilisable).

- **Matrice monde** : NARC `a/0/4/1`, fichier 0. En-tête : `W,H,hasHeaders,hasAlt,
  nameLen`, puis (si présents) headers `W*H*u16`, altitudes `W*H*u8`, puis land IDs
  `W*H*u16`. Monde = 47×17 chunks de 32×32 tuiles.
- **Collisions (land_data)** : NARC `a/0/6/5`, un fichier par chunk. Format :
  `[4×u32 tailles][section BGS: sig 0x1234 + u16 len][2048 o = 32×32 paires
  (type, collision)]`. `collision == 0x00` = praticable.
  ⚠️ CORRIGÉ 2026-07-07 : indexation locale **row-major** `idx = ly*32 + lx`
  (PAS transposée), et décalage coord-RAM→matrice **`matrice = RAM − (0, 28)`**
  (X identique, Y décalé de 28 ; PAS -54/-30 — l'ancienne calibration collait
  à la copie bêta de Doublonville). Sémantique collision : **bit 7 = bloqué** ;
  les valeurs basses 0x00/0x02/0x04/0x06 sont praticables (vérifié : le joueur
  se tient sur des tuiles coll 0x06 place de Doublonville). Le tapis d'une
  porte = behavior porte (0x69…) + coll 0x80 (on « entre dedans », warp).
  Preuves : warp CP Doublonville events 73 matrice (352,368) = tapis RAM
  validé (352,396) ; 5/5 warps de Bourgeon sur les tuiles porte du land 0 ;
  superposition visuelle walkmask/mewmaps exacte sur Doublonville ; rendu
  identique à l'export DSPRE du chunk (21,12).
  Bourgeon en RAM : x[672,703], y[412,443] (= chunk matrice (21,12)) ; portes
  RAM : labo (684,421) et (688,420), joueur (695,424), SO (679,433),
  rival (690,435).
- **Event data (warps + NPC)** : NARC `a/0/3/2`, un fichier par map. Format :
  `[u32 BGS count][count×0x14]` `[u32 OBJ count][count×0x20]`
  `[u32 WARP count][warps]`. **Un warp = 12 octets** :
  `u32 position` (x = 16 bits bas, y = 16 bits hauts), `u16 destMap`,
  `u16 anchor`, `u32 height`. ⚠️ CORRIGÉ 2026-07-07 : les warps de l'overworld
  sont en coordonnées **MATRICE**, donc `RAM = warp + (0, 28)` (X identique —
  d'où l'ancienne note « mêmes que le miroir RAM », qui ne collait qu'en X).
  La matrice a aussi une section headers (u16 par chunk, à l'offset
  `5+nameLen`) qui donne l'ID de carte de chaque chunk (fiable pour les
  villes, parfois 0=EVERYWHERE ou le header d'une route voisine en bordure).
- **Scripts** : NARC `a/0/1/2`. **Commande Warp = opcode `0x00B0`** :
  `Warp(Flex Map ; u16 Door ; Flex X ; Flex Y ; Flex Dir)`. `Door=0` = pas
  d'animation de porte. Les args « Flex » peuvent être des **variables** →
  `Warp(var_map,0,var_x,var_y,var_dir)`. Map headers : champs `areaDataID,
  matrixID, scriptFileID, levelScriptID, eventFileID` (voir DSPRE `MapHeader.cs`).

## 4. Cartes / ancrage (pour les photos)

- `gamepacks/hgss/map.png` = carte overworld réelle (rip mewmaps, tuiles du jeu),
  **8 px/tuile** (PAS 16). ⚠️ Elle porte les **noms des lieux** (spoiler) et,
  surtout, elle colle les régions bout à bout alors que le jeu les éparpille dans
  la matrice → **pas d'alignement global unique** coord-jeu ↔ pixel. Ancrage
  vérifié SEULEMENT pour Doublonville : `tuile_carte = coord_jeu - (133,202)`.
  Pour utiliser mewmaps partout il faudrait un décalage PAR RÉGION (calage
  automatique possible par corrélation de formes ROM ↔ image).
- Idée retenue à la place : montrer au joueur de **vraies captures d'écran du
  jeu** (pas un crop de carte). Voir §6.

## 5. Assets présents dans le dossier

- ROM : `Pokemon - Version Argent SoulSilver (France)/…nds` (IPGF).
- `BizHawk-2.11.1-win-x64/` (émulateur ; sur Linux → build Linux ou Mono).
- `hgss-map-randomizer-main/` : randomizer de warps HGSS (open source :
  github.com/adrienntindall/hgss-map-randomizer). Contient dans `tools/` :
  `ndstool.exe`, `knarc.exe` (unpack/repack NARC + NDS — utiles pour patcher la ROM).
- `gamepacks/hgss/soulsilver_fullcs_FR.sav` : save 100 %, équipe avec TOUTES les
  CS, spawn propre devant le CP de Doublonville. (Installée aussi dans
  `BizHawk-.../NDS/SaveRAM/…SaveRAM`.)
- `gamepacks/hgss/walkmask.png`, `gamepacks/hgss/map.png`.

## 6. Le problème ouvert : produire la banque de photos

Pour un GeoGuessr il faut une **photo par lieu**. La victoire (coordonnées) est
réglée ; il ne reste qu'à obtenir l'image de chaque lieu. Décision produit :
**vraies captures d'écran du jeu** (authentiques), montrées zoomées → dézoomées
(recadrage progressif dans une seule capture).

Pour capturer un lieu, il faut y amener la caméra dans l'émulateur → besoin de
**téléportation**. Bilan HONNÊTE de tout ce qui a été essayé (⚠️ NE PAS refaire) :

- **Écriture de position en RAM → ÉCHEC (prouvé).** Toutes les représentations de
  la position (miroir entier vers `0x021DA716`, vecteur virgule-fixe `posVec` vers
  `0x021DA6FC`) sont en **lecture seule** : le jeu les recalcule depuis une source
  que l'écriture ne propage pas. Test de propagation (écrire 114 candidats,
  vérifier si le miroir bouge) = 0 adresse écrivable. La vraie `LocalMapObject`
  (offsets décomp : currentX +0x64, currentZ +0x6C, posVec +0x70) utilise des
  coordonnées LOCALES et n'a pas pu être épinglée de façon fiable.
- **No-wall (traverser les murs) → non trouvé.** Le code US écrit **en continu**
  `0x0200` à `0x0205DAA2` (valeur normale `0x1C20`). C'est un **patch de CODE
  spécifique à la build US**, pas une valeur RAM portable. En FR l'adresse est
  ailleurs ; test d'écriture continue sur 177+ candidats autour de l'adresse US =
  rien. Le trouver proprement = désassembler la routine de collision FR.
- **Warp par tuile → MARCHE**, mais il faut **atteindre** la tuile-porte. Or la
  navigation est bloquée par les bâtiments (d'où le besoin de no-wall). De plus,
  éditer un warp en RAM (table du fichier 73 trouvée à `0x022A1798`) ne déclenche
  RIEN si le perso n'est pas sur une tuile marquée « warp » dans les collisions,
  et l'overworld est découpé en sous-cartes : la porte que le perso emprunte
  vraiment (CP juste au nord du spawn) est dans une AUTRE table (coordonnées
  locales) que le fichier 73 (coordonnées globales).

### ✅ RÉSOLU (session 3) : téléportation universelle par patch direct des warps (méthode retenue)

**C'est la technique utilisée aujourd'hui pour tout le monde (extérieur ET
intérieur), elle a remplacé les approches ci-dessous.** Aucun repack
ndstool/knarc nécessaire : on patche directement des octets EN PLACE dans une
copie du fichier `.nds` (mêmes tailles de fichier, donc pas de recalcul FAT/FNT,
pas de recompression arm9, pas de souci de padding cartouche).

**Piège critique à ne pas refaire** : le champ `destMap` d'un warp (§3) n'est
**PAS** l'index du fichier dans le NARC `a/0/3/2` — c'est un **ID d'en-tête de
carte** (541 IDs, voir `pret/pokeheartgold include/constants/maps.h`), une
numérotation différente. Un header a un champ propre `eventsBank` qui donne le
VRAI index de fichier events. Les deux coïncident pour beaucoup d'intérieurs
mais PAS pour les cartes extérieures (ex. header 60 = MAP_NEW_BARK/Bourgeon a
`eventsBank=57`, pas 60). Confondre les deux fait atterrir sur le mauvais
header (ex. écraser `destMap` avec un index de fichier valide mais qui tombe
sur `MAP_NOTHING` → écran vide, déjà vu et corrigé cette session).

**Table des en-têtes (541 × 24 octets)** : struct `MapHeader` de
`pret/pokeheartgold include/map_header.h`, chargée en RAM à l'offset ARM9 FIXE
`0x020F6BC4` (même logique que la table de Vol ci-dessous : offset connu via
DSPRE `RomInfo.cs` → `headerTableOffset`, + `0x02000000` de base ARM9). Champ
utile à l'octet **+16** de chaque entrée : `u16 eventsBank` = vrai index dans
`a/0/3/2`. Extraction : script Lua BizHawk qui lit 541×24 octets à cette
adresse et les dump dans un fichier (boot n'importe quelle save, la table est
statique, ~120 frames d'attente après boot suffisent pour que l'ARM9 soit
décompressé en RAM). **Ne PAS lire `arm9.bin` extrait par `ndstool -x`
directement à cet offset** : il est encore compressé (BLZ), les offsets de
fichier ne correspondent qu'à la vue RAM décompressée.

**Patch d'un warp** : dans `a/0/3/2` (voir format §3), chaque warp fait 12
octets ; `destMap` est à l'offset+4, `anchor` à l'offset+6 (deux `u16` LE
consécutifs, donc patchables en une seule écriture 4 octets). Calculer
l'offset ABSOLU dans le `.nds` (FAT du fichier NARC + en-tête NARC + FAT
interne du sous-fichier + offset du warp) puis écrire directement dans une
copie du ROM. Outil complet : `tools/build-warp-tour-v2.js` (calcule tout,
sert d'exemple de référence pour ce calcul d'offset).

**Script hijack (à ÉVITER, cause des régressions non comprises)** : détourner
le script d'un PNJ/objet existant (remplacer sa liste de commandes, même avec
un mécanisme "sûr" comme `SetDynamicWarp` opcode `0xF0` au lieu d'un vrai
`Warp`) a **de nouveau cassé l'accès à Bourgeon** cette session, comme le hack
de level-script de la session précédente. Cause exacte non identifiée dans les
deux cas. **Conclusion empirique : ne plus jamais toucher aux scripts, se
limiter au patch destMap/anchor des warps** (jamais eu de régression, utilisé
des dizaines de fois cette session).

**Limite connue : écran noir à l'arrivée sur certaines cases.** Confirmé sur
Route 22 (header 27) : sa porte a 2 cases de warp quasi identiques, toutes
deux menant à l'origine au même endroit (aucune case "tampon" sans déclencheur
à proximité). Cause précise non prouvée (hypothèse : la case d'atterrissage
est aussi la case qu'on vient de détourner pour continuer la tournée, un
double déclenchement pourrait interrompre le fondu d'écran) — possiblement
apparenté à la « zone de sécurité asymétrique » déjà observée avec le hack de
Vol (voir juste en dessous). Pas de règle générale fiable trouvée pour prédire
à l'avance quelles cartes sont concernées ; on corrige au cas par cas (liste
`KNOWN_BAD_LANDING` dans l'outil, voir §7).

### Outil de tournée guidée : `tools/build-warp-tour-v2.js`

Construit une ROM où **chaque lieu réel du jeu est chaîné au suivant** via SA
PROPRE porte #0 (patch destMap/anchor ci-dessus, aucun script touché) : le
joueur entre dans le labo → atterrit lieu 1 → en ressortant (même porte) →
lieu 2 → etc., jusqu'au bouclage final vers le labo. Permet de VISITER et
capturer tout le jeu à la main (l'automatisation de la marche/du Vol s'est
révélée trop peu fiable, voir tentatives abandonnées plus bas) sans qu'il y
ait besoin de repack ROM à chaque étape.

- Usage : `node tools/build-warp-tour-v2.js <rom_source.nds> <headers_dump.bin> <rom_sortie.nds> <order.json>`
- `headers_dump.bin` = dump RAM de la table d'en-têtes ci-dessus (541×24 octets
  à `0x020F6BC4`) ; à refaire si non retrouvé (script Lua trivial, voir plus haut).
- Filtre les candidats : exclut par nom (regex : placeholders/inutilisés/
  fonctions réseau type UNION/WIFI/DIRECT2/DIRECT4/ID_MAX/UNDERGROUND), exclut
  les headers dont `eventsBank==0` (fichier vide) ou dont le fichier events n'a
  aucun warp (impasse, ne peut pas continuer la chaîne), dé-doublonne les
  headers qui partagent le même `eventsBank` (gabarits réutilisés).
- `KNOWN_BAD_LANDING` (const en tête de fichier) : IDs de header à exclure
  manuellement suite à un bug signalé en jeu (actuellement `27` = ROUTE_22,
  écran noir). **Ajouter l'ID ici et relancer l'outil** à chaque nouveau bug
  d'atterrissage signalé — c'est le mécanisme de correction prévu.
- État actuel (session 3) : 462 lieux réels chaînés, ROM générée dans
  `_capture_scratch/dspre_ui/tour_test_v3/Pokemon - Version Argent SoulSilver
  (France).nds` (même nom que la ROM réelle → association automatique avec la
  VRAIE SaveRAM du joueur : BizHawk associe une .SaveRAM a une ROM
  uniquement par nom de fichier, peu importe le dossier -- donc toujours
  deployer une ROM patchee sous le nom EXACT de la ROM originale, dans un
  dossier separe, jamais en ecrasant l'originale).
  ⚠️ PIÈGE (session 4, coûté 3 runs) : BizHawk **remplace les soulignés par
  des espaces** dans le nom qu'il utilise pour la SaveRAM : une ROM
  `Mon_Jeu.nds` cherche/écrit `Mon Jeu.SaveRAM`, PAS `Mon_Jeu.SaveRAM`. Une
  save déployée avec le souligné n'est JAMAIS lue (boot sur save vide/parasite,
  symptôme : spawn inattendu, séquences menu qui déraillent). **Ne jamais
  mettre de souligné dans le nom d'une ROM déployée** (CamelCase ok). Tournee en cours de
  vérification manuelle par l'utilisateur ; carnet de suivi (liste des lieux,
  case à cocher, progression en `localStorage` navigateur) publié en Artifact
  Claude — pas persistant dans le repo, régénérable depuis `order.json`.
- `gamepacks/hgss/map_names.json` : table `{id: NOM}` des 541 IDs de carte
  (source : `pret/pokeheartgold include/constants/maps.h`, noms anglais),
  sauvegardée dans le repo pour réemploi sans re-fetch.

### ✅ SESSION 4 : batch de production (extérieurs + intérieurs random) + découvertes RAM

**Résultats** : 740 photos extérieures (74/75 zones × 10, 0 écran noir) via
Vol ; **821 photos intérieures** (1re moitié = 193 salles, nombre PROPORTIONNEL
à la surface : maison=1, Parc Naturel=40 ; via packing = plusieurs points/salle
par boot). 17 écrans noirs restants = Phare Oliville 4F + Dôme Pokéathlon
(points tombés dans une zone vide, PAS un souci de météo) → filtrés
automatiquement à la construction du pack (`isBlack` dans build-photo-pack.js).

**✅ JEU EN LIGNE JOUABLE (vraies photos)** : mode `photo` ajouté au serveur
(`server/pack.js` : `randomTarget`/`roundCrops` ; `mode:"photo"` dans pack.json ;
`tools/build-photo-pack.js` génère `gamepacks/hgss_photos/` depuis les captures
+ coords). `config.json` pack=`hgss_photos`. Boucle complète VÉRIFIÉE au
navigateur : round = vraie capture zoomée → dézoom → victoire par coords ±marge
→ « X a trouvé en Ns » chez tous + score → round suivant. Setup multi en ligne
= tunnel (cloudflared/localtunnel) : voir `JOUER_EN_LIGNE.md`. ⚠️ Pack = EXTÉRIEURS
seulement (coords globales uniques). Intérieurs jouables = à faire (besoin de
câbler l'ID de carte lu en RAM, coords locales pas uniques).
Outils : `batch-capture.lua` (extérieurs, checkpoint), `batch-interior.lua`
(intérieurs), `gen-jobs.js`/`gen-interior-points.js`/`build-wave.js`,
`qc-inventory.js` (détection écran noir + inventaire).

**Intérieurs random loin des portes** = système de VAGUES : `gen-interior-points.js`
choisit jusqu'à 10 points/salle (flood-fill + max-min, grotte de glace 4 étages
= 30 points) ; `build-wave.js <k>` fabrique la ROM de la vague k (le k-ème point
de chaque salle injecté dans les coords du warp k%warpCount) ; on capture vague
par vague. ⚠️ **L'offset intérieur n'est PAS universel** (+28 seulement pour
certaines salles) : NE PAS exiger de coords attendues, enregistrer la **position
RAM réelle obtenue** (c'est elle qui sert à la victoire).

**⚠️ ROUTE_22 (header 27) injoignable par Vol** (repli sur la porte, écran noir
d'atterrissage) — 0 photo cette passe, nécessite la méthode warp-tour.

**✅ ID DE CARTE — RÉSOLU DÉFINITIVEMENT (session 5)** : victoire intérieur =
comparer (mapID, x, y) car les coords locales ne sont pas uniques.

⚠️⚠️ **Toutes les adresses trouvées en session 4 étaient FAUSSES** (`0x0227D460`
et les autres candidats "épinglés") : trouvées via scan pendant des
téléportations **patchées en RAM** (le mécanisme de warp qu'on manipulait
soi-même) → on retrouvait des artefacts du patch, pas la vraie variable de
jeu. Symptôme en prod : mapID toujours 0 en jeu réel (marche naturelle), donc
**tous les rounds intérieurs étaient perdus d'avance** en multijoueur. Piège
à ne plus refaire : ne JAMAIS valider une adresse RAM en la découvrant
pendant qu'on patch soi-même le mécanisme qu'on observe.

**Bonne méthode (celle qui marche)** : consulter le code décompilé
[pret/pokeheartgold](https://github.com/pret/pokeheartgold) via `gh api
search/code` (GitHub CLI, déjà authentifié) plutôt que deviner par scan pur.
Trouvé `src/field_system.c` : `static FieldSystem *sFieldSysPtr;` — un
pointeur **statique** (adresse fixe à chaque boot, contrairement au tas).
`include/field_types_def.h` donne `struct Location { int mapId; ... }`.
Chaîne : `FieldSystem = r32(sFieldSysPtr)` → `Location = r32(FieldSystem+0x20)`
→ `mapId = r32(Location+0x00)` (offset `location` dans `FieldSystem` compté à
la main depuis `include/field_system.h`, +0x20 après `unk1C`).

**Adresse statique trouvée pour la ROM FR (IPGF) : `0x021D1130`.** Méthode de
recherche : scan des 4 Mo de RAM pour toute adresse A dont la valeur double-
déréférencée (A → +0x20 → +0x0) vaut 76 (Doublonville, au spawn) ; 14
candidats bruts, filtrés à 76→185 (marche **naturelle**, aucun patch) = 13 ;
**re-testés sur un BOOT FROID complet (nouveau process EmuHawk)** : seuls 2
survivent (`0x021D1130`, `0x021D4178`) — tous les autres retombent à 0/garbage
(preuve que c'était du tas). `0x021D1130` reconfirmé sur un **3ᵉ boot froid**
avec le vrai `bridge/hgss.lua` (pas juste un script de sonde), JSON produit
`{"mapID":185,...}` en entrant naturellement au CP de Doublonville. Câblée
dans `bridge/hgss.lua` (champ `mapidPtr`, fonction `readMapId()`).

**Leçon générale à retenir pour toute future recherche d'adresse RAM** :
1. Ne jamais halluciner une adresse par scan de valeur seul, sans double-
   déréférence structurelle si on a le choix (une struct connue via décomp
   élimine 99 % des faux positifs d'un coup).
2. **Toujours valider par reboot froid complet** (nouveau process, pas juste
   `savestate.load`) avant de câbler en dur dans un script de production —
   c'est le SEUL test qui distingue une adresse statique (fiable) d'une copie
   de tas qui a l'air de marcher par coïncidence pendant une session.
3. Consulter le code source décompilé (`gh api search/code` sur
   pret/pokeheartgold, déjà authentifié dans ce projet) est plus rapide et
   plus fiable que deviner par scan pur dès qu'une struct/nom de variable
   plausible existe.

**✅ FIX GROTTES SOMBRES** : l'octet à l'offset **+20** de la struct MapHeader
(24 o) est le champ **MÉTÉO**. Grotte sombre = `0x16`/`0x17`. Le **mettre à 0**
en RAM (`0x020F6BC4 + hdr*24 + 20`, table statique) AVANT d'entrer = grotte
éclairée ET sans pluie. ⚠️ Effacer seulement le bit 0x10 laisse `0x07` = PLUIE
(erreur d'abord commise) — mettre l'octet ENTIER à 0. Inoffensif pour les
salles normales (déjà 0). Validé Tunnel Roche. Intégré à `batch-interior.lua`.
Bonus : ce même octet permet d'**identifier** à l'avance toutes les cartes à
météo/sombre (celles où +20 != 0 dans headers_dump.bin).

### ✅ RÉSOLU (session 2) : détournement de la table de Vol en RAM (ARM9)

**Aucun patch ROM nécessaire.** La table des destinations de Vol est un tableau
de données statique dans le binaire ARM9 (pas un script, pas un NARC) — trouvée
grâce à DSPRE (`DS_Map/FlyEditor/FlyEditor.cs`, `FlyTableRowHgss.cs`) :

- Offset ARM9 (FR HGSS) : `0xF9E64`. L'ARM9 se charge toujours à `0x02000000`
  (vérifié dans le header NDS de notre ROM, octet 0x28), donc adresse RAM
  **fixe et déterministe** : `0x020F9E64`. Pas besoin de recherche RAM empirique
  (contrairement au Vol/dynamicWarp ci-dessus qui échouent car transitoires).
- **30 lignes de 18 octets**, format (offsets relatifs à la ligne) :
  `u8 flagIdx` (0), `u8 flags` (1, bit0=isBlackoutSpawn bit1=isFlyPoint),
  `u16 headerGameOver` (2), `u8 localX` (4), `u8 localY` (5),
  `u16 headerFly` (6), `u16 globalX` (8), `u16 globalY` (10),
  `u16 headerUnlock` (12), `u16 unlockX` (14), `u16 unlockY` (16).
  Seules les lignes avec `isFlyPoint=true` apparaissent dans le menu Vol.
- **Validé empiriquement** : écraser `headerFly`/`globalX`/`globalY` d'une ligne
  (ex. ligne 3, normalement Écorcia, adresse `0x020F9E9A`, champs à +6/+8/+10)
  puis déclencher un Vol normal vers cette destination fait atterrir **exactement**
  aux coordonnées injectées (testé : X=425 écrit → X=425 obtenu).
  ⚠️ PRÉCISÉ 2026-07-08 : `globalX/globalY` sont en coordonnées **MATRICE**
  (RAM = matrice + (0,28)) — le test X=425 ne le voyait pas car X est
  identique dans les deux systèmes. Injecter `Y_RAM − 28`. Vérifié sur 5 vols
  automatiques : atterrissage systématiquement à (X, Y_injecté + 28) en RAM.
  Astuce robustesse (session 4) : écraser les **30 lignes** de la table d'un
  coup → plus besoin de naviguer au D-pad sur la carte de Vol, n'importe
  quelle ville sélectionnée (A→A) vole vers la cible. Le Vol lui-même
  passe par le moteur de warp officiel (chargement propre garanti).
- **Limite découverte** : le Vol valide que la destination appartient à la
  matrice extérieure. Mettre l'ID d'une carte **intérieure** (testé : labo du
  Pr Orme) fait retomber sur une position de repli fixe (~695,42x) au lieu d'y
  aller. **→ Cette technique ne couvre QUE les extérieurs** (routes, villes) ;
  pour les intérieurs voir §7.

Séquence Lua validée pour déclencher le Vol depuis le savestate hub (spawn
Doublonville, menu fermé) :
`X→Down→A` (sélecteur Pokémon, atterrit sur le 1er slot) → `Down→A` (sélectionne
Ho-Oh, ouvre son prompt d'action, curseur par défaut sur RÉSUMÉ) → `Left→A`
(saute sur la colonne des capacités de terrain, 1ère = Vol ; ouvre la carte) →
navigation D-pad jusqu'à la case cible → `A→A` (sélectionne puis confirme
« Voler jusqu'à... ? »). Attendre ~540-600 frames pour l'atterrissage complet
(passe par un état transitoire X=0,Y=0). **Attention timing** : après chaque
transition d'écran (ouverture menu/sous-menu), attendre ~40-60 frames avant le
prochain input, sinon il est ignoré (le menu Pokémon met plusieurs cycles à
charger).

Pistes explorées et abandonnées avant cette solution (pour ne pas les refaire) :
- Détourner les variables du Vol en RAM (recherche + bissection sur 14
  candidats) : toutes read-only sauf une qui déclenche un repli générique
  (695,42x) quelle que soit la valeur écrite. Cause (confirmée dans le code
  source `pret/pokeheartgold`, `CallTask_ScriptWarp`) : la destination est
  allouée sur le **tas** (`Heap_AllocAtEnd`) à chaque appel, adresse différente
  à chaque fois → aucune adresse fixe à écraser.
- `dynamicWarp` (mécanisme de Corde Sortie/Dig, `LocalFieldData.dynamicWarp`,
  confirmé dans le code source comme LE bon mécanisme théorique) : abandonné
  car son adresse RAM n'a pas pu être retrouvée empiriquement (recherche u32
  infructueuse même avec entropie élevée) — probablement un encodage
  différent de ce qui était supposé. Non poursuivi une fois la table de Vol
  trouvée (plus simple, déjà validée).

## 7. Prochaines étapes (ordre conseillé)

### ✅ SESSION 4 (2026-07-08) : capture automatique VALIDÉE pour les extérieurs

`bridge/capture-spots.lua` (copie de travail ; chemins absolus à adapter) :
**10/10 captures réussies à Bourgeon**, position exacte vérifiée en RAM à
chaque fois. Recette : boot save propre (ROM copiée sous un autre nom pour ne
pas toucher la SaveRAM de tournée du joueur) → savestate hub → pour chaque
cible : recharger le hub, écraser les **30 lignes** de la table de Vol
(`headerFly=header extérieur, X_RAM, Y_RAM−28`), séquence menu fixe
X→Bas→A→Bas→A→Gauche→A→A→A (aucune navigation D-pad sur la carte : toutes les
villes volent vers la cible), attendre position==cible stable 30 frames,
`client.screenshot`. ~30 s/lieu à speedmode 800. Les cibles sont tirées du
walkmask recalibré en excluant les tuiles-warp (atterrir dessus téléporte dans
le bâtiment). **La navigation Vol « capricieuse » de la session 3 est donc
contournée** — l'automatisation de la banque de photos est viable pour tous
les EXTÉRIEURS ; la tournée guidée (§6) reste utile pour les intérieurs.

### ✅ SESSION 4 (2026-07-08) : capture automatique des INTÉRIEURS validée

`bridge/capture-interiors.lua` : **3/3 intérieurs capturés proprement**
(CP + arène + grand magasin de Doublonville), sans dialogue. Débloque le point
« intérieurs » qui restait ouvert. Principe : la porte du CP de Doublonville
sert de **sas universel**. Recette par intérieur :
1. `savestate.load(hub)` (reset déterministe) ;
2. Vol devant la porte du CP (table de Vol détournée, cible RAM (352,397),
   header 76) ;
3. Repérer en RAM la **copie active du warp de cette porte** : motif
   `destMap=185 (B9 00) + anchor u16 + height u32 = 0`, avec le champ
   `position` juste avant == (352,368) en coords matrice. Adresse trouvée
   **déterministe** : `0x022A176C` (même savestate → même adresse à chaque
   run, malgré l'allocation heap) ;
4. Écraser `destMap` (offset+4) vers l'ID header de l'intérieur cible et
   `anchor` (offset+6) à 0 ;
5. **Entrée robuste** : marcher vers le nord en boucle (16 frames Up + 6
   neutres) jusqu'à ce que la position quitte (352,397) — un seul appui ne
   suffit pas car le perso regarde au sud après le Vol ;
6. Attendre la fin de la transition, effacer un éventuel dialogue au B,
   `client.screenshot`. Position d'arrivée = coords LOCALES de l'intérieur.

⚠️ Éviter les intérieurs à **script d'entrée** (le labo d'Orme header 61
déclenche un dialogue de Célesta/prof à l'arrivée → capture polluée). Les CP,
arènes, magasins, maisons neutres n'en ont pas. `KNOWN_BAD_ENTRY` à créer sur
le même principe que `KNOWN_BAD_LANDING`.

Reste pour industrialiser les intérieurs : (a) lister les headers
d'intérieurs valides (via `gamepacks/hgss/headers_dump.bin`, 541×24 octets, le
champ eventsBank à +16 donne le vrai fichier events → nb de warps) ;
(b) filtrer ceux à script d'entrée. Outil d'analyse : `tools/analyze-interiors.js`.

### ✅ Couvrir un intérieur SANS marcher ni no-wall (résolu session 4)

Le **no-wall reste une impasse** (§6, patch code US, adresse FR introuvable) —
ne pas y revenir. Deux leviers du jeu suffisent, prouvés :

1. **Verticalité = cartes séparées.** Étages, sous-sols, salles annexes sont
   des headers distincts (ex. grand magasin Doublonville : 7 headers 191-196 +
   200 ; grottes : Îles Écume B2F/B3F/B4F, Mont Mortar, etc.). Donc « monter
   les escaliers » = capturer chaque étage indépendamment via le sas, pas de
   navigation dans les escaliers.
2. **Multi-anchors = téléport aux points clés.** 271/470 intérieurs ont ≥2
   warps (escaliers/portes/échelles). En variant le champ **anchor** du warp
   détourné (offset+6), le perso apparaît directement à chacun de ces points,
   dispersés dans la salle. Validé sur Mont Mortar 1F (header 119, 11 anchors) :
   5 anchors → 5 positions X distinctes (20/59/34/26/45), 3 vues franchement
   différentes (rochers, bord d'eau, lac). Outil :
   `bridge/capture-interior-anchors.lua`. Démo :
   `captures_demo_interieurs/mortar_multiangles/`. Les positions locales de
   chaque anchor sont lisibles à l'avance dans `warps.json` (px,py du warp
   destination) → on peut choisir les anchors les plus écartés.
3. **d-pad court** en complément pour les micro-variations (salles petites et
   dégagées) — pas de BFS.

**Pas de caméra libre** : HGSS recale la caméra sur le perso ; déplacer le
perso (par anchor, puis d-pad) est la voie fiable.

### ✅ Points ARBITRAIRES en intérieur, loin des portes (résolu session 4, 6/6)

Les anchors natifs restent près des entrées. Pour le milieu des salles :
**patcher les COORDONNÉES des warps de l'intérieur** dans une copie ROM
(champ `position` u32, offset+0 du warp, x=16 bits bas y=16 bits hauts) vers
des tuiles praticables quelconques, puis entrer via le sas en visant ces
anchors. Validé sur Mont Mortar 1F : 6 points (jusqu'à 13 tuiles de toute
porte), 6/6 positions RAM exactes. Écriture de position RAM re-testée en
intérieur = toujours morte (le miroir « tient » mais le perso ne bouge pas à
l'écran — faux positif à connaître).

- Choix des points : `tools/pick-interior-points.js <header> <eventsBank> [N]`
  — trouve le matrixId du header par force brute (u16 pointant vers une petite
  matrice valide, souvent offset +4), extrait la collision, **flood-fill
  4-connexe depuis les warps** (sinon on ramasse des tuiles « praticables »
  parasites hors salle), sélection max-min pondérée loin des portes.
- Patch ROM : `tools/patch-interior-warps.js <rom_in> <rom_out> <bank> <x,y>...`
  (patch EN PLACE des positions des warps 0..N-1 du fichier events).
- Capture : `bridge/capture-interior-far.lua`. **Plus de Vol pour les
  intérieurs** : la save propre spawn déjà devant la porte du CP (352,397) ;
  la séquence de Vol depuis cette position laissait un menu ouvert (perso
  bloqué) — flux final : boot → hub → rescan warp porte (adresse HEAP variable
  selon le chemin de boot : 0x022A176C vu avec Vol, 0x022A1790 sans — toujours
  rescanner) → patch destMap/anchor → marcher Up en boucle (~4-7 tentatives
  avant déclenchement, boucler jusqu'au changement de position).
- **Les coords RAM intérieures = coords fichier + (0,28)**, comme l'extérieur.

### ✅ SESSION 4 (suite) : harnais de batch checkpoint/reprise + endroits clés

`bridge/batch-capture.lua` (démontré : reprise + quarantaine + arrêt) :
- `results.jsonl` = 1 ligne JSON par lieu, écrite immédiatement (checkpoint) ;
  au démarrage, les ids déjà présents sont sautés (réussis ET ratés — les
  ratés attendent des instructions humaines, pas de retry aveugle) ;
- échec → screenshot diagnostic `fail_<id>.png` + quarantaine ; **3 échecs
  consécutifs → arrêt propre + STATUS.txt** (raison, dernier job, consigne de
  reprise). Testé en vrai : 3 vols vers headers d'intérieur (repli garanti)
  → STOP avant le job suivant, reprise OK au run d'après.
- ⚠️ Le Vol n'effectue AUCUNE validation : il atterrit même hors-carte
  (testé (5,565) → « réussite » position exacte mais perso invisible/glitché
  dans les arbres). **La validité des cibles est 100 % la responsabilité du
  générateur** (tuiles praticables uniquement) ; la vérification de position
  ne détecte pas une cible mal choisie.

`tools/pick-interior-points.js` = sélection par **max-min distance** (points
bien répartis, loin des portes) sur la zone accessible (flood-fill). C'est la
version validée end-to-end (Mont Mortar 6/6).

Note (piste écartée le 2026-07-08 à la demande de l'utilisateur : « pas
besoin des endroits clés ») : la section OBJ du fichier events (entrées de
0x20 octets, **x à +0x18, y à +0x1A** — validés sur CP/labo/maison) donne les
positions des PNJ/objets. Un sélecteur ciblant ces points avait été essayé
puis **retiré** ; le tool est revenu au max-min. `tools/find-npc-offsets.js`
garde la validation des offsets si on veut y revenir un jour.

Pivot décidé en session 3 (contexte historique) : après plusieurs échecs
d'automatisation fiable (navigation Vol par menu trop capricieuse en timing,
BFS à pied 108 murs sur 130 pas, hijack de script qui casse Bourgeon), la
stratégie retenue était que **l'utilisateur parcourt lui-même la tournée
guidée** (§6, `build-warp-tour-v2.js`) en jeu — toujours vrai pour les
intérieurs, remplacé par le Vol détourné pour les extérieurs.

1. **En cours** : vérification manuelle de la tournée (462 lieux). L'utilisateur
   joue avec la ROM `tour_test_v3`, signale les écrans noirs/bugs d'atterrissage
   par le nom du lieu affiché juste avant ; corriger en ajoutant l'ID de header
   fautif à `KNOWN_BAD_LANDING` dans `tools/build-warp-tour-v2.js` et relancer
   l'outil (nouvelle ROM `tour_testN`, carnet republié). Ne PAS reprendre les
   pistes d'automatisation Vol/BFS/script abandonnées ci-dessus.
2. Une fois la tournée jouable de bout en bout : décider du mode de capture
   (probablement des captures d'écran manuelles prises par l'utilisateur à
   chaque étape, position lue automatiquement en RAM comme au §2 — reste à
   implémenter un petit outil qui associe capture + position + ID de lieu).
3. Remplir `gamepacks/hgss/pack.json` : `playable` = vraies zones (dérivées de
   `walkmask.png`) ; gérer la détection intérieur/faux positifs.
4. Système de photos côté serveur : stocker `{image, coord}` par lieu ; le round
   montre l'image recadrée (zoom→dézoom) ; victoire = coord du joueur ± marge.

## 8. Notes portage Windows → Linux

- Le **serveur Node** et les **outils `tools/`** sont cross-platform (chemins
  relatifs / passés en argument). Les scripts jetables dans `scratchpad/` sont en
  chemins absolus Windows → à réécrire.
- **BizHawk** : prendre la build Linux (ou via Mono). Les scripts Lua utilisent
  des chemins absolus → à adapter.
- Régénérer les données dérivées sur place :
  `node tools/extract-walkability.js "<rom.nds>"` et
  `node tools/extract-warps.js "<rom.nds>" warps.json`.
- La save va dans le dossier SaveRAM de BizHawk avec le nom exact de la ROM +
  extension `.SaveRAM`, ou charger via l'UI.
