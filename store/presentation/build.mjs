/* Builds store/presentation/presentation.html, the first image of the Chrome Web Store listing
 * (1280 × 800), which render.sh then shoots:
 *   node store/presentation/build.mjs && sh store/presentation/render.sh
 *
 * A bento of five tiles, each a sheet of printed paper in one of the drawn packs' colours, with
 * their grain. On each, the feature as it really looks: the packs and the cards of the game, the
 * extension's own controls, and the 3D jigsaw pieces and satin ribbons of the opening, drawn with
 * the packs' kit (scripts/pack-art-kit.mjs). Edit this script, not the HTML.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dotAt, drawPiece, f, jitter, random, reseed, ringAt, solid, sparkle, star } from '../../scripts/pack-art-kit.mjs';

const OUT = fileURLToPath(new URL('presentation.html', import.meta.url));
const SITE = 'https://www.wiki-masters.com';
const commons = path => `https://upload.wikimedia.org/wikipedia/commons/thumb/${path}`;

/* ─── Palette: the packs' papers and inks ───────────────────────────────── */

const PAGE = '#efe8da';
const INK = '#1d2640';
const CREAM = '#fff6e3';
const RED = '#ff4a3d';
const PAPERS = {
  indigo: { paper: '#3b2bbd', deep: '#2a1d92', specks: '#1b1170', light: '#6a5cf0' },
  pink: { paper: '#ff9dc1', deep: '#ee79a6', specks: '#c4517f', light: '#ffe3ee' },
  marigold: { paper: '#ffc53a', deep: '#efa61f', specks: '#b8740c', light: '#fff1c9' },
  green: { paper: '#1f9a68', deep: '#167a52', specks: '#0c5a3b', light: '#4fbf8b' },
  cream: { paper: '#f8f2e5', deep: '#e6dac2', specks: '#a8987a', light: '#ffffff' },
};
const PIECE = {
  gold: { face: '#ffd84f', side: '#e9a81f', deep: '#b97a10' },
  pink: { face: '#ff94bb', side: '#ea6b98', deep: '#c94f7c' },
  jade: { face: '#3fd18e', side: '#23a06a', deep: '#17744c' },
  blue: { face: '#7cb4ff', side: '#4f86e2', deep: '#3060b6' },
  coral: { face: '#ff5446', side: '#dc3a31', deep: '#b12a26' },
  violet: { face: '#8a78ff', side: '#6552e0', deep: '#4532b8' },
  cream: { face: '#fff2d2', side: '#f1d49a', deep: '#d9b36c' },
};
const RARITY = {
  C: { frame: '/commun.png', chip: '#b8f2d5' },
  PC: { frame: '/peu_commun.png', chip: '#b1cff2' },
  R: { frame: '/rare.png', chip: '#c6a7f2' },
  SR: { frame: '/super_rare.png', chip: '#ed6fa3' },
  L: { frame: '/legendaire.png', chip: '#ffe144' },
};
const CARDS = {
  muraille: { rarity: 'L', title: 'Grande Muraille', line: 'fortifications de la frontière nord de la Chine', image: `${SITE}/cards/grande-muraille.jpg`, atk: '8 970', def: '6 120' },
  fuji: { rarity: 'PC', title: 'Mont Fuji', line: 'volcan au sud-ouest de Tokyo, au Japon', image: commons('c/cd/Fuji_Kawaguchi_357.JPG/500px-Fuji_Kawaguchi_357.JPG'), atk: '3 254', def: '4 352' },
  saturne: { rarity: 'R', title: 'Saturne (planète)', line: 'sixième planète du Système solaire', image: commons('c/c7/Saturn_during_Equinox.jpg/500px-Saturn_during_Equinox.jpg'), atk: '5 090', def: '7 780' },
  crabe: { rarity: 'SR', title: 'Nébuleuse du Crabe', line: 'rémanent de supernova, dans le Taureau', image: commons('0/00/Crab_Nebula.jpg/500px-Crab_Nebula.jpg'), atk: '6 222', def: '5 935' },
};

// Icons from the extension (Lucide), drawn in the badge's ink.
const ICON = {
  palette: '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>',
  eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  gavel: '<path d="m14.5 12.5-8 8a2.119 2.119 0 1 1-3-3l8-8"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/>',
  swords: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};
