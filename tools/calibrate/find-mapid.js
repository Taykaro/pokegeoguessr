/* =============================================================================
   CALIBRATION — trouver un POINTEUR STATIQUE STABLE vers une valeur connue
   (typiquement le mapID, mais marche pour la position aussi) dans l'émulateur
   navigateur (WebMelon) du site.
   -----------------------------------------------------------------------------
   Game-AGNOSTIQUE. Principe : tu CONNAIS la valeur cible à l'endroit courant
   (ex. le mapID que la version FR affiche : va au même endroit sur les 2 versions,
   la numérotation des maps est identique entre régions). Le script :
   1. liste toutes les adresses qui contiennent cette valeur ;
   2. REMONTE les pointeurs (avec tolérance d'offset) jusqu'à des globals ;
   3. après un changement de map, ne garde que les chemins qui donnent la NOUVELLE
      valeur attendue -> ce sont les accès STABLES.
   Puis vérifie la stabilité ENTRE PARTIES (recharge la page et re-teste) : seuls
   les globals de la section DONNÉES statique tiennent ; la zone dynamique bouge.

   Réglages ci-dessous : TARGET_A (valeur à l'endroit 1), TARGET_B (à l'endroit 2).
   Ex. HGSS Doublonville : centre = 185, extérieur = 76.

   ⚠️ Le forward-eval applique les offsets dans l'ordre [anchor -> valeur].
   Bug classique (déjà payé) : les appliquer à l'envers => 0 résultat sur les
   chaînes à plusieurs offsets. Voir fwd() ci-dessous.
   ============================================================================= */
(async () => {
  // ---- RÉGLAGES ----
  const TARGET_A = 185;   // valeur connue à l'endroit de départ (ex. mapID intérieur)
  const TARGET_B = 76;    // valeur connue au 2e endroit (ex. mapID extérieur)
  const MAXOFF   = 0x1000; // tolérance d'offset à chaque saut (tableaux indexés)
  const MAXDEPTH = 4;      // profondeur de remontée
  // Zone où chercher un "global" candidat. Ajuster selon le jeu ; les globals
  // STABLES sont plutôt bas (section données). On élargit puis on trie.
  const ANCHOR_LO = 0x02040000, ANCHOR_HI = 0x02290000;

  const HDR=0x3FFE0C, RAM=0x400000, BASE=0x02000000, SIZE=0x400000, LEN=0x400000;
  const H = window.Module && window.Module.HEAPU8;
  const W = window.WebMelon && window.WebMelon._internal;
  if (!H) { console.log('❌ Émulateur pas prêt.'); return; }
  const isCode = (p)=>{ for(let i=0;i<4;i++){ const c=H[p+i]; if(!((c>=0x41&&c<=0x5A)||(c>=0x30&&c<=0x39)))return false; } return true; };
  const bases=[]; for(let p=0;p<H.length-4;p++){ if(isCode(p)){ const b=p-HDR; if(b>=0&&b+RAM<=H.length)bases.push(b);} }
  const heapPtrs=(b)=>{ let n=0; for(let a=0;a<LEN;a+=64){ const o=b+a; const v=(H[o]|H[o+1]<<8|H[o+2]<<16|H[o+3]<<24)>>>0; if(v>=0x02080000&&v<0x02300000)n++; } return n; };
  let base=bases[0],best=-1; for(const b of bases){ const n=heapPtrs(b); if(n>best){best=n;base=b;} }
  const u32=(a)=>{ const o=base+((a-BASE)&(RAM-1)); return (H[o]|H[o+1]<<8|H[o+2]<<16|H[o+3]<<24)>>>0; };
  const inHeap=(p)=>p>=0x02080000&&p<0x02300000;
  const ANCHOR=(a)=>a>=ANCHOR_LO&&a<ANCHOR_HI;
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

  // Remontée : depuis les adresses = TARGET_A, trouve des globals + la chaîne d'offsets.
  const markT=new Int32Array(SIZE);
  let frontier=[]; for(let a=BASE;a<0x02400000;a+=4){ if(u32(a)===TARGET_A) frontier.push([a,[]]); }
  console.log('valeur',TARGET_A,'à',frontier.length,'adresses — remontée…');
  const anchors=[]; const seen=new Set();
  for(let depth=1; depth<=MAXDEPTH && frontier.length; depth++){
    markT.fill(0);
    for(const [T] of frontier){ const b=T-BASE; for(let d=0;d<=MAXOFF;d+=4){ const i=b-d; if(i>=0&&i<SIZE) markT[i]=T; } }
    const chainOf=new Map(frontier.map(([T,c])=>[T,c]));
    const next=[];
    for(let P=BASE;P<0x02400000;P+=4){ const v=u32(P); if(v<BASE||v>=BASE+SIZE)continue; const T=markT[v-BASE]; if(!T)continue; if(seen.has(P))continue; seen.add(P);
      const chain=[T-v,...(chainOf.get(T)||[])]; if(ANCHOR(P)) anchors.push([P,chain]); next.push([P,chain]); }
    frontier=next.length>8000?next.slice(0,8000):next;
  }
  // fwd : applique les offsets du côté ANCHOR vers la VALEUR (ordre correct !).
  const fwd=(a,c)=>{ let p=u32(a); for(let i=0;i<c.length-1;i++){ p=u32(p+c[i]); if(!inHeap(p))return null; } return u32(p+c[c.length-1]); };

  console.log('anchors:',anchors.length,'\n>>> VA AU 2e ENDROIT (valeur attendue',TARGET_B,') — 12 s, ne bouge plus ensuite <<<');
  await sleep(12000);
  const good = anchors.filter(([A,c]) => fwd(A,c) === TARGET_B);
  good.sort((a,b)=>a[0]-b[0]); // les plus bas d'abord (plus souvent des globals stables)
  console.log('=== chemins qui donnent',TARGET_A,'(endroit 1) ET',TARGET_B,'(endroit 2) ===', good.length);
  for(const [A,c] of good.slice(0,25)) console.log('  0x'+A.toString(16)+'  offsets['+c.map(o=>'0x'+o.toString(16)).join(',')+']');
  console.log('=== fin ===');
  console.log('➡️ VÉRIFIE LA STABILITÉ : recharge la page, reviens à l\'endroit 1, et teste');
  console.log('   fwd(anchor, offsets) sur quelques candidats -> ceux qui redonnent',TARGET_A,'sont STABLES entre parties.');
  console.log('   Garde ceux à adresse BASSE (section données). Intègre-les comme mapReaders (voir play.html).');
})();
