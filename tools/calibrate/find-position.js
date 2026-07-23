/* =============================================================================
   CALIBRATION — trouver la LECTURE DE POSITION (X, Y) d'un jeu DS Pokémon
   dans l'émulateur navigateur (WebMelon / DS Anywhere) du site.
   -----------------------------------------------------------------------------
   Game-AGNOSTIQUE : marche pour HGSS, Platine, Noir/Blanc, etc. Le principe ne
   dépend pas du jeu ; seules les ADRESSES trouvées en sortie sont spécifiques.

   À COLLER dans la console du navigateur (F12) sur la page de jeu, PENDANT que
   tu es EN JEU dans l'overworld, sur un coin bien dégagé. Le script fait marcher
   le perso tout seul (pas besoin du clavier) et repère les valeurs u16 qui
   suivent le déplacement = les coordonnées X / Y.

   MÉTHODE (voir docs/PORTAGE-NOUVEAU-JEU.md) :
   1. Trouver la base RAM DS dans le heap WASM = l'offset qui contient le plus de
      pointeurs vers le heap (0x0208_0000..0x0230_0000). (Le gamecode existe en
      double dans la ROM chargée en mémoire → ne PAS prendre le 1er match.)
   2. Injecter les commandes D-pad via WebMelon._internal.emulatorButtonInput
      (le clavier depuis la console ne passe pas : problème de focus).
   3. Comparer la RAM (vue Uint16) avant/après chaque direction : X monte à
      droite / descend à gauche (Y stable) ; Y monte en bas / descend en haut.
   4. Le pointeur STATIQUE stable vers l'objet joueur se trouve ensuite avec
      find-mapid.js (remontée de pointeurs) en ciblant la valeur X ou Y connue.

   Sortie : les adresses (heap) qui portent X et Y, + leur écart (utile pour
   retrouver la structure). Relance-le à un 2e endroit pour confirmer.
   ============================================================================= */
(async () => {
  const HDR = 0x3FFE0C, RAM = 0x400000, BASE = 0x02000000, MASK = RAM - 1, LEN = 0x400000;
  const H = window.Module && window.Module.HEAPU8;
  const W = window.WebMelon && window.WebMelon._internal;
  if (!H || !W) { console.log('❌ Émulateur pas prêt (charge la ROM, fais Continuer).'); return; }

  // --- 1. base RAM = candidat "gamecode" avec le plus de pointeurs vers le heap ---
  // Header cartouche à base+0x3FFE0C : 4 caractères ASCII majuscules/chiffres.
  const isCode = (p) => { for (let i=0;i<4;i++){ const c=H[p+i]; if(!((c>=0x41&&c<=0x5A)||(c>=0x30&&c<=0x39))) return false; } return true; };
  const bases = [];
  for (let p = 0; p < H.length - 4; p++) { if (isCode(p)) { const b = p - HDR; if (b >= 0 && b + RAM <= H.length) bases.push(b); } }
  const heapPtrs = (b) => { let n=0; for (let a=0;a<LEN;a+=64){ const o=b+a; const v=(H[o]|H[o+1]<<8|H[o+2]<<16|H[o+3]<<24)>>>0; if(v>=0x02080000&&v<0x02300000)n++; } return n; };
  let base = bases[0], best = -1; for (const b of bases) { const n = heapPtrs(b); if (n > best) { best = n; base = b; } }
  if (base === undefined) { console.log('❌ base RAM introuvable — es-tu bien en jeu ?'); return; }
  if (base % 2) base--; // alignement pour la vue Uint16
  const U16 = new Uint16Array(H.buffer, base, LEN / 2);
  const daddr = (i) => BASE + 2 * i;
  const gc = String.fromCharCode(H[base+HDR],H[base+HDR+1],H[base+HDR+2],H[base+HDR+3]);
  console.log('gamecode =', gc, ' base =', base, ' pointeurs-heap =', best);

  // --- 2. marche automatique (injection D-pad, sans clavier) ---
  const BIT = { R:1<<4, L:1<<5, U:1<<6, D:1<<7 };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const hold = async (bit, ms) => { const t=Date.now(); while(Date.now()-t<ms){ W.emulatorButtonInput|=bit; await sleep(20);} W.emulatorButtonInput&=~bit&0xfff; await sleep(300); };
  const snap = () => U16.slice();

  console.log('Le perso marche tout seul (~12 s), ne touche à rien…');
  const S0 = snap(); await hold(BIT.R, 2500); const S1 = snap(); await hold(BIT.L, 2500); const S2 = snap();
  await hold(BIT.D, 2500); const S3 = snap(); await hold(BIT.U, 2500); const S4 = snap();

  // --- 3. valeurs qui montent à droite / redescendent à gauche = X ; idem D/U = Y ---
  const sm = (v, lo, hi) => v >= lo && v <= hi;
  const Xs = [], Ys = [];
  for (let i = 0; i < U16.length; i++) {
    const v0=S0[i], v1=S1[i], v2=S2[i], v3=S3[i], v4=S4[i];
    if (v0 < 1 || v0 > 4000) continue; // coords plausibles (matrice monde)
    if (sm(v1-v0,1,30) && sm(v1-v2,1,30) && Math.abs(v3-v2)<=1 && Math.abs(v4-v2)<=1) Xs.push(i);
    if (Math.abs(v1-v0)<=1 && Math.abs(v2-v0)<=1 && sm(v3-v2,1,30) && sm(v3-v4,1,30)) Ys.push(i);
  }
  const Yset = new Set(Ys);
  console.log('X-adresses:', Xs.length, Xs.slice(0,8).map(i=>'0x'+daddr(i).toString(16)));
  console.log('Y-adresses:', Ys.length, Ys.slice(0,8).map(i=>'0x'+daddr(i).toString(16)));
  console.log('== paires plausibles (X, Y de la même structure) ==');
  for (const xi of Xs.slice(0,12)) {
    const Xa = daddr(xi);
    // Y attendu à un petit offset négatif de X (sur HGSS: X=struct+2, Y=struct-0xE, écart 0x10)
    for (let off = 4; off <= 0x20; off += 2) {
      const yi = (Xa - off - BASE) / 2;
      if (Number.isInteger(yi) && Yset.has(yi)) { console.log('  X=0x'+Xa.toString(16)+'  Y=0x'+(Xa-off).toString(16)+'  (écart 0x'+off.toString(16)+')'); break; }
    }
  }
  console.log('=== fin — note X (et Y) puis lance find-mapid.js en ciblant cette valeur X pour trouver le POINTEUR STATIQUE stable ===');
})();