const icon = (name, size = 18, width = 2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

/* ─── Drawing helpers ───────────────────────────────────────────────────── */

const hex = value => value.replace('#', '').match(/../g).map(part => parseInt(part, 16));
const toHex = rgb => `#${rgb.map(value => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
const mix = (a, b, t) => toHex(hex(a).map((value, index) => value + (hex(b)[index] - value) * t));
const smooth = t => t * t * (3 - 2 * t);

/* A satin ribbon behind a flying piece, as in the opening: a band that twists along its path,
   bright where its face turns to us, darker on its back, thin at its tail and full at its head.
   `path` gives the centre at t (0 at the tail, 1 at the head) and its depth (> 0: in front of
   the pack). Each stretch is opaque and sealed by its own colour, so no seam shows; a stroke of
   light runs along the edge of the widest stretches, by hand. Returns { back, front } markup. */
function ribbon(path, { width, ink, turns = 1.3, phase = 0, taper = .18, steps = 150 }) {
  const samples = Array.from({ length: steps + 1 }, (_, k) => {
    const t = k / steps;
    const [x, y, depth = -1] = path(t);
    return { t, x, y, depth };
  });
  samples.forEach((sample, k) => {
    const a = samples[Math.max(0, k - 1)];
    const b = samples[Math.min(steps, k + 1)];
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    sample.nx = -(b.y - a.y) / length;
    sample.ny = (b.x - a.x) / length;
    const twist = Math.cos(phase + Math.PI * 2 * turns * sample.t);
    sample.twist = twist;
    sample.half = width / 2 * (taper + (1 - taper) * smooth(Math.min(1, sample.t * 1.25))) * twist;
  });
  const out = { back: [], front: [] };
  for (let k = 0; k < steps; k += 1) {
    const a = samples[k];
    const b = samples[k + 1];
    const twist = (a.twist + b.twist) / 2;
    const color = twist > .55 ? ink.face : twist > 0 ? ink.side : twist > -.55 ? ink.deep : mix(ink.deep, ink.side, .35);
    const quad = [
      [a.x + a.nx * a.half, a.y + a.ny * a.half], [b.x + b.nx * b.half, b.y + b.ny * b.half],
      [b.x - b.nx * b.half, b.y - b.ny * b.half], [a.x - a.nx * a.half, a.y - a.ny * a.half],
    ];
    const d = `M${quad.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L')} Z`;
    out[(a.depth + b.depth) / 2 > 0 ? 'front' : 'back'].push(`<path d="${d}" fill="${color}" stroke="${color}" stroke-width=".9" stroke-linejoin="round"/>`);
  }
  // The light along the edge that faces up, on the stretches that face us fully.
  let run = [];
  const flush = layer => {
    if (run.length > 4) out[layer].push(`<path d="M${run.map(([x, y]) => `${f(x)} ${f(y)}`).join(' L')}" fill="none" stroke="#fff8e7" stroke-opacity=".9" stroke-width="${f(width * .13)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    run = [];
  };
  let layer = 'back';
  for (const sample of samples) {
    const here = sample.depth > 0 ? 'front' : 'back';
    if (here !== layer) { flush(layer); layer = here; }
    if (sample.twist > .8 && sample.t > .22) {
      const side = sample.ny < 0 ? 1 : -1; // The edge on the upper side.
      run.push([sample.x + sample.nx * sample.half * .55 * side, sample.y + sample.ny * sample.half * .55 * side]);
    } else flush(layer);
  }
  flush(layer);
  return out;
}

// A cubic Bézier, as a ribbon's path, at one depth.
const curve = (p0, p1, p2, p3, depth = -1) => t => {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    depth,
  ];
};
// A stretch of an orbit (an ellipse seen from a little above, tilted): its far half is behind.
const orbit = ({ cx, cy, rx, ry, tilt, from, to }) => t => {
  const angle = from + (to - from) * t;
  const x = rx * Math.cos(angle);
  const y = ry * Math.sin(angle);
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  return [cx + x * c - y * s, cy + x * s + y * c, Math.sin(angle)];
};

// A piece of the opening: its id, outline tabs, size, place, turn and ink.
let pieceCount = 0;
function piece({ tabs = [1, -1, 1, 1], size, at, turn, ink, thick = .32 }) {
  pieceCount += 1;
  return drawPiece(solid({ id: `p${pieceCount}`, tabs, size, at, turn, ink, thick }));
}

// Printed: specks of ink, dark and light, over what is drawn (and only there).
function printed(id, width, height, { dark, light, density = 1 }) {
  const [dr, dg, db] = hex(dark).map(value => (value / 255).toFixed(3));
  const [lr, lg, lb] = hex(light).map(value => (value / 255).toFixed(3));
  const cut = (8.1 - (density - 1) * 1.2).toFixed(2);
  return `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}">
      <feTurbulence type="fractalNoise" baseFrequency=".62" numOctaves="2" seed="${4 + pieceCount}" stitchTiles="stitch" result="n1"/>
      <feColorMatrix in="n1" values="0 0 0 0 ${dr}  0 0 0 0 ${dg}  0 0 0 0 ${db}  0 0 0 11 -${cut}" result="dark"/>
      <feTurbulence type="fractalNoise" baseFrequency=".7" numOctaves="2" seed="${11 + pieceCount}" stitchTiles="stitch" result="n2"/>
      <feColorMatrix in="n2" values="0 0 0 0 ${lr}  0 0 0 0 ${lg}  0 0 0 0 ${lb}  0 0 0 -11 2.7" result="light"/>
      <feTurbulence type="fractalNoise" baseFrequency=".035" numOctaves="2" seed="3" result="n3"/>
      <feColorMatrix in="n3" values="0 0 0 0 ${dr}  0 0 0 0 ${dg}  0 0 0 0 ${db}  0 0 0 .5 -.2" result="tooth"/>
      <feMerge result="ink"><feMergeNode in="tooth"/><feMergeNode in="dark"/><feMergeNode in="light"/></feMerge>
      <feComposite in="ink" in2="SourceAlpha" operator="in" result="inked"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="inked"/></feMerge>
    </filter>`;
}

// A layer of drawing over a tile, printed like the paper.
function layer(name, width, height, paper, body, z = 1) {
  const id = `print-${name}`;
  return `<svg class="layer" style="z-index:${z}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${printed(id, width, height, paper)}</defs><g filter="url(#${id})">${body}</g></svg>`;
}

/* ─── Components ────────────────────────────────────────────────────────── */

// A card of the game, as the opening draws it (the site's frame and picture).
function card(key, { width, style = '', className = '' } = {}) {
  const c = CARDS[key];
  const r = RARITY[c.rarity];
  return `<div class="card ${className}" style="width:${width}px;${style}"><div class="face">
      <img class="frame" src="${SITE}${r.frame}" alt="">
      <div class="art"><img src="${c.image}" alt="" referrerpolicy="no-referrer"></div>
      <span class="chip" style="background:${r.chip}">${c.rarity}</span>
      <div class="body"><h3>${c.title}</h3><p>${c.line}</p><div class="stats"><span class="atk">${icon('swords', 10, 2.4)}${c.atk}</span><span class="def">${icon('shield', 10, 2.4)}${c.def}</span></div></div>
    </div></div>`;
}
const pack = (name, { width, style = '', className = '' }) => `<img class="pack ${className}" src="../images/designs/pack-${name}.png" alt="" style="width:${width}px;${style}">`;
const back = (name, { width, style = '' }) => `<img class="back" src="../images/designs/back-${name}.png" alt="" style="width:${width}px;${style}">`;

function tile({ name, x, y, width, height, paper, title, text, glyph, dark = false, content = '', decor = '', front = '' }) {
  const p = PAPERS[paper];
  const head = glyph
    ? `<header><span class="badge">${icon(glyph, 20)}</span><div><h2>${title}</h2><p>${text}</p></div></header>`
    : '';
  return `<section class="tile ${name}${dark ? ' dark' : ''}" style="left:${x}px;top:${y}px;width:${width}px;height:${height}px;--paper:${p.paper};--deep:${p.deep}">
    ${layer(`${name}-paper`, width, height, { dark: p.specks, light: p.light, density: 1 }, `<rect width="${width}" height="${height}" fill="${p.paper}"/>${decor}`, 0)}
    ${head}
    ${content}
    ${front ? layer(`${name}-front`, width, height, { dark: p.specks, light: p.light }, front, 6) : ''}
  </section>`;
}

/* ─── The tiles ─────────────────────────────────────────────────────────── */

reseed(2026);
const GAP = 14;
const PAD = 20;
const HERO = { x: PAD, y: PAD, width: 470, height: 800 - PAD * 2 };
const RIGHT = HERO.x + HERO.width + GAP;
const ROW = (800 - PAD * 2 - GAP) / 2;

/* The opening: the globe pack, torn open, the legendary card rising out of it, and the pieces
   flying round on their ribbons, one of them making a full lap round the cards. Below the logo,
   cut by the bottom of the tile, as large as it can be. */
const PACK = { width: 244, left: 112, top: 410, turn: -4 }; // In the tile.
PACK.height = PACK.width * 2000 / 1280;
const TEAR = 9.4; // The torn line, in % of the pack (just under the crimped strip).
const tear = Array.from({ length: 41 }, (_, k) => {
  const x = 2 + k * 2.4;
  return [x, TEAR + Math.sin(k * 1.7) * .22 + jitter(.32)];
});
const tornClip = `polygon(0% ${f(tear[0][1])}%, ${tear.map(([x, y]) => `${f(x)}% ${f(y)}%`).join(', ')}, 100% ${f(tear.at(-1)[1])}%, 100% 100%, 0% 100%)`;
const mouthClip = `polygon(${tear.map(([x, y]) => `${f(x)}% ${f(y - 2.6 + jitter(.25))}%`).join(', ')}, ${[...tear].reverse().map(([x, y]) => `${f(x)}% ${f(y + .2)}%`).join(', ')})`;
const mouthY = PACK.top + PACK.height * TEAR / 100;
const packCx = PACK.left + PACK.width / 2;

const heroRibbons = [
  // Gold: the best card's piece, one full lap round the cards.
  { r: ribbon(orbit({ cx: packCx + 6, cy: mouthY + 40, rx: 214, ry: 62, tilt: -.16, from: -1.62, to: 2.62 }), { width: 22, ink: PIECE.gold, turns: 2.2, phase: .4 }), at: orbit({ cx: packCx + 6, cy: mouthY + 40, rx: 214, ry: 62, tilt: -.16, from: -1.62, to: 2.62 })(1), size: 64, ink: PIECE.gold, turn: [.55, -.5, -.4], tabs: [1, -1, 1, 1] },
  { r: ribbon(curve([packCx - 20, mouthY + 10], [packCx - 60, mouthY - 120], [80, mouthY - 30], [62, mouthY - 128]), { width: 15, ink: PIECE.pink, turns: 1.6, phase: 1.1 }), at: [62, mouthY - 128], size: 46, ink: PIECE.pink, turn: [-.4, .6, .5], tabs: [-1, 1, 1, -1] },
  { r: ribbon(curve([packCx + 30, mouthY + 10], [packCx + 70, mouthY - 140], [400, mouthY - 30], [404, mouthY - 150]), { width: 13, ink: PIECE.jade, turns: 1.4, phase: 2 }), at: [404, mouthY - 150], size: 40, ink: PIECE.jade, turn: [.3, .7, .9], tabs: [1, 1, -1, 1] },
  { r: ribbon(curve([packCx + 40, mouthY + 60], [packCx + 120, mouthY + 80], [470, mouthY + 120], [418, mouthY + 214]), { width: 14, ink: PIECE.blue, turns: 1.2, phase: .2 }), at: [418, mouthY + 214], size: 42, ink: PIECE.blue, turn: [-.7, -.3, .35], tabs: [-1, 1, 1, -1] },
];
const heroBack = heroRibbons.map(({ r }) => r.back.join('')).join('\n');
const heroFront = [
  ...heroRibbons.map(({ r }) => r.front.join('')),
  ...heroRibbons.map(({ at, size, ink, turn, tabs }) => piece({ at: [at[0], at[1]], size, ink, turn, tabs })),
].join('\n');
const heroStars = [
  star([40, 420], 11, 8, RED, .2), star([440, 590], 9, 8, RED, .5),
  sparkle([432, 400], 12, PIECE.gold.face), sparkle([44, 640], 10, PIECE.pink.face), sparkle([150, 300], 8, CREAM),
  dotAt([350, 292], 3.5, PIECE.gold.face), dotAt([96, 520], 3.5, CREAM), dotAt([454, 470], 3, PIECE.pink.face),
  ringAt([30, 520], 5, PIECE.gold.face), ringAt([380, 252], 4.5, PIECE.pink.face),
].join('\n');

const hero = tile({
  name: 'hero', ...HERO, paper: 'indigo', dark: true,
  decor: heroStars,
  content: `
    <img class="logo" src="../../extension/logo-wikiremastered-compact.svg" alt="WikiRemastered">
    <div class="pitch"><h1>Ouvrir un paquet devient un moment.</h1><p>Découpez-le aux ciseaux&nbsp;: la lumière jaillit, les pièces s’envolent, les cartes se révèlent une à une.</p></div>
    ${layer('hero-back', HERO.width, HERO.height, { dark: PAPERS.indigo.specks, light: PAPERS.indigo.light }, heroBack, 2)}
    <div class="opening" style="left:${PACK.left}px;top:${f(PACK.top)}px;width:${PACK.width}px;height:${f(PACK.height)}px;transform:rotate(${PACK.turn}deg)">
      <i class="mouth" style="clip-path:${mouthClip}"></i>
      ${card('muraille', { width: 160, className: 'rising', style: `left:${f(PACK.width / 2 - 80 + 12)}px;top:-150px;transform:rotate(7deg)` })}
      <img class="pack-front" src="../images/designs/pack-globe.png" alt="" style="clip-path:${tornClip}">
    </div>`,
  front: heroFront,
});

/* Five designs, in a fan, the globe on top; the button that switches them. */
const designs = tile({
  name: 'designs', x: RIGHT, y: PAD, width: 436, height: ROW, paper: 'pink', glyph: 'palette',
  title: 'Cinq designs de paquet',
  text: 'Globe, puzzle, vert, foil sombre ou visuel d’origine, chacun avec ses dos de cartes.',
  decor: [
    piece({ at: [44, 300], size: 34, ink: PIECE.violet, turn: [.5, -.4, .3], tabs: [1, 1, -1, 1] }),
    piece({ at: [398, 196], size: 28, ink: PIECE.cream, turn: [-.6, .5, -.2], tabs: [-1, 1, 1, -1] }),
    star([392, 300], 9, 8, RED, .3), sparkle([60, 186], 9, CREAM), dotAt([110, 330], 3, INK), ringAt([350, 150], 4.5, INK),
  ].join(''),
  content: `
    <div class="fan">
      ${pack('dark', { width: 96, style: 'transform:rotate(-21deg) translate(-8px, 14px)' })}
      ${pack('puzzle', { width: 96, style: 'transform:rotate(-8deg) translate(-2px, 2px)' })}
      ${pack('green', { width: 96, style: 'transform:rotate(6deg) translate(2px, 2px)' })}
      ${pack('globe', { width: 104, className: 'top', style: 'transform:rotate(19deg) translate(8px, 10px)' })}
    </div>
    <span class="cta design-cta">${icon('palette', 15)}Changer de design</span>`,
});

/* Anti-spoil: the backs, and nothing else, until the flip. */
const spoil = tile({
  name: 'spoil', x: RIGHT + 436 + GAP, y: PAD, width: 1280 - PAD - (RIGHT + 436 + GAP), height: ROW, paper: 'marigold', glyph: 'eyeOff',
  title: 'Anti-spoil',
  text: 'Rien ne trahit la rareté avant le retournement.',
  decor: [
    piece({ at: [262, 182], size: 30, ink: PIECE.coral, turn: [.4, .6, -.5], tabs: [1, -1, 1, 1] }),
    piece({ at: [40, 236], size: 26, ink: PIECE.jade, turn: [-.5, -.5, .6], tabs: [-1, 1, 1, -1] }),
    sparkle([270, 300], 9, INK), star([52, 330], 8, 8, RED, .2), dotAt([236, 140], 3, INK),
  ].join(''),
  content: `
    <div class="backs">
      ${back('puzzle', { width: 92, style: 'transform:rotate(-14deg) translate(-6px, 12px)' })}
      ${back('green', { width: 92, style: 'transform:rotate(12deg) translate(6px, 12px)' })}
      ${back('globe', { width: 100, style: 'transform:rotate(-1deg) translateY(-6px)' })}
    </div>
    <span class="hud">${icon('eyeOff', 15)}Anti-spoil</span>`,
});

/* Collection +: a stack of copies with its measures, and the bulk discard. */
const collection = tile({
  name: 'collection', x: RIGHT, y: PAD + ROW + GAP, width: 370, height: ROW, paper: 'green', glyph: 'layers', dark: true,
  title: 'Collection +',
  text: 'Doublons empilés, vues et prix estimés sous chaque carte, défausse groupée en un clic.',
  decor: [
    piece({ at: [340, 330], size: 30, ink: PIECE.gold, turn: [.5, .4, .6], tabs: [1, 1, -1, 1] }),
    sparkle([214, 150], 9, CREAM), star([352, 168], 8, 8, PIECE.gold.face, .4), dotAt([30, 340], 3, CREAM),
  ].join(''),
  content: `
    <div class="cell">
      <div class="stack">
        ${card('fuji', { width: 96, className: 'copy', style: 'transform:translate(10px, -7px) rotate(6deg)' })}
        ${card('fuji', { width: 96, className: 'copy', style: 'transform:translate(5px, -3.5px) rotate(3deg)' })}
        ${card('fuji', { width: 96 })}
        <span class="count">×3</span>
      </div>
      <div class="measures"><div><small>Vues · 30 j</small><b>3 410</b></div><div><small>Départ estimé</small><b>120 <i>WB</i></b></div></div>
    </div>
    <div class="panel discard">
      <b>Défausse groupée</b>
      <span>Cartes de toute la collection sous 30 vues sur 30 jours</span>
      <em><strong>152</strong> cartes concernées</em>
      <span class="cta">Défausser 152 cartes</span>
    </div>`,
});

/* Marché +: words, a cap and a budget, and the bids go out together. */
const market = tile({
  name: 'market', x: RIGHT + 370 + GAP, y: PAD + ROW + GAP, width: 1280 - PAD - (RIGHT + 370 + GAP), height: ROW, paper: 'cream', glyph: 'gavel',
  title: 'Marché +',
  text: 'Enchères en lot par mots-clés, dans le plafond et le budget que vous fixez.',
  decor: [
    piece({ at: [330, 336], size: 28, ink: PIECE.pink, turn: [-.4, .5, .4], tabs: [-1, 1, 1, -1] }),
    star([28, 350], 8, 8, RED, .1), sparkle([350, 156], 9, PIECE.violet.side), dotAt([276, 150], 3, INK),
  ].join(''),
  content: `
    <div class="panel market-panel">
      <div class="chips"><span>Saturne${icon('x', 11, 2.4)}</span><span>Volcan${icon('x', 11, 2.4)}</span><span>Chine${icon('x', 11, 2.4)}</span></div>
      <div class="slider"><i style="--at:48%"></i><small>Max par carte</small><b>100 <em>WB</em></b></div>
      <div class="slider"><i style="--at:64%"></i><small>Budget total</small><b>500 <em>WB</em></b></div>
      <span class="cta">Activer les enchères</span>
    </div>
    ${card('saturne', { width: 82, className: 'bid-card', style: 'transform:rotate(7deg)' })}
    <span class="bid">${icon('check', 12, 3)}100 WB</span>`,
});

/* ─── The page ──────────────────────────────────────────────────────────── */

const html = `<!doctype html>
<html lang="fr">
<meta charset="utf-8">
<title>WikiRemastered · présentation</title>
<!-- The first image of the Chrome Web Store listing (1280 × 800). Generated by
     store/presentation/build.mjs: edit the script, not this file. Rendered by render.sh. -->
<style>
  @font-face { font-family: Rubik; font-weight: 700; src: url(fonts/rubik-latin-700-normal.woff2); }
  @font-face { font-family: Rubik; font-weight: 900; src: url(fonts/rubik-latin-900-normal.woff2); }
  @font-face { font-family: Inter; font-weight: 100 900; src: url(fonts/inter-latin-wght-normal.woff2); }
  @font-face { font-family: Outfit; font-weight: 500; src: url(fonts/outfit-latin-500-normal.woff2); }
  @font-face { font-family: Outfit; font-weight: 700; src: url(fonts/outfit-latin-700-normal.woff2); }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
  body { position: relative; background: ${PAGE}; font-family: Inter, system-ui, sans-serif; color: ${INK}; }
  .page { position: absolute; inset: 0; }

  .tile { position: absolute; overflow: hidden; border-radius: 30px; color: ${INK}; isolation: isolate; }
  .tile.dark { color: ${CREAM}; }
  .layer { position: absolute; left: 0; top: 0; pointer-events: none; }
  header { position: absolute; left: 24px; top: 24px; right: 24px; display: flex; gap: 14px; align-items: flex-start; z-index: 5; }
  .badge { flex: none; display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%; background: ${INK}; color: ${CREAM}; box-shadow: 3px 4px 0 var(--deep); }
  .dark .badge { background: ${CREAM}; color: ${INK}; }
  h2 { margin: 1px 0 0; font: 700 23px/1.1 Rubik; letter-spacing: -.01em; }
  header p { margin: 6px 0 0; font: 450 13.5px/1.42 Inter; opacity: .78; max-width: 300px; }

  /* Hero */
  .hero .logo { position: absolute; left: 22px; top: 26px; width: 262px; z-index: 5; }
  .hero .pitch { position: absolute; left: 30px; right: 30px; top: 112px; z-index: 5; }
  .hero h1 { margin: 0; font: 900 31px/1.04 Rubik; letter-spacing: -.015em; text-shadow: 0 3px 0 ${PAPERS.indigo.deep}; }
  .hero .pitch p { margin: 12px 0 0; font: 450 14.5px/1.45 Inter; opacity: .8; max-width: 380px; }
  .opening { position: absolute; z-index: 3; transform-origin: 50% 40%; }
  .opening .mouth { position: absolute; inset: 0; background: linear-gradient(180deg, #cfc5b1, #b3a68e); }
  .opening .pack-front { position: absolute; inset: 0; width: 100%; height: 100%; filter: drop-shadow(14px 18px 0 ${PAPERS.indigo.deep}); }
  .opening .card.rising { position: absolute; filter: drop-shadow(8px 8px 0 rgb(29 20 110 / .55)); }

  /* Packs and backs */
  .pack, .back { display: block; filter: drop-shadow(6px 8px 0 var(--deep)); }
  .fan { position: absolute; left: 0; right: 0; top: 150px; display: flex; justify-content: center; align-items: flex-end; gap: 0; z-index: 3; }
  .fan .pack { margin: 0 -10px; }
  .backs { position: absolute; left: 0; right: 0; top: 154px; display: flex; justify-content: center; z-index: 3; }
  /* The backs lie on the paper: a soft shadow under them, not a printed one (it showed as a slab
     between the overlapping cards). */
  .backs .back { border-radius: 9px; margin: 0 -18px; filter: drop-shadow(0 1px 1px rgb(120 70 0 / .22)) drop-shadow(0 12px 16px rgb(150 85 0 / .3)); }
  .backs .back:last-child { position: absolute; left: 50%; margin-left: -50px; }

  /* The extension's controls */
  .cta, .hud { position: absolute; z-index: 7; display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 15px; border-radius: 9px; font: 600 13px/1 Inter; color: #f5f5f7; white-space: nowrap; }
  .cta { background: linear-gradient(180deg, rgb(245 245 247 / .06), transparent 65%), #0766c5; box-shadow: inset 0 1px 0 rgb(245 245 247 / .25), inset 0 -1px 0 rgb(5 20 40 / .3), 4px 5px 0 rgb(10 30 70 / .28); }
  .hud { background: linear-gradient(180deg, rgb(255 255 255 / .06), transparent 60%), #232327; box-shadow: inset 0 1px 0 rgb(255 255 255 / .08), 0 0 0 1px rgb(108 182 255 / .5), 4px 5px 0 rgb(0 0 0 / .22); color: #6cb6ff; }
  .design-cta { left: 50%; bottom: 22px; transform: translateX(-50%); }
  .spoil .hud { left: 50%; bottom: 22px; transform: translateX(-50%); }
  .panel { position: absolute; z-index: 4; border-radius: 14px; background: linear-gradient(180deg, rgb(255 255 255 / .03), transparent 40%), #18181b; color: #f5f5f7; box-shadow: inset 0 0 0 1px rgb(255 255 255 / .08), 6px 8px 0 var(--deep); }

  /* Collection + */
  .cell { position: absolute; left: 24px; top: 138px; width: 150px; padding: 12px 12px 10px; border-radius: 14px; background: #18181b; box-shadow: inset 0 0 0 1px rgb(255 255 255 / .08), 6px 8px 0 var(--deep); z-index: 4; color: #f5f5f7; }
  .stack { position: relative; width: 96px; margin: 6px auto 0; aspect-ratio: 5 / 7; }
  .stack .card { position: absolute; left: 0; top: 0; }
  .stack .copy { filter: brightness(.72); }
  .count { position: absolute; right: -14px; top: -10px; z-index: 3; padding: 4px 7px; border-radius: 7px; font: 700 11px/1 Inter; color: #fff; background: #0766c5; box-shadow: 0 0 0 2px #18181b; }
  .measures { display: flex; justify-content: space-between; margin-top: 11px; }
  .measures small { display: block; font: 500 9.5px/1 Inter; color: #a1a1aa; }
  .measures b { display: block; margin-top: 4px; font: 700 14px/1 Inter; }
  .measures i { font-style: normal; font-size: 9.5px; color: #a1a1aa; }
  .discard { left: 192px; top: 166px; width: 156px; padding: 13px 13px 13px; display: grid; gap: 7px; transform: rotate(2deg); }
  .discard b { font: 700 12.5px/1.2 Inter; }
  .discard > span:not(.cta) { font: 450 10.5px/1.35 Inter; color: #a1a1aa; }
  .discard em { font: 500 10.5px/1.2 Inter; font-style: normal; color: #a1a1aa; }
  .discard strong { font-size: 14px; color: #f5f5f7; }
  .discard .cta { position: static; height: 30px; padding: 0 10px; font-size: 11.5px; justify-content: center; box-shadow: inset 0 1px 0 rgb(245 245 247 / .25), inset 0 -1px 0 rgb(5 20 40 / .3); }

  /* Marché + */
  .market-panel { left: 24px; top: 146px; width: 236px; padding: 12px; transform: rotate(-1.5deg); }
  .market-panel .cta { position: static; display: flex; justify-content: center; height: 32px; margin-top: 10px; font-size: 12px; box-shadow: inset 0 1px 0 rgb(245 245 247 / .25), inset 0 -1px 0 rgb(5 20 40 / .3); }
  .chips { display: flex; gap: 6px; margin: 0 0 8px; }
  .chips span { display: inline-flex; align-items: center; gap: 5px; padding: 6px 8px; border-radius: 7px; background: #2a2a30; font: 600 11px/1 Inter; color: #e4e4e7; }
  .chips svg { color: #a1a1aa; }
  .slider { position: relative; display: flex; align-items: center; justify-content: space-between; height: 28px; margin-top: 6px; padding: 0 10px; border-radius: 9px; background: #232327; overflow: hidden; }
  .slider i { position: absolute; left: 0; top: 0; bottom: 0; width: var(--at); background: #2c2c33; border-right: 2px solid #6cb6ff; }
  .slider small, .slider b { position: relative; z-index: 1; font: 500 10.5px/1 Inter; color: #a1a1aa; }
  .slider b { font: 700 12px/1 Inter; color: #f5f5f7; }
  .slider em { font-style: normal; font-size: 9.5px; color: #a1a1aa; }
  .go { display: flex; align-items: center; gap: 7px; margin-top: 11px; }
  .go small { font: 600 10.5px/1 Inter; color: #e4e4e7; flex: 1; }
  .switch { width: 26px; height: 15px; border-radius: 99px; background: #0766c5; position: relative; }
  .switch::after { content: ""; position: absolute; right: 2px; top: 2px; width: 11px; height: 11px; border-radius: 50%; background: #fff; }
  .go .cta { position: static; height: 30px; padding: 0 11px; font-size: 11.5px; box-shadow: inset 0 1px 0 rgb(245 245 247 / .25), inset 0 -1px 0 rgb(5 20 40 / .3); }
  .bid-card { position: absolute !important; right: 26px; top: 168px; z-index: 5; filter: drop-shadow(5px 6px 0 var(--deep)); }
  .bid { position: absolute; right: 30px; top: 276px; z-index: 6; display: inline-flex; align-items: center; gap: 5px; padding: 6px 9px; border-radius: 8px; font: 700 11px/1 Inter; color: #062b1e; background: #34d399; box-shadow: inset 0 1px 0 rgb(255 255 255 / .35), 3px 4px 0 var(--deep); transform: rotate(6deg); }

  /* Cards of the game */
  .card { position: relative; aspect-ratio: 5 / 7; container-type: inline-size; }
  .card .face { position: absolute; inset: 0; overflow: hidden; border-radius: 6.4cqw; background: #d4f5e3; }
  .card .frame { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transform: scale(1.8); }
  .card .art { position: absolute; inset: 0 0 auto; height: 45%; overflow: hidden; }
  .card .art img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .card .chip { position: absolute; left: 4cqw; top: 4cqw; padding: 1.3cqw 3.2cqw; border-radius: 2.4cqw; font: 700 6cqw/1 Outfit; color: #0d1117; z-index: 2; }
  .card .body { position: absolute; inset: 45% 0 0; display: flex; flex-direction: column; padding: 5.5cqw; color: #000; }
  .card h3 { margin: 0; font: 700 7.4cqw/1.15 Outfit; }
  .card p { margin: 1.6cqw 0 0; font: 500 5cqw/1.3 Outfit; color: rgb(23 23 23 / .85); }
  .card .stats { margin-top: auto; display: flex; justify-content: space-between; padding-top: 2.6cqw; border-top: 1px solid rgb(0 0 0 / .2); font: 700 5.4cqw/1 Outfit; }
  .card .stats span { display: inline-flex; align-items: center; gap: 1.6cqw; }
  .card .stats svg { width: 6cqw; height: 6cqw; }
  .card .atk svg { color: #e5484d; }
  .card .def svg { color: #3b82f6; }
</style>
<body>
  <div class="page">
    ${hero}
    ${designs}
    ${spoil}
    ${collection}
    ${market}
  </div>
</body>
</html>
`;
writeFileSync(OUT, html);
console.log(`${OUT} (${(html.length / 1024).toFixed(0)} Ko)`);
