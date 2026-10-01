# Film de lancement WikiRemastered

Un film de 44 secondes (1920 × 1080, 60 i/s, son stéréo), fait entièrement en code avec [Remotion](https://www.remotion.dev) : les scènes en 3D sont en Three.js, l’ouverture de paquet est filmée depuis l’extension elle-même, image par image, et la musique est synthétisée en JavaScript.

| Temps | Scène | Ce qui se passe |
| --- | --- | --- |
| 0:00 | **Ouverture (3D)** | La pièce verte tombe du noir et se pose. Un sol de pièces qui s’emboîtent monte autour d’elle en vague, puis redescend. Le W et le + se posent sur la pièce, les deux mots montent à côté : le logo du menu, sur deux lignes. |
| 0:06 | **Le paquet (filmé)** | L’ouverture réelle de l’extension, avec le paquet globe (le design par défaut), dans le labo, cartes aux vraies images : un clic sur « Ouvrir le paquet », les ciseaux, la lumière, les cartes. La caméra s’approche sur la découpe et sur la légendaire. « Ouvrir un paquet devient un moment. » |
| 0:21 | **Design (filmé)** | Trois clics sur « Changer de design » : le paquet fait un tour à chaque fois, du globe au puzzle, au vert, puis au foil sombre. |
| 0:25 | **Collection +** | Les doublons s’empilent sur leur premier exemplaire, avec les vues sur 30 jours et le prix estimé. |
| 0:29 | **Défausse groupée** | Les cartes que personne ne regarde sont marquées, favoris et échanges restent protégés. Un clic, elles partent. |
| 0:33 | **Marché +** | Des mots-clés, un plafond par carte et un budget : la session s’active et les cartes qui correspondent reçoivent leur enchère l’une après l’autre, en lot. |
| 0:37 | **Fin (3D)** | Un sol de toutes les couleurs, « Tout s’emboîte. », puis le logo et le Chrome Web Store. |

## Refaire le film

```bash
npm install
npm run capture   # filme l'ouverture et le changement de design depuis le labo (Chrome, réseau)
npm run render    # repères, musique, puis rendu dans out/wikiremastered.mp4
```

`npm run studio` ouvre l’aperçu interactif.

- **Captures** : `scripts/capture.mjs` sert le dépôt, ouvre `scripts/opening-lab.html` (le labo d’ouverture, avec un paquet dont les cinq cartes ont leur image Wikipédia) dans Chrome sans interface, et prend chaque image à 2× (1440 × 810). La page tourne sur un temps virtuel (`scripts/virtual-time.js`) : horloges, minuteurs, `requestAnimationFrame` et toutes les animations n’avancent que d’1/60 s par image, quelle que soit la durée de la capture. Les clics sont de vrais événements. Les images arrivent dans `public/capture/` (environ 1 Go, hors Git).
- **Montage** : `src/edit.ts` découpe les prises en morceaux joués chacun à sa vitesse.
- **3D** : `src/three/` extrude les pièces, les lettres, le W et le + à partir des contours de la marque (`scripts/brand.mjs`, via `scripts/assets.mjs`), avec les deux tons de la marque et un grain d’impression.
- **Cartes** : `src/cards/` reproduit la carte du jeu comme l’ouverture la dessine (cadres du site, images de Wikimedia Commons, chargées pendant le rendu).
- **Son** : `scripts/cues.mjs` écrit tous les repères du film (`out/cues.json`) à partir de la timeline, du montage et du journal de capture ; `scripts/soundtrack.mjs` en tire la musique et les effets, calés à l’image près.
- **Relecture** : `sh scripts/stills.sh out/stills 30 600 1028` rend quelques images, `python3 scripts/sheet.py out/stills out/sheet.jpg` en fait une planche.
- **Fluidité** : `node scripts/perf.mjs` mesure en temps réel les images par seconde de chaque moment de l’ouverture, avec le GPU ou, avec `software`, comme sans accélération matérielle ; `SHOTS=<dossier>` garde une capture de chaque moment.
