import { normalizePackResponse } from './pack-cards.js';
import { randomFold, withFold } from './pack-fold.js';
import { createLightShow, HOLO, waveColor } from './pack-light.js';
import { networkFetch, safeServerMessage } from './network.js';
import { getMarketSummary, getSuggestedPriceFromSummary } from './api.js';
import { extensionAlive } from './runtime.js';

/* Immersive opening of the normal Wiki Masters pack.
 * Presentation lives in an isolated Shadow DOM inside a top-layer dialog.
 * Only a trusted click on the native normal pack is intercepted, and only when
 * the page adapter confirms stock, account, block and human verification.
 * Every other case falls through to the native flow. One trusted click opens
 * exactly one pack; nothing is retried automatically.
 */

const META = {
  C: { name: 'Commune', color: '#b8f2d5', rgb: '184 242 213', frame: '/commun.png', tier: 0 },
  PC: { name: 'Peu commune', color: '#b1cff2', rgb: '177 207 242', frame: '/peu_commun.png', tier: 0 },
  R: { name: 'Rare', color: '#c6a7f2', rgb: '198 167 242', frame: '/rare.png', tier: 1 },
  SR: { name: 'Super rare', color: '#ed6fa3', rgb: '237 111 163', frame: '/super_rare.png', tier: 2 },
  UR: { name: 'Ultra rare', color: '#fa9931', rgb: '250 153 49', frame: '/ultra_rare.png', tier: 3 },
  L: { name: 'Légendaire', color: '#ffe144', rgb: '255 225 68', frame: '/legendaire.png', tier: 4 },
};
const TEAR_Y = 9; // % of the pack height where the crimped strip ends.
const SEAM_STEPS = 360; // Points along the tear line: fine enough to show the frayed edge.
const SEAL_LEFT = 3.4; // Where the pack's seals start and end, in % of its width.
const SEAL_RIGHT = 96.6;
const numberFormat = new Intl.NumberFormat('fr-FR');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* The tear line. Foil torn by hand is a wandering line, never a row of teeth: a slow
   drift, a few smaller waves, a fine irregular fray, and now and then a small nick where
   the foil gave way. Each pack gets its own. Values are % of the pack height. */
let SEAM_Y = [];
function makeSeam() {
  const octave = (count, amplitude, soft) => {
    const values = Array.from({ length: count + 1 }, () => rand(-amplitude, amplitude));
    return x => {
      const at = x * count;
      const index = Math.min(count - 1, Math.floor(at));
      const t = at - index;
      return values[index] + (values[index + 1] - values[index]) * (soft ? t * t * (3 - 2 * t) : t);
    };
  };
  const layers = [octave(4, .5, true), octave(13, .24, true), octave(48, .2, false), octave(140, .1, false)];
  const nicks = Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => ({
    at: rand(.06, .94), width: rand(.006, .014), depth: rand(.22, .42) * (Math.random() < .5 ? -1 : 1),
  }));
  SEAM_Y = Array.from({ length: SEAM_STEPS + 1 }, (_, index) => {
    const x = index / SEAM_STEPS;
    let y = TEAR_Y;
    for (const layer of layers) y += layer(x);
    for (const nick of nicks) {
      const d = Math.abs(x - nick.at) / nick.width;
      if (d < 1) y += nick.depth * (1 - d);
    }
    return y;
  });
}
const seamX = index => SEAL_LEFT + index / SEAM_STEPS * (SEAL_RIGHT - SEAL_LEFT);
// The tear line at `along` (0 to 1 from one end of the seal to the other), clamped at the ends.
function seamAt(along) {
  const at = clamp(along, 0, 1) * SEAM_STEPS;
  const index = Math.min(SEAM_STEPS - 1, Math.floor(at));
  return SEAM_Y[index] + (SEAM_Y[index + 1] - SEAM_Y[index]) * (at - index);
}
const pct = value => value.toFixed(2);
const seamPoints = (shift = 0) => SEAM_Y.map((y, index) => `${pct(seamX(index))}% ${pct(y + shift)}%`);
// The body of the pack, from its torn edge down to `bottom` (% of the height).
function tornBody(bottom) {
  return `polygon(0 ${pct(SEAM_Y[0])}%, ${seamPoints().join(', ')}, 100% ${pct(SEAM_Y[SEAM_STEPS])}%, 100% ${pct(bottom)}%, 0 ${pct(bottom)}%)`;
}
// The sealed top, down to the tear line. It overlaps the body by half a pixel, so the two never leave a hairline.
function capShape() {
  return `polygon(0 0, 100% 0, 100% ${pct(SEAM_Y[SEAM_STEPS] + .15)}%, ${seamPoints(.15).reverse().join(', ')}, 0 ${pct(SEAM_Y[0] + .15)}%)`;
}
// What is lit just below the torn edge: a band of the front, hugging the edge.
function spillShape() {
  return `polygon(${seamPoints().join(', ')}, ${seamPoints(6).reverse().join(', ')})`;
}
// A sliver of the inside of the back panel above the torn edge.
function mouthShape() {
  const upper = SEAM_Y.map((y, index) => `${pct(seamX(index))}% ${pct(.6)}%`).join(', ');
  const lower = seamPoints(.2).reverse().join(', ');
  return `polygon(${upper}, ${lower})`;
}
const rimPath = shift => SEAM_Y.map((y, index) => `${index ? 'L' : 'M'}${pct(seamX(index))} ${pct(y + shift)}`).join(' ');

const ICONS = {
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>', 
  swords: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>',
  palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>',
};

/* The scissors that show where to cut: a small, rounded pair in 3D (each half drawn over a darker
   copy of itself, glossy coral handles, steel blades with a lit back, a gold screw), pointing
   right, pivot at (64, 30), blades meeting along y = 30. Each half is one rigid part, a blade
   and the opposite handle, turning about the pivot: `open` is how far apart, in degrees.
   Used for the guide on the pack (animated in CSS) and, flattened, as the cursor. */
const SCISSORS_PARTS = {
  // The upper blade and the lower handle, then the lower blade and the upper handle.
  a: { blade: 'M57 30 L116 29.6 C101 24.5 82 21.2 64 22 C57.5 22.6 54.8 26.6 57 30 Z', shank: 'M64 30 C54 34 45 39.5 36 41.5', ring: [24, 43.5] },
  b: { blade: 'M57 30 L116 30.4 C101 35.5 82 38.8 64 38 C57.5 37.4 54.8 33.4 57 30 Z', shank: 'M64 30 C54 26 45 20.5 36 18.5', ring: [24, 16.5] },
};
// Handle colours: coral on the yellow puzzle pack, the site's green on the others. The guide on
// the pack takes them from CSS (--sc-handle, --sc-deep); the cursor, an image, is drawn in them.
const SCISSORS_INK = { puzzle: ['#ff5a4c', '#b3322b'], other: ['#34c98e', '#1d8a5c'] };
// The drawn packs with a coloured paper take the coral pair; green scissors would vanish on the green one.
const CORAL_SCISSORS = new Set(['puzzle', 'green', 'globe']);
function scissorsHalf(part, { outline = '', handle = 'var(--sc-handle)', deep = 'var(--sc-deep)' } = {}) {
  const { blade, shank, ring: [cx, cy] } = SCISSORS_PARTS[part];
  const ringShape = `<ellipse cx="${cx}" cy="${cy}" rx="12.5" ry="9.5"/>`;
  const edge = outline ? `<g fill="none" stroke="${outline}" stroke-width="15" stroke-linecap="round"><path d="${shank}"/>${ringShape}</g><path d="${blade}" fill="${outline}" stroke="${outline}" stroke-width="6" stroke-linejoin="round"/>` : '';
  return `${edge}
    <g transform="translate(1.6 2.4)"><path d="${blade}" fill="#6b7384"/><g fill="none" style="stroke:${deep}" stroke-width="8" stroke-linecap="round"><path d="${shank}"/>${ringShape}</g></g>
    <path d="${blade}" fill="url(#wme-steel)"/>
    <path d="${blade.split(' L')[0]} L116 30" stroke="#fff" stroke-opacity=".9" stroke-width="1.1" fill="none"/>
    <g fill="none" style="stroke:${handle}" stroke-width="8" stroke-linecap="round"><path d="${shank}"/>${ringShape}</g>
    <path d="M${cx - 9} ${cy - 3} A11 8 0 0 1 ${cx + 2} ${cy - 8.6}" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="2.4" stroke-linecap="round"/>`;
}
const SCISSORS_DEFS = `<defs><linearGradient id="wme-steel" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#dfe4ee"/><stop offset="1" stop-color="#9aa4b8"/>
  </linearGradient></defs>`;
const SCISSORS_PIVOT = '<circle cx="64" cy="30" r="4.6" fill="#ffd23f" stroke="#c7890c" stroke-width="1.4"/><path d="M61.6 28.2 L66.4 31.8" stroke="#a86a08" stroke-width="1.3" stroke-linecap="round"/>';
function scissorsSvg({ open = 0, cursor = false, ink = SCISSORS_INK.puzzle } = {}) {
  const colors = cursor ? { outline: '#1c1430', handle: ink[0], deep: ink[1] } : {};
  const halves = [['b', open], ['a', -open]].map(([part, angle]) => `<g transform="rotate(${angle} 64 30)">${scissorsHalf(part, colors)}</g>`).join('');
  if (!cursor) return `<svg viewBox="0 0 120 60" aria-hidden="true">${SCISSORS_DEFS}${halves}${SCISSORS_PIVOT}</svg>`;
  // As a 32 px cursor: the tip up and to the left (the hotspot, at 4 4), outlined so it reads on
  // the dark room as on the light pack.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${SCISSORS_DEFS}<g transform="translate(13.8 13.8) rotate(-135) scale(.255) translate(-64 -30)">${halves}${SCISSORS_PIVOT}</g></svg>`;
}
const scissorsCursor = (open, ink) => `url("data:image/svg+xml,${encodeURIComponent(scissorsSvg({ open, cursor: true, ink }))}") 4 4`;
const SCISSORS_CURSORS = Object.fromEntries(Object.entries(SCISSORS_INK).map(([name, ink]) => [name, [scissorsCursor(20, ink), scissorsCursor(3, ink)]]));

/* Draws an SVG (a same-origin URL: a blob) once into a bitmap of the given size, and returns the
   canvas and a URL of it. The pack and card-back art carry grain, blurs and displacement filters:
   left as SVG, they would be rasterised again for every 3D layer that shows them (the pack is some
   twenty-five layers, each card one more), filters and all, and the dark pack's animated sweep
   made that happen at every frame. As a bitmap, they cost one drawing, done ahead of time. */
let artStamp = 0;
async function rasterArt(url, width, height) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(image, 0, 0, width, height);
  canvas.stamp = ++artStamp; // Tells one drawing from the next (the ribbon is cut from it).
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('art');
  return { canvas, url: URL.createObjectURL(blob) };
}
// Pixels for a CSS size: device pixels, with room for the pack coming a little nearer, capped.
const artPixels = css => Math.round(css * Math.min(3, Math.max(1.5, (devicePixelRatio || 1) * 1.2)));

/* The backs of the cards that come out of the drawn packs, each drawn once per page as a bitmap
   for the largest a card is shown (the SVG carries filters, see rasterArt), decoded, and kept for
   every opening that follows. Made anew at each opening, all three at once and alongside
   everything else, a back could still be on its way when the cards came out: they showed as
   plain colour, until the picture landed. A back that fails is tried again the next time. */
const cardBacks = new Map();
function cardBack(name, source) {
  const width = artPixels(280);
  const key = `${name} ${width}`;
  if (!cardBacks.has(key)) {
    const ready = fetch(source)
      .then(response => (response.ok ? response.text() : Promise.reject(new Error('back'))))
      .then(async svg => {
        const blob = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        try { return await rasterArt(blob, width, artPixels(392)); } finally { URL.revokeObjectURL(blob); }
      })
      .then(async ({ url }) => {
        // Held here, the decoded picture stays at hand for the cards that show it.
        const image = new Image();
        image.src = url;
        await image.decode().catch(() => {});
        return { url, image };
      });
    ready.catch(() => cardBacks.delete(key));
    cardBacks.set(key, ready);
  }
  return cardBacks.get(key);
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const rand = (min, max) => min + Math.random() * (max - min);
const pick = list => list[Math.floor(Math.random() * list.length)];
makeSeam();

function h(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function iconButton(className, icon, label) {
  const node = h('button', className);
  node.type = 'button';
  node.innerHTML = ICONS[icon];
  node.setAttribute('aria-label', label);
  node.title = label;
  return node;
}

// Registered (namespaced) properties let a card's charge and thickness transition, and
// the empty pack lose its air.
for (const [name, syntax, initialValue] of [
  ['--wme-charge', '<number>', '0'],
  ['--wme-thick', '<length>', '2.4px'],
  ['--wme-inflate', '<number>', '1'],
  ['--dark', '<number>', '0'],
  ['--surge', '<number>', '0'],
]) {
  try { CSS.registerProperty({ name, syntax, inherits: true, initialValue }); } catch { /* Already registered. */ }
}


/* ─── Audio: the site's own samples, layered with light synthesis ─────────── */

function createAudio(assetOrigin) {
  let context;
  let master;
  let echo;
  let noiseBuffer;
  let muted = false;
  const samples = {};

  function ensure() {
    if (muted) return null;
    if (!context) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return null;
      context = new AudioContext();
      const compressor = context.createDynamicsCompressor();
      master = context.createGain();
      master.gain.value = .34;
      master.connect(compressor);
      compressor.connect(context.destination);
      const delay = context.createDelay(1);
      delay.delayTime.value = .19;
      const feedback = context.createGain();
      feedback.gain.value = .33;
      const wet = context.createGain();
      wet.gain.value = .45;
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(master);
      echo = delay;
      for (const [name, path] of Object.entries({ rip: '/audio/pack-rip.mp3', flip: '/audio/card-flip.mp3', legendary: '/audio/legendary-reveal.mp3' })) {
        samples[name] = fetch(new URL(path, assetOrigin), { credentials: 'omit' })
          .then(response => response.ok ? response.arrayBuffer() : Promise.reject(new Error('audio')))
          .then(data => context.decodeAudioData(data))
          .catch(() => null);
      }
    }
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  }

  function noise() {
    if (!noiseBuffer) {
      noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    }
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    return source;
  }

  function envelope(node, start, attack, peak, decay, destination = master) {
    const gain = context.createGain();
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(.0001, start + attack + decay);
    node.connect(gain);
    gain.connect(destination);
    return gain;
  }

  function tone(frequency, start, duration, { type = 'sine', peak = .25, attack = .008, to, wet = false } = {}) {
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (to) oscillator.frequency.exponentialRampToValueAtTime(to, start + attack + duration);
    const gain = envelope(oscillator, start, attack, peak, duration);
    if (wet) gain.connect(echo);
    oscillator.start(start);
    oscillator.stop(start + attack + duration + .05);
  }

  function hiss(start, duration, { from = 800, to = 4000, q = 1, peak = .3, type = 'bandpass', attack = .01 } = {}) {
    const source = noise();
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(to, start + duration);
    source.connect(filter);
    envelope(filter, start, attack, peak, duration);
    source.start(start, Math.random());
    source.stop(start + attack + duration + .1);
  }

  async function sample(name, gain = 1, rate = 1) {
    const buffer = await samples[name];
    if (!buffer || muted || !context) return false;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const volume = context.createGain();
    volume.gain.value = gain;
    source.connect(volume);
    volume.connect(master);
    source.start();
    return true;
  }

  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093];
  return {
    get muted() { return muted; },
    set muted(value) {
      muted = Boolean(value);
      if (master) master.gain.setTargetAtTime(muted ? 0 : .34, context.currentTime, .03);
    },
    unlock() { ensure(); },
    whoosh(strength = 1) {
      const c = ensure(); if (!c) return;
      hiss(c.currentTime, .55, { from: 250, to: 2600, q: .7, peak: .18 * strength, attack: .12 });
    },
    tick() {
      const c = ensure(); if (!c) return;
      hiss(c.currentTime, .04, { from: 3000, to: 5000, q: 3, peak: .05 });
    },
    // Foil tearing: filtered noise whose level and brightness follow the speed of the pull.
    tearStart() {
      const c = ensure(); if (!c) return null;
      const source = noise();
      source.loop = true;
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = .8;
      filter.frequency.value = 1500;
      const gain = c.createGain();
      gain.gain.value = .0001;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start(c.currentTime, Math.random());
      return {
        set(level) {
          const t = c.currentTime;
          gain.gain.setTargetAtTime(Math.max(.0001, level * .3), t, .035);
          filter.frequency.setTargetAtTime(1500 + level * 3600, t, .05);
        },
        stop() {
          gain.gain.setTargetAtTime(.0001, c.currentTime, .04);
          setTimeout(() => { try { source.stop(); } catch { /* Already stopped. */ } }, 300);
        },
      };
    },
    rip() {
      const c = ensure(); if (!c) return;
      sample('rip', .9).then(played => {
        if (played) return;
        const t = c.currentTime;
        hiss(t, .3, { from: 1400, to: 6000, q: .9, peak: .45 });
        hiss(t + .06, .22, { from: 3000, to: 9000, q: 2, peak: .2 });
      });
    },
    flip(rate = 1) {
      const c = ensure(); if (!c) return;
      sample('flip', .8, rate).then(played => {
        if (!played) hiss(c.currentTime, .09, { from: 2200, to: 6000, q: 1.2, peak: .16 });
      });
    },
    chime(tier) {
      const c = ensure(); if (!c) return;
      const t = c.currentTime;
      const count = [2, 3, 4, 5, 7][tier] ?? 2;
      for (let index = 0; index < count; index += 1) {
        tone(notes[index], t + index * (tier >= 3 ? .06 : .075), tier >= 2 ? .7 : .35,
          { type: index % 2 ? 'sine' : 'triangle', peak: .13 - index * .008, wet: tier >= 2 });
      }
    },
    rumble(duration, intensity = 1) {
      const c = ensure(); if (!c) return;
      const t = c.currentTime;
      const oscillator = c.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.setValueAtTime(42, t);
      oscillator.frequency.linearRampToValueAtTime(70, t + duration);
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 160;
      const gain = c.createGain();
      gain.gain.setValueAtTime(.0001, t);
      gain.gain.exponentialRampToValueAtTime(.28 * intensity, t + duration * .9);
      gain.gain.exponentialRampToValueAtTime(.0001, t + duration + .08);
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      oscillator.start(t);
      oscillator.stop(t + duration + .1);
      hiss(t, duration, { from: 120, to: 900, type: 'lowpass', q: .5, peak: .12 * intensity, attack: duration * .8 });
    },
    rise(duration) {
      const c = ensure(); if (!c) return;
      tone(180, c.currentTime, duration, { type: 'triangle', to: 1400, peak: .07, attack: duration * .85 });
      hiss(c.currentTime, duration, { from: 400, to: 7000, q: 1.4, peak: .1, attack: duration * .9 });
    },
    heartbeat() {
      const c = ensure(); if (!c) return;
      const t = c.currentTime;
      tone(80, t, .16, { to: 42, peak: .7 });
      tone(76, t + .2, .2, { to: 38, peak: .55 });
    },
    boom() {
      const c = ensure(); if (!c) return;
      const t = c.currentTime;
      tone(140, t, 1.1, { to: 30, peak: .8 });
      hiss(t, .9, { from: 3000, to: 80, type: 'lowpass', q: .3, peak: .45 });
    },
    fanfare() {
      const c = ensure(); if (!c) return;
      sample('legendary', 1).then(played => {
        const t = c.currentTime + (played ? .35 : 0);
        for (const [index, frequency] of [261.63, 329.63, 392, 523.25, 659.25, 783.99].entries()) {
          tone(frequency, t + index * .02, 2.2, { type: index < 3 ? 'sawtooth' : 'triangle', peak: played ? .025 : .06, attack: .25, wet: true });
        }
        for (let index = 0; index < 10; index += 1) tone(notes[index % notes.length] * 2, t + .3 + index * .07, .5, { peak: .05, wet: true });
      });
    },
    shimmer() {
      const c = ensure(); if (!c) return;
      const t = c.currentTime;
      for (let index = 0; index < 6; index += 1) tone(notes[6 - index] * 1.5, t + index * .045, .4, { type: 'sine', peak: .05, wet: true });
    },
    close() { context?.close().catch(() => {}); },
  };
}

/* ─── Card component (mirrors the native face) ────────────────────────────── */

function createCard(card, assetOrigin, { face = 'back' } = {}) {
  const meta = META[card.rarity] || META.C;
  const root = h('div', 'card');
  root.dataset.rarity = card.rarity;
  root.dataset.tier = String(meta.tier);
  root.dataset.face = face;
  root.dataset.shiny = String(card.isShiny);
  root.dataset.ownedId = card.ownedId || '';
  root.dataset.starred = String(Boolean(card.starred));
  root.style.setProperty('--c-rgb', meta.rgb);
  root.style.setProperty('--frame', `url("${new URL(meta.frame, assetOrigin).href}")`);

  const tilt = h('div', 'tilt');
  const flip = h('div', 'flip');

  const back = h('div', 'face back');
  const emblem = h('div', 'emblem');
  const logo = h('img');
  logo.alt = '';
  logo.src = new URL('/logo.png', assetOrigin).href;
  logo.addEventListener('error', () => logo.replaceWith(h('b', '', 'WM')), { once: true });
  emblem.append(logo);
  back.append(emblem);

  const front = h('div', 'face front');
  const art = h('div', 'art');
  if (card.imageUrl) {
    const image = h('img');
    image.alt = '';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.src = card.imageUrl;
    image.addEventListener('error', () => image.replaceWith(placeholder()), { once: true });
    art.append(image);
  } else art.append(placeholder());
  function placeholder() {
    const node = h('div', 'placeholder');
    const mark = h('img');
    mark.alt = '';
    mark.src = new URL('/logo.png', assetOrigin).href;
    mark.style.cssText = 'width:34%;height:auto;opacity:.72';
    mark.addEventListener('error', () => mark.replaceWith(document.createTextNode('WM')), { once: true });
    node.append(mark);
    return node;
  }
  const chip = h('span', 'chip', card.rarity);
  const body = h('div', 'body');
  body.append(h('h3', '', card.title));
  if (card.subtitle) body.append(h('p', '', card.subtitle));
  const stats = h('div', 'stats');
  if (card.atk !== undefined && card.def !== undefined) {
    const atk = h('span', 'atk');
    atk.innerHTML = ICONS.swords;
    atk.append(numberFormat.format(card.atk));
    const def = h('span', 'def');
    def.innerHTML = ICONS.shield;
    def.append(numberFormat.format(card.def));
    stats.append(atk, def);
  }
  body.append(stats);
  front.append(h('div', 'frame'), art, chip, body, h('div', 'holo'), h('div', 'glare'), h('div', 'sheen'));
  if (card.isShiny) front.append(h('span', 'shiny-chip', 'SHINY'));
  // The card is a real slab: a few paper-coloured slices sit between its two faces,
  // so its edge shows when it turns and when it sits in a pile.
  for (let index = 0; index < 5; index += 1) {
    const rim = h('div', 'rim');
    rim.style.setProperty('--i', String(index));
    flip.append(rim);
  }
  flip.append(back, front);
  tilt.append(flip);
  // A small star on the corner of the copies the player put in favorites (tray, summary).
  const badge = h('span', 'star-badge');
  badge.innerHTML = ICONS.star;
  badge.setAttribute('aria-hidden', 'true');
  root.append(tilt, badge);
  return { root, tilt, flip, back, data: card, meta };
}

const SEARCH_INPUT = 'main input[placeholder="Rechercher par titre ou catégorie..."]';

// Walks the site's own collection page, inside a frame, to the exact copy of a card:
// the search field first, then page by page. It only reads and types in the search
// field; whatever is done with the row is up to the caller.
function collectionWalker(frame, { ownedId, title, account, path }) {
  let searched = false;
  let searchedAt = 0;
  let lastPage = '';
  let pageAt = 0;
  return function step({ search = true } = {}) {
    const doc = frame.contentDocument;
    if (!doc || doc.location.pathname !== path) return null;
    doc.dispatchEvent(new Event('wme:scan'));
    if (doc.documentElement.getAttribute('data-wme-account') !== account) return null;
    const row = doc.querySelector(`[data-wme-owned-id="${ownedId}"]`);
    if (row || !search) return { doc, row };
    const input = doc.querySelector(SEARCH_INPUT);
    if (!searched && input) {
      const setter = Object.getOwnPropertyDescriptor(frame.contentWindow.HTMLInputElement.prototype, 'value').set;
      setter.call(input, title);
      input.dispatchEvent(new frame.contentWindow.Event('input', { bubbles: true }));
      searched = true;
      searchedAt = Date.now();
    }
    if (searched && Date.now() - searchedAt > 1500) {
      const signature = Array.from(doc.querySelectorAll('[data-wme-owned-id]'), node => node.dataset.wmeOwnedId).join(',');
      if (signature !== lastPage) { lastPage = signature; pageAt = Date.now(); }
      if (signature && Date.now() - pageAt > 1200) {
        const next = Array.from(doc.querySelectorAll('main button')).find(button => button.textContent.trim() === 'Suivant →');
        if (next && !next.disabled) { next.click(); pageAt = Date.now() + 1000; }
      }
    }
    return { doc, row: null };
  };
}

// Use the site's own favorite button and authenticated client. No session tokens
// are copied into the extension; the owned-copy ID is checked before any click.
async function savePackFavorite(card, starred, { path = '/collection' } = {}) {
  if (!UUID.test(card.ownedId || '')) throw new Error('Carte indisponible.');
  const account = document.documentElement.getAttribute('data-wme-account');
  if (!account || !navigator.onLine) throw new Error('Connexion indisponible.');
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.setAttribute('aria-hidden', 'true');
  frame.title = 'Enregistrement du favori';
  frame.src = new URL(path, location.origin).href;
  document.body.append(frame);
  const deadline = Date.now() + 30_000;
  const walk = collectionWalker(frame, { ownedId: card.ownedId, title: card.title, account, path });
  let clicked = false;
  try {
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (document.documentElement.getAttribute('data-wme-account') !== account) throw new Error('Compte modifié.');
      // Never replay a mutation with an uncertain result: once clicked, only watch the row.
      const found = walk({ search: !clicked });
      const row = found?.row;
      if (!row) continue;
      if (row.getAttribute('data-wme-starred') === String(starred)) return;
      if (!clicked) {
        const button = row.querySelector('button[aria-label="Ajouter aux favoris"],button[aria-label="Retirer des favoris"]');
        if (button && !button.disabled) { clicked = true; button.click(); }
      }
    }
    throw new Error('Favori non confirmé. Réessaie.');
  } finally { frame.remove(); }
}

/* ─── Pack volume ─────────────────────────────────────────────────────────── */

/* The dark pack is a pillow of foil: the heat-sealed ends stay flat and the body
   swells on a smooth profile. Each face is a stack of thin bands that follow that
   profile, and two walls close the sides, so the pack has real depth when it turns.
   Depth and band angles are fractions of the pack width: they scale with it. */
const PACK_VOLUME = { top: 8.1, bottom: 91.9, depth: .12, bands: 10, ratio: 1000 / 640 };
const swell = u => 1 - Math.abs(u) ** 2.2;

/* Where the side of the art's body is at height `y` (% of the pack), in % of its width, as drawn
   in pack-art.svg and pack-art-puzzle.svg (640 × 1000): straight at the heat-sealed ends (x 22),
   a curved shoulder down to where the pillow is widest (x 14), straight again, and back. */
const SHOULDER = { top: 17.2, bottom: 82.8 };
function packSide(y) {
  const Y = y * 10;
  // A cubic from (x0, y0) through (x0, y0 + c1), (x1, y0 + c2) to (x1, y0 + 100): y is monotonic in t.
  const shoulder = (x0, x1, y0, c1, c2) => {
    let [lo, hi] = [0, 1];
    for (let step = 0; step < 30; step += 1) {
      const t = (lo + hi) / 2;
      const yt = (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * (y0 + c1) + 3 * (1 - t) * t ** 2 * (y0 + c2) + t ** 3 * (y0 + 100);
      if (yt < Y) lo = t; else hi = t;
    }
    const t = (lo + hi) / 2;
    return (1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * x0 + 3 * (1 - t) * t ** 2 * x1 + t ** 3 * x1;
  };
  let x = 14;
  if (Y <= 72) x = 22;
  else if (Y < 172) x = shoulder(22, 14, 72, 32, 52); // C22 104 14 124 14 172
  else if (Y >= 928) x = 22;
  else if (Y > 828) x = shoulder(14, 22, 828, 48, 68); // C14 876 22 896 22 928
  return x / 640 * 100;
}

function buildPackVolume(body, { flat = false } = {}) {
  const { top, bottom, depth, bands, ratio } = PACK_VOLUME;
  const middle = (top + bottom) / 2;
  const half = (bottom - top) / 2;
  const edges = Array.from({ length: bands + 1 }, (_, k) => -Math.cos(Math.PI * k / bands));
  for (const side of ['front', 'back']) {
    const group = h('div', 'pack-face');
    group.dataset.side = side;
    for (let index = 0; index < bands; index += 1) {
      const u0 = edges[index];
      const u1 = edges[index + 1];
      const y0 = middle + u0 * half;
      const y1 = middle + u1 * half;
      const rise = (swell(u1) - swell(u0)) * depth / 2; // In pack widths.
      const run = (y1 - y0) / 100 * ratio;
      const band = h('i', 'band');
      band.style.setProperty('--y0', `${(y0 - (index ? .15 : 0)).toFixed(3)}`);
      band.style.setProperty('--y1', `${(y1 + (index < bands - 1 ? .15 : 0)).toFixed(3)}`);
      band.style.setProperty('--yc', `${((y0 + y1) / 2).toFixed(3)}`);
      band.style.setProperty('--z', `calc(var(--pack-w) * ${(swell((u0 + u1) / 2) * depth / 2).toFixed(4)})`);
      band.style.setProperty('--a', `${(Math.atan2(rise, run) * 180 / Math.PI).toFixed(2)}deg`);
      // The first front band carries the torn edge (see applySeam). Drawn flat, it is the whole
      // face, down to the bottom seal, and the other bands are not shown (see pack-opening.css).
      // Its cut then reaches well past the bottom of the pack: the software compositor cuts off
      // the bottom of a clip that ends on the edge (the art does not repeat: nothing shows there).
      if (side === 'front' && index === 0) band.dataset.bottom = flat ? '120' : (y1 + .15).toFixed(2);
      if (side === 'front') band.append(h('i', 'pack-sweep'));
      group.append(band);
    }
    body.append(group);
  }
  // Side walls: the lens-shaped section of the pillow, seen edge-on. The side of the pack is not
  // straight: the art's body is narrower at the heat-sealed ends and swells out over a curved
  // shoulder. One flat wall, set where the body is widest, stuck out past the silhouette near the
  // ends (a thin wedge beside the pack as it turned). So each wall is a chain of slices along the
  // side of the art, fine along the shoulders and one down the straight middle: each goes from the
  // side at its top to the side at its bottom, leaning with it, so the wall is one continuous surface.
  const cuts = [
    ...Array.from({ length: 6 }, (_, k) => top + (SHOULDER.top - top) * k / 6),
    SHOULDER.top, SHOULDER.bottom,
    ...Array.from({ length: 6 }, (_, k) => SHOULDER.bottom + (bottom - SHOULDER.bottom) * (k + 1) / 6),
  ];
  const thickness = y => swell(clamp((y - middle) / half, -1, 1)) * 50;
  for (let index = 0; index < cuts.length - 1; index += 1) {
    // Each slice reaches a little past its ends, along its own line, into its neighbours (as the
    // bands do): two 3D planes that only meet leave a hairline seam between them.
    const [c0, c1] = [cuts[index], cuts[index + 1]];
    const reach = .2 / (c1 - c0);
    const [p0, p1] = [packSide(c0), packSide(c1)];
    const [y0, y1] = [c0 - .2, c1 + .2];
    const [x0, x1] = [p0 - (p1 - p0) * reach, p1 + (p1 - p0) * reach];
    // In pack widths: across, and down (the pack is `ratio` times as tall as it is wide).
    const dx = (x1 - x0) / 100;
    const dy = (y1 - y0) / 100 * ratio;
    const steps = Math.max(2, Math.round((y1 - y0) / 2));
    const along = Array.from({ length: steps + 1 }, (_, k) => y0 + (y1 - y0) * k / steps);
    const at = y => ((y - y0) / (y1 - y0) * 100).toFixed(3);
    const slice = [
      ...along.map(y => `${(50 + thickness(y)).toFixed(2)}% ${at(y)}%`),
      ...[...along].reverse().map(y => `${(50 - thickness(y)).toFixed(2)}% ${at(y)}%`),
    ].join(', ');
    for (const side of ['left', 'right']) {
      const wall = h('i', `pack-wall ${side}`);
      wall.style.clipPath = `polygon(${slice})`;
      wall.style.setProperty('--x', `${x0.toFixed(3)}%`);
      wall.style.setProperty('--y', `${y0.toFixed(3)}%`);
      wall.style.setProperty('--yf', (y0 / 100).toFixed(5));
      wall.style.setProperty('--len', Math.hypot(dx, dy).toFixed(5));
      wall.style.setProperty('--lean', `${(Math.atan2(-dx, dy) * 180 / Math.PI).toFixed(3)}deg`);
      body.append(wall);
    }
  }
  const base = h('i', 'pack-base');
  base.append(h('i', 'pack-sweep'));
  body.append(base);
}

/* Without hardware acceleration, Chrome composites the page in software, and there it drops the
   planes of a 3D scene that are cut by a clip-path: whole bands of the pack's face vanish, and the
   dark back shows through. Such a browser has no WebGL, or a software one: then the pack is drawn
   flat (its face one image, turned in 3D as a whole), without its back and walls. */
let softwareCompositing;
function isSoftwareCompositing() {
  if (softwareCompositing !== undefined) return softwareCompositing;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) softwareCompositing = true;
    else {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      softwareCompositing = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer);
    }
  } catch { softwareCompositing = true; }
  return softwareCompositing;
}

/* ─── Experience ──────────────────────────────────────────────────────────── */

export function openPackExperience({
  requestOpen, remaining = null, capacity = 10, sourceRect = null, packSrc, packSvg, puzzleSvg, puzzleBack, greenSvg, greenBack, globeSvg, globeBack,
  assetOrigin = location.origin, cssText = '', muted = false, onMuteChange, onClose,
  packStyle = 'globe', onPackStyleChange, speed: initialSpeed = 1, onSpeedChange,
  antiSpoil: initialAntiSpoil = false, onAntiSpoilChange, collectionPath = '/collection',
  flat = isSoftwareCompositing(),
} = {}) {
  // The opening is the same whatever the system's "reduce motion" setting (on Windows, turning
  // animation effects off sets it): nothing of it is cut or shortened. Speed stays the player's
  // own choice (×1, ×2, ×3).
  const reduced = false;
  const scale = reduced ? .35 : 1;
  const host = h('div');
  host.dataset.wme = 'pack-opening';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = h('style');
  style.textContent = cssText;

  const dialog = h('dialog');
  dialog.lang = 'fr';
  dialog.tabIndex = -1;
  dialog.setAttribute('aria-label', 'Ouverture du paquet');
  const root = h('div', 'root');
  if (flat) root.dataset.flat = '';
  root.dataset.phase = 'summon';

  const backdrop = h('div', 'backdrop');
  const dim = h('div', 'dim');
  const vignette = h('div', 'vignette');
  const bars = h('div', 'bars');
  bars.append(h('i'), h('i'));
  const stage = h('div', 'stage');
  const camera = h('div', 'camera');
  const center = h('div', 'center');
  const ground = h('div', 'ground');
  const deck = h('div', 'deck');

  const packWrap = h('div', 'pack-wrap');
  const packFloat = h('div', 'pack-float');
  const packTilt = h('div', 'tilt');
  const pack = h('div', 'pack');
  pack.setAttribute('role', 'img');
  pack.setAttribute('aria-label', 'Paquet à déchirer : glisser horizontalement, ou Espace');
  const packBody = h('div', 'pack-body');
  const packLight = h('canvas', 'pack-light'); // The light show (see pack-light.js): behind the cards...
  const packLightFront = h('canvas', 'pack-light pack-light-over'); // ...and in front of them.
  const packLeak = h('canvas', 'pack-light pack-leak'); // The curtain and the glow, in the pack itself.
  for (const canvas of [packLight, packLightFront, packLeak]) canvas.setAttribute('aria-hidden', 'true');
  const packMouth = h('div', 'pack-mouth');
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const packRim = document.createElementNS(SVG_NS, 'svg');
  packRim.setAttribute('class', 'pack-rim');
  packRim.setAttribute('viewBox', '0 0 100 100');
  packRim.setAttribute('preserveAspectRatio', 'none');
  packRim.setAttribute('aria-hidden', 'true');
  const rimDefs = document.createElementNS(SVG_NS, 'defs');
  // The torn edge always catches every rarity colour in turn, whatever is in the pack: the
  // spectrum repeats twice along the seal and drifts along it (driven by `wave`, below, so that the
  // edge of the body, the edge of the ribbon and the light under the tear are one and the same wave).
  const RIM_PERIOD = (SEAL_RIGHT - SEAL_LEFT) / 2;
  const rimGradient = document.createElementNS(SVG_NS, 'linearGradient');
  rimGradient.setAttribute('id', 'wme-rim');
  rimGradient.setAttribute('gradientUnits', 'userSpaceOnUse');
  rimGradient.setAttribute('spreadMethod', 'repeat');
  for (const [name, value] of [['x1', SEAL_LEFT], ['x2', SEAL_LEFT + RIM_PERIOD], ['y1', 0], ['y2', 0]]) rimGradient.setAttribute(name, String(value));
  [...HOLO, HOLO[0]].forEach((color, index) => {
    const stop = document.createElementNS(SVG_NS, 'stop');
    stop.setAttribute('offset', String(index / HOLO.length));
    stop.setAttribute('stop-color', `rgb(${color.join(',')})`);
    stop.setAttribute('stop-opacity', '.9');
    rimGradient.append(stop);
  });
  rimDefs.append(rimGradient);
  const rimShade = document.createElementNS(SVG_NS, 'path');
  const rimEdge = document.createElementNS(SVG_NS, 'path');
  rimShade.setAttribute('class', 'shade');
  rimEdge.setAttribute('class', 'edge');
  rimEdge.setAttribute('stroke', 'url(#wme-rim)');
  packRim.append(rimDefs, rimShade, rimEdge);
  const packSpill = h('div', 'pack-spill');
  // One period of the spectrum, repeated and slid along by the wave.
  packSpill.style.backgroundImage = `linear-gradient(90deg, ${[...HOLO, HOLO[0]].map((color, index, list) => `rgb(${color.join(' ')} / .8) ${(index / (list.length - 1) * 100).toFixed(2)}%`).join(', ')})`;
  packSpill.style.backgroundRepeat = 'repeat-x';
  // At rest the top of the pack is plain art (so the sweep runs over it). Once the tear
  // starts, a canvas draws it as a ribbon that bends off the tear line, column by column.
  const packCap = h('div', 'pack-part pack-cap');
  packCap.append(h('i', 'pack-sweep'));
  const packStrip = h('canvas', 'pack-strip');
  packStrip.setAttribute('aria-hidden', 'true');
  // Where to cut: the dashed tear line, and a pair of scissors snipping along it (see CSS).
  const packGuide = h('div', 'pack-guide');
  // The scissors are the pack's own child, not the line's: the line fades, and anything that fades
  // is flattened, so they would sink into the swell of the pack.
  const guideScissors = h('div', 'guide-scissors');
  guideScissors.innerHTML = `<div class="scissors-body"><svg viewBox="0 0 120 60" aria-hidden="true">${SCISSORS_DEFS}<g class="half half-b">${scissorsHalf('b')}</g><g class="half half-a">${scissorsHalf('a')}</g>${SCISSORS_PIVOT}</svg><i class="snip-spark"></i></div>`;
  buildPackVolume(packBody, { flat });
  pack.append(packBody, packLeak, packMouth, packRim, packSpill, packCap, packStrip, packGuide, guideScissors);

  // Everything that follows the tear line: the top of the pack, the edge of the body, the
  // inside of the pack, the thin rim of torn foil and the light it throws on the front.
  // A new line for each pack.
  function applySeam() {
    makeSeam();
    const band = packBody.querySelector('.pack-face[data-side="front"] .band');
    band.style.clipPath = tornBody(Number(band.dataset.bottom));
    packCap.style.clipPath = capShape();
    packMouth.style.clipPath = mouthShape();
    packSpill.style.clipPath = spillShape();
    rimEdge.setAttribute('d', rimPath(0));
    rimShade.setAttribute('d', rimPath(.34));
  }
  applySeam();
  packTilt.append(pack);
  if (flat) packTilt.append(h('i', 'pack-back'));
  packFloat.append(packTilt);
  packWrap.append(packFloat);
  center.append(ground, deck, packWrap);
  // Beside the camera, not in it: an impact on the camera moves the pack and the cards, and the
  // little pieces stay independent of it.
  const lightCenter = h('div', 'center');
  lightCenter.append(packLight, packLightFront);
  camera.append(center);
  stage.append(camera, lightCenter);

  const caption = h('div', 'caption');
  const captionTags = h('div', 'tags');
  const captionRarity = h('span', 'tag');
  const captionShiny = h('span', 'tag shiny');
  captionShiny.textContent = 'Shiny';
  const captionFav = h('span', 'tag fav');
  captionFav.innerHTML = `${ICONS.star}<span>Favori</span>`;
  captionFav.hidden = true;
  captionTags.append(captionRarity, captionShiny, captionFav);
  const captionTitle = h('div', 'title');
  const captionMeta = h('div', 'meta');
  caption.append(captionTags, captionTitle, captionMeta);
  const tray = h('div', 'tray');
  const counter = h('div', 'counter');
  const hint = h('p', 'hint');
  const openButton = h('button', 'btn primary pack-open-button', 'Ouvrir le paquet');
  openButton.type = 'button';
  openButton.hidden = true;
  const loading = h('div', 'loading');
  loading.setAttribute('aria-hidden', 'true');

  const hud = h('header', 'hud');
  const stock = h('div', 'stock');
  const pips = h('span', 'pips');
  const stockText = h('span');
  stock.append(pips, stockText);
  const actions = h('div', 'hud-actions');
  const speedButton = h('button', 'btn speed');
  speedButton.type = 'button';
  // Goes through the three pack designs (see LOOKS). Icon and label; the label hides on small screens.
  const styleButton = h('button', 'btn text-label design-switch');
  styleButton.type = 'button';
  styleButton.innerHTML = ICONS.palette;
  styleButton.append(h('span', '', 'Changer de design'));
  const spoilButton = h('button', 'btn text-label spoil');
  spoilButton.type = 'button';
  const skipButton = iconButton('btn text-label', 'skip', 'Tout révéler');
  skipButton.append(h('span', '', 'Tout révéler'));
  skipButton.hidden = true;
  const muteButton = iconButton('btn icon', 'sound', 'Couper le son');
  // The way out, always there, top left: back to the page of packs. Leaving never loses anything:
  // a pack is opened on the site the moment it is clicked, its cards are already in the collection.
  const closeButton = h('button', 'btn text-label home');
  closeButton.type = 'button';
  closeButton.innerHTML = ICONS.home;
  closeButton.append(h('span', '', 'Accueil'));
  closeButton.title = 'Quitter l’ouverture et revenir aux paquets';
  closeButton.setAttribute('aria-label', closeButton.title);
  const hudLeft = h('div', 'hud-left');
  hudLeft.append(closeButton, stock);
  actions.append(styleButton, spoilButton, speedButton, skipButton, muteButton);
  hud.append(hudLeft, actions);

  const summary = h('section', 'summary');
  summary.setAttribute('aria-label', 'Récapitulatif du paquet');
  /* A card's sheet, over the summary: the card itself (it turns with the pointer) and, beside it,
     what there is to know about it and what can be done with it. The site's own panel (discard,
     sale, and whatever else the site offers) opens in that same column on demand, one at a time,
     never over the card. */
  const inspect = h('div', 'inspect');
  inspect.setAttribute('role', 'dialog');
  inspect.setAttribute('aria-label', 'Fiche de la carte');
  const sheetBox = h('div', 'sheet');
  const inspectStage = h('div', 'inspect-stage');
  const sheetSide = h('div', 'sheet-side');
  const sheetInfo = h('div', 'sheet-info');
  const inspectBar = h('div', 'inspect-bar');
  const inspectFav = h('button', 'btn inspect-fav');
  inspectFav.type = 'button';
  const inspectWiki = h('a', 'btn inspect-wiki');
  inspectWiki.target = '_blank';
  inspectWiki.rel = 'noopener noreferrer';
  inspectWiki.innerHTML = ICONS.external;
  inspectWiki.append(h('span', '', 'Wikipédia'));
  const inspectSheet = h('button', 'btn inspect-sheet');
  inspectSheet.type = 'button';
  inspectSheet.innerHTML = ICONS.more;
  inspectSheet.append(h('span', '', 'Plus d’actions'));
  inspectSheet.title = 'Ouvre ici la fiche du site : défausse, mise en vente…';
  inspectBar.append(inspectFav, inspectWiki, inspectSheet);
  const inspectNote = h('p', 'inspect-note');
  inspectNote.hidden = true;
  inspectNote.setAttribute('role', 'status');
  // The site's panel, in the column: a way back to the sheet, then the panel (or a wait).
  const sheetSite = h('div', 'sheet-site');
  const sheetHead = h('div', 'sheet-site-head');
  const sheetBack = h('button', 'btn sheet-back');
  sheetBack.type = 'button';
  sheetBack.innerHTML = ICONS.back;
  sheetBack.append(h('span', '', 'Retour à la fiche'));
  sheetHead.append(sheetBack, h('span', 'sheet-site-title', 'Fiche du site'));
  const sheetWait = h('div', 'sheet-wait', 'Ouverture de la fiche du site…');
  sheetSite.append(sheetHead, sheetWait);
  sheetSide.append(sheetInfo, inspectBar, inspectNote, sheetSite);
  sheetBox.append(inspectStage, sheetSide);
  const inspectClose = iconButton('btn icon inspect-close', 'close', 'Fermer la fiche');
  inspect.append(sheetBox, inspectClose);
  const message = h('div', 'message');
  message.hidden = true;
  message.setAttribute('role', 'alertdialog');
  const live = h('div', 'sr-only');
  live.setAttribute('aria-live', 'polite');

  root.append(backdrop, dim, vignette, stage, bars, caption, tray, counter, loading, hint, openButton, hud, summary, inspect, message, live);
  dialog.append(root);
  shadow.append(style, dialog);

  // Five designs, in the order the button goes through them: the white one, the world as a puzzle
  // (the default), the colourful puzzle pack, the green one, the dark foil one and the site's own. Those drawn by the extension get
  // their own dog-eared corner each time. The foil is masked by the art, so it stays hidden until the image
  // is decoded: otherwise the foil and the glow briefly draw a plain rectangle.
  const LOOKS = [
    { name: 'globe', svg: globeSvg, label: 'paquet globe' },
    { name: 'puzzle', svg: puzzleSvg, label: 'paquet puzzle' },
    { name: 'green', svg: greenSvg, label: 'paquet vert' },
    { name: 'dark', svg: packSvg, label: 'paquet sombre' },
    { name: 'classic', label: 'paquet d’origine' },
  ].filter(look => look.name === 'classic' || look.svg);
  const lookOf = name => LOOKS.find(look => look.name === name);
  let packUrls = []; // The object URLs of the art on the pack, freed when it changes.
  let packImage = null; // The art without its sweep, which the ribbon is cut from.
  let packLook = (lookOf(packStyle) ?? LOOKS[0]).name;
  /* A design's art is made (with a new dog-eared corner) and decoded before it goes on the pack,
     so it shows whole the moment it is put on: `prepareLook` returns what puts it there. The
     next design in the button's order is made ahead of time, so that a switch never waits. */
  let lookTurn = 0; // The latest art put on the pack wins over one that arrives later.
  let upcoming = null; // { name, ready }: the next design, made in advance.
  async function prepareLook(name) {
    const art = lookOf(name).svg;
    let url;
    let canvas = null;
    const made = [];
    if (art) {
      // The still art (without the sweep, which is drawn over it, see .pack-sweep), with a new
      // dog-eared corner, drawn once as a bitmap at the size the pack is shown.
      const svg = withFold(art, randomFold()).replace(/<!--sweep-->[\s\S]*?<!--\/sweep-->/, '');
      const source = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const width = pack.offsetWidth || 290;
      try {
        ({ canvas, url } = await rasterArt(source, artPixels(width), artPixels(width * 1000 / 640)));
        made.push(url);
        URL.revokeObjectURL(source);
      } catch {
        url = source; // Left as SVG if it cannot be drawn.
        made.push(source);
      }
    } else url = new URL('/card_pack.png', assetOrigin).href;
    const image = new Image();
    image.src = url;
    let decodeTimeout;
    try {
      await Promise.race([image.decode().catch(() => {}), new Promise(resolve => { decodeTimeout = setTimeout(resolve, 1500); })]);
    } finally { clearTimeout(decodeTimeout); }
    const discard = () => made.forEach(item => URL.revokeObjectURL(item));
    const put = () => {
      for (const item of packUrls) URL.revokeObjectURL(item);
      packUrls = made;
      root.dataset.packStyle = name;
      dressBack(name);
      scissorsFor(name);
      root.style.setProperty('--pack-src', `url("${url}")`);
      root.dataset.packReady = '';
      packImage = canvas ?? (image.complete && image.naturalWidth ? image : null);
      renderStyleButton();
    };
    return { put, discard };
  }
  function prepareNext() {
    const name = nextLook().name;
    if (upcoming?.name === name) return;
    upcoming?.ready.then(({ discard }) => discard());
    upcoming = name === packLook ? null : { name, ready: prepareLook(name) };
    dressBack(name);
  }
  // The art of a design: the one made in advance if it is that one, else a new one.
  function takeLook(name) {
    if (upcoming?.name !== name) return prepareLook(name);
    const { ready } = upcoming;
    upcoming = null;
    return ready;
  }
  // Puts the current design on the pack, as soon as its art is ready (or, given `when`, once that
  // has settled too). Returns false if a newer one took its place meanwhile.
  async function dressPack(when) {
    const turn = ++lookTurn;
    const [look] = await Promise.all([takeLook(packLook), when]);
    if (turn !== lookTurn || !alive) { look.discard(); return false; }
    look.put();
    prepareNext();
    return true;
  }
  // The button's tooltip names the design it switches to.
  const nextLook = () => LOOKS[(LOOKS.indexOf(lookOf(packLook)) + 1) % LOOKS.length];
  function renderStyleButton() {
    styleButton.title = `Changer de design (ensuite : ${nextLook().label})`;
    styleButton.setAttribute('aria-label', styleButton.title);
    styleButton.hidden = LOOKS.length < 2 || !['summon', 'ready'].includes(root.dataset.phase);
  }
  root.style.setProperty('--tear-y', `${TEAR_Y}%`);
  // The cursor over the pack is a pair of scissors, open; while tearing it snips (see apply).
  // Its colours follow the design (see put, in prepareLook).
  function scissorsFor(look) {
    const [open, shut] = SCISSORS_CURSORS[CORAL_SCISSORS.has(look) ? 'puzzle' : 'other'];
    root.style.setProperty('--scissors-open', open);
    root.style.setProperty('--scissors-shut', shut);
  }
  // The backs of the cards that come out of the drawn packs (see pack-opening.css and cardBack):
  // the current design's at once, the next one's with its pack art (see prepareNext). The cards
  // wait for theirs before they come out; if it cannot be had, a back is its plain colour.
  const BACKS = { puzzle: puzzleBack, green: greenBack, globe: globeBack };
  function dressBack(name) {
    if (!BACKS[name]) return Promise.resolve();
    return cardBack(name, BACKS[name]).then(({ url, image }) => {
      if (alive) root.style.setProperty(`--${name}-back`, `url("${url}")`);
      // Decoded again if the browser let it go meanwhile (a page left open a long while): the
      // cards that come out next show it at once.
      return image.decode().catch(() => {});
    }, () => {});
  }
  dressBack(packLook);

  const audio = createAudio(assetOrigin);
  audio.muted = muted;
  let alive = true;
  let opened = 0;
  let packsLeft = remaining;
  let skipAll = false;
  let advanceResolver = null;
  let pointerAdvance = null;
  let tearControl = null;
  let tiltTarget = null;
  let tiltFrame = null;
  let busy = false;
  let switching = false; // The pack is turning to change design: its tilt holds still meanwhile.
  let antiSpoil = Boolean(initialAntiSpoil);
  let liveCard = null; // The card on stage, revealed and waiting for a tap.
  let captionData = null;
  let advanceLockedUntil = 0;
  let packCards = null; // What is in the pack being opened, once the site has answered.
  let tearFront = 0; // How far along the pack the foil has parted (0 to 1), and which way.
  let tearDirection = 1;
  const pointer = { x: innerWidth / 2, y: innerHeight / 2, active: false, at: 0 };
  const tilt = { rx: 0, ry: 0, mx: 50, my: 50, glare: 0 };
  const controller = new AbortController();
  const { signal } = controller;
  const favoriteNotice = h('p', 'favorite-notice');
  favoriteNotice.hidden = true;
  favoriteNotice.setAttribute('role', 'status');
  root.append(favoriteNotice);

  /* Utilities */

  // Playback speed ×1 / ×2 / ×3, for those in a hurry. Applies to every timed step.
  let speed = [1, 2, 3].includes(initialSpeed) ? initialSpeed : 1;
  const pace = () => (skipAll ? .25 : 1) * (reduced ? .5 : 1) / speed;
  function syncSpeed() {
    speedButton.textContent = `×${speed}`;
    speedButton.title = `Vitesse des animations : ×${speed}`;
    speedButton.setAttribute('aria-label', speedButton.title);
    speedButton.dataset.on = String(speed > 1);
    for (const animation of shadow.getAnimations?.() || []) animation.playbackRate = speed;
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms * pace()));

  // Set playback speed at creation, instead of scanning the entire scene every 50 ms.
  function playAnimation(element, keyframes, options) {
    const animation = element.animate(keyframes, options);
    animation.playbackRate = speed;
    return animation;
  }

  async function animate(element, keyframes, options) {
    if (!alive || !element.isConnected) return;
    const duration = options.duration * (skipAll ? .35 : 1) * (reduced ? .5 : 1);
    const animation = playAnimation(element, keyframes, { easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards', ...options, duration });
    try {
      await animation.finished;
      if (element.isConnected) animation.commitStyles();
      animation.cancel();
    } catch { /* Cancelled by a newer animation. */ }
  }

  // How much the room darkens around the card (0 to 1). Never a colour.
  function setDim(value) { root.style.setProperty('--dim', String(value)); }

  function centerPoint() {
    const rect = center.getBoundingClientRect();
    return { x: rect.left, y: rect.top };
  }

  // A soft impact instead of a jolt: the camera dips and rebounds like a damped spring, with a
  // hint of roll, sampled at every frame so that it reads as one smooth motion. Impacts add up
  // (composite `add`), so two in a row never make the picture jump.
  function shakeCamera(strength, duration) {
    if (reduced || skipAll) return;
    const total = duration * 1.6;
    const steps = Math.max(10, Math.round(total / 16));
    const frames = [];
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const decay = Math.exp(-3.4 * t) * (1 - t) ** .5;
      const wave = Math.sin(t * Math.PI * 3);
      frames.push({
        transform: index === steps ? 'none'
          : `translate(${(strength * .2 * decay * Math.sin(t * Math.PI * 3 + 1.1)).toFixed(2)}px, ${(strength * .75 * decay * wave).toFixed(2)}px) rotate(${(strength * .018 * decay * Math.sin(t * Math.PI * 3 + .5)).toFixed(3)}deg)`,
      });
    }
    playAnimation(camera, frames, { duration: total, easing: 'linear', composite: 'add' });
  }

  function say(text) { live.textContent = text; }

  function setHint(html) {
    hint.innerHTML = html || '';
    hint.classList.toggle('on', Boolean(html));
  }

  function renderStock() {
    pips.replaceChildren();
    const value = Number.isInteger(packsLeft) ? packsLeft : null;
    for (let index = 0; index < capacity; index += 1) {
      const pip = h('i');
      if (value !== null && index < value) pip.className = 'on';
      pips.append(pip);
    }
    stockText.innerHTML = value === null ? 'Paquets' : `<b>${value}</b> / ${capacity}`;
    stock.setAttribute('aria-label', value === null ? 'Paquets disponibles' : `${value} paquets disponibles sur ${capacity}`);
  }

  /* Pointer tilt loop */

  function tiltLoop(now) {
    tiltFrame = null;
    if (!alive) return;
    const target = tiltTarget;
    // While the pack turns to change design its tilt holds, so that the turn ends exactly edge on
    // and lands where it set off (it would otherwise follow the pointer, or the idle sway, meanwhile).
    if (target === packTilt && switching) {
      tiltFrame = requestAnimationFrame(tiltLoop);
      return;
    }
    if (target?.isConnected) {
      const idle = !pointer.active || now - pointer.at > 2500;
      let nx;
      let ny;
      if (idle) {
        const t = now / 1000;
        nx = Math.sin(t * .7) * .45;
        ny = Math.cos(t * .9) * .3;
      } else {
        const rect = target.getBoundingClientRect();
        nx = clamp((pointer.x - (rect.left + rect.width / 2)) / (rect.width * .9), -1, 1);
        ny = clamp((pointer.y - (rect.top + rect.height / 2)) / (rect.height * .9), -1, 1);
      }
      if (target === packTilt && root.hasAttribute('data-tearing')) { nx = 0; ny = 0; }
      // Near the favorite star the card holds still, so the star stays where the eye saw it.
      if (liveCard && target === liveCard.tilt && insideZone(favoriteZone(28), pointer.x, pointer.y)) { nx = 0; ny = 0; }
      const strength = reduced ? .3 : 1;
      const turn = target === packTilt || target === deck ? 1 : .7; // A card turns less than the pack.
      tilt.rx += (-ny * 16 * turn * strength - tilt.rx) * .12;
      tilt.ry += (nx * 20 * turn * strength - tilt.ry) * .12;
      tilt.mx += ((nx + 1) * 50 - tilt.mx) * .15;
      tilt.my += ((ny + 1) * 50 - tilt.my) * .15;
      target.style.setProperty('--rx', `${tilt.rx.toFixed(2)}deg`);
      target.style.setProperty('--ry', `${tilt.ry.toFixed(2)}deg`);
      target.style.setProperty('--ry-num', tilt.ry.toFixed(2));
      target.style.setProperty('--mx', `${tilt.mx.toFixed(1)}%`);
      target.style.setProperty('--my', `${tilt.my.toFixed(1)}%`);
      // The pack's glare follows the pointer, and only the pointer: at rest, the sweep is its only shine.
      tilt.glare += ((idle || root.hasAttribute('data-tearing') ? 0 : 1) - tilt.glare) * .12;
      target.style.setProperty('--glare', tilt.glare.toFixed(3));
      tiltFrame = requestAnimationFrame(tiltLoop);
    }
  }

  function setTiltTarget(element) {
    if (tiltTarget && tiltTarget !== element) {
      for (const name of ['--rx', '--ry', '--ry-num', '--mx', '--my', '--glare']) tiltTarget.style.removeProperty(name);
    }
    // The pile eases back to rest when a card takes over the pointer.
    deck.classList.toggle('settle', tiltTarget === deck && element !== deck);
    tiltTarget = element;
    tilt.rx = 0;
    tilt.ry = 0;
    tilt.glare = 0;
    if (!element) {
      cancelAnimationFrame(tiltFrame);
      tiltFrame = null;
    } else if (alive && tiltFrame === null) tiltFrame = requestAnimationFrame(tiltLoop);
  }

  /* Input */

  function waitAdvance() {
    if (skipAll || !alive || finishing) return Promise.resolve();
    pointerAdvance = null;
    return new Promise(resolve => { advanceResolver = resolve; });
  }

  // Only a new press made while the next action is ready may advance it.
  // Animation-time inputs are discarded, never queued or delayed.
  function beginAdvanceInput() {
    if (performance.now() < advanceLockedUntil) return null;
    return alive && !finishing && root.dataset.phase === 'deck' ? advanceResolver : null;
  }
  // A favorite tap must never double as "next card".
  function lockAdvance(ms = 420) { advanceLockedUntil = performance.now() + ms; }

  // Where the star sits on the live card, from the card's own box (which does not tilt).
  // Presses that land near it count as star presses, so a card that moves under the
  // cursor never turns a favorite into a skipped card.
  function favoriteZone(pad = 14) {
    if (!liveCard?.favoriteButton?.isConnected) return null;
    const rect = liveCard.root.getBoundingClientRect();
    return { left: rect.right - 46 - pad, right: rect.right + pad, top: rect.top - pad, bottom: rect.top + 46 + pad };
  }
  const insideZone = (zone, x, y) => Boolean(zone) && x >= zone.left && x <= zone.right && y >= zone.top && y <= zone.bottom;

  function advance() {
    const resolve = advanceResolver;
    advanceResolver = null;
    pointerAdvance = null;
    resolve?.();
  }

  function requestSkip() {
    if (skipAll || !alive) return;
    skipAll = true;
    skipButton.hidden = true;
    clearTimeout(releaseTimer);
    show?.release(); // In a hurry: the pieces go now.
    tearControl?.auto();
    advance();
  }

  /* Tear gesture, as in the TCG apps: swipe across the top of the pack, in either
     direction. The seal peels slice by slice behind the finger while a foil-tearing
     sound follows the speed of the pull; a flick or a swipe past 80 % finishes it,
     anything shorter lets the pack reseal. A tap only nudges the pack. Space tears
     it too, for keyboard users. */

  const PEEL = .26; // How far behind the front of the tear the foil has finished bending.
  const smooth = t => t * t * (3 - 2 * t);

  /* The wave. One phase drives every place the spectrum shows (the torn edge of the body, the
     edge of the ribbon, the light under the tear): it drifts on its own and is pushed along by
     the tear, so the colours flow with the cut instead of standing still. It runs from the first
     movement of the tear until the pack has gone. */
  const wave = { phase: 0, frame: 0, progress: 0, direction: 1 };
  function waveTick(now) {
    wave.frame = 0;
    wave.phase = now * .00042 + wave.direction * wave.progress * 1.2;
    const shift = (wave.phase % 1) * RIM_PERIOD;
    rimGradient.setAttribute('gradientTransform', `translate(${shift.toFixed(3)} 0)`);
    const packWidth = pack.offsetWidth;
    packSpill.style.backgroundSize = `${(RIM_PERIOD / 100 * packWidth).toFixed(2)}px 100%`;
    packSpill.style.backgroundPosition = `${((SEAL_LEFT + shift) / 100 * packWidth).toFixed(2)}px 0`;
    // The ribbon's own edge is drawn, so it is drawn again to follow the wave when the hand is still.
    if (ribbon.on && wave.progress > 0 && wave.progress < 1) drawRibbon(wave.progress, wave.direction);
    if (alive) wave.frame = requestAnimationFrame(waveTick);
  }
  const startWave = () => { if (!wave.frame) wave.frame = requestAnimationFrame(waveTick); };
  const stopWave = () => { cancelAnimationFrame(wave.frame); wave.frame = 0; wave.progress = 0; };

  /* The ribbon. Behind the front of the tear the torn foil comes away from the body: it
     hangs from its crimped top edge and swings out toward the camera, so its torn edge lifts
     off the body and shows in front of the opening. It is drawn on a canvas, one pixel
     column at a time, so the edge is the real frayed tear line (no slicing shows), and each
     column is lit by how far it has turned. Where it has turned, its lower edge catches the
     colour of the light coming from inside. */
  const RIBBON_TURN = 62; // Degrees the free foil swings out, at most.
  const ribbon = { tex: null, width: 0, height: 0, k: 2, key: '', on: false };
  function bakeRibbon() {
    if (!packImage) return false;
    const width = pack.offsetWidth;
    const height = pack.offsetHeight;
    if (!width || !height) return false;
    const key = `${packImage.stamp ?? packImage.src}|${width}|${height}|${packLook}`;
    if (ribbon.tex && ribbon.key === key) return true;
    const k = clamp((devicePixelRatio || 1) * 1.5, 2, 3);
    const texWidth = Math.ceil(width * k);
    const texHeight = Math.ceil(height * (TEAR_Y + 2.5) / 100 * k);
    const tex = document.createElement('canvas');
    tex.width = texWidth;
    tex.height = texHeight;
    // The same placement as the CSS background: centred, at the pack's art size.
    const [scaleX, scaleY] = packLook === 'classic' ? [1.592, 1.318] : [1, 1];
    const drawWidth = scaleX * width * k;
    const drawHeight = scaleY * height * k;
    try {
      tex.getContext('2d').drawImage(packImage, (texWidth - drawWidth) / 2, (height * k - drawHeight) / 2, drawWidth, drawHeight);
    } catch { return false; }
    Object.assign(ribbon, { tex, width, height, k, key });
    packStrip.width = texWidth;
    packStrip.height = texHeight;
    packStrip.style.width = `${texWidth / k}px`;
    packStrip.style.height = `${texHeight / k}px`;
    return true;
  }

  function showRibbon(on) {
    if (ribbon.on === on) return;
    ribbon.on = on;
    if (on) packStrip.dataset.on = '';
    else delete packStrip.dataset.on;
    packCap.style.visibility = on ? 'hidden' : '';
  }

  function drawRibbon(progress, direction) {
    const { tex, k, width, height } = ribbon;
    const ctx = packStrip.getContext('2d');
    const columns = tex.width;
    const front = progress * (1 + PEEL);
    const base = TEAR_Y / 100 * height * k;
    const span = SEAL_RIGHT - SEAL_LEFT;
    const turned = new Float32Array(columns);
    const edgeX = new Float32Array(columns);
    const edgeY = new Float32Array(columns);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, columns, tex.height);
    for (let column = 0; column < columns; column += 1) {
      const along = clamp(((column + .5) / columns * 100 - SEAL_LEFT) / span, 0, 1);
      const t = clamp((front - (direction > 0 ? along : 1 - along)) / PEEL, 0, 1);
      const p = Math.sin(t * Math.PI / 2); // Rising at once at the tip of the tear, easing off behind it.
      const seam = (seamAt(along) + .15) / 100 * height * k;
      const bottom = base * Math.cos(p * RIBBON_TURN * Math.PI / 180) + (seam - base) * (1 - .4 * p);
      const shift = direction * p * 3.5 * k;
      const lift = -p * 1.5 * k;
      ctx.drawImage(tex, column, 0, 1, seam, column + shift, lift, 1.25, bottom);
      turned[column] = p;
      edgeX[column] = column + shift + .5;
      edgeY[column] = lift + bottom;
    }
    // Only paint what is already there, so the shading follows the torn outline.
    ctx.globalCompositeOperation = 'source-atop';
    const light = ctx.createLinearGradient(0, 0, columns, 0);
    const rim = ctx.createLinearGradient(0, 0, columns, 0);
    const STOPS = 48;
    for (let index = 0; index <= STOPS; index += 1) {
      const u = index / STOPS;
      const p = turned[Math.min(columns - 1, Math.round(u * (columns - 1)))];
      light.addColorStop(u, `rgba(255,255,255,${(.02 + .2 * p).toFixed(3)})`);
      const [r, g, b] = waveColor((u * 100 - SEAL_LEFT) / (SEAL_RIGHT - SEAL_LEFT), wave.phase);
      rim.addColorStop(u, `rgba(${r},${g},${b},${(.55 * Math.min(1, p * 2.2)).toFixed(3)})`);
    }
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, columns, tex.height);
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.7 * k;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let column = 0; column < columns; column += 1) {
      if (column) ctx.lineTo(edgeX[column], edgeY[column]);
      else ctx.moveTo(edgeX[column], edgeY[column]);
    }
    ctx.stroke();
  }

  function poseStrip(progress, direction) {
    wave.progress = progress;
    wave.direction = direction;
    if (progress > 0) startWave();
    if (progress > 0) {
      if (!ribbon.on && bakeRibbon()) showRibbon(true);
      if (ribbon.on) drawRibbon(progress, direction);
    } else showRibbon(false);
  }

  function tearGesture() {
    return new Promise(resolve => {
      let progress = 0;
      let drag = null;
      let direction = 1;
      let auto = null;
      let done = false;
      let committed = false;
      let nudgeAnimation = null;
      let held = false;
      let cracked = false;
      let sound = null;
      let hush = 0;
      let lastAt = performance.now();
      let lastValue = 0;

      // Once the tear starts the pack stops floating: it is held still while it rips,
      // which also keeps the cards' way out lined up with the opening.
      function hold() {
        if (held) return;
        held = true;
        const current = getComputedStyle(packFloat).transform;
        packFloat.style.animation = 'none';
        animate(packFloat, [{ transform: current }, { transform: 'none' }], { duration: 160 });
      }

      function silence() {
        clearTimeout(hush);
        sound?.stop();
        sound = null;
      }

      let snippedAt = 0;
      function apply(value) {
        progress = clamp(value, 0, 1);
        // The scissors cursor opens and shuts as the foil parts.
        if (Math.abs(progress - snippedAt) > .045) {
          snippedAt = progress;
          root.toggleAttribute('data-snip');
        }
        pack.style.setProperty('--tear', progress.toFixed(3));
        // How far along the pack the foil has parted: the torn edge and the light follow it.
        pack.style.setProperty('--front', clamp(progress * (1 + PEEL), 0, 1).toFixed(3));
        pack.dataset.tearDir = direction > 0 ? 'ltr' : 'rtl';
        poseStrip(progress, direction);
        tearFront = clamp(progress * (1 + PEEL), 0, 1);
        tearDirection = direction;
        raiseBeams();
        // The air escapes as the foil parts, and the pack leans a little away from the pull.
        pack.style.setProperty('--wme-inflate', (1 - .16 * smooth(progress)).toFixed(3));
        if (held) packFloat.style.transform = `rotateZ(${(-direction * progress * 1.4).toFixed(2)}deg) translateY(${(progress * 3).toFixed(1)}px)`;
        const now = performance.now();
        if (progress > 0) {
          if (!cracked && progress > .05) {
            cracked = true; // The seal gives.
            audio.tick();
            navigator.vibrate?.(6);
          }
          sound ??= audio.tearStart();
          const rate = Math.abs(progress - lastValue) / Math.max(8, now - lastAt) * 1000;
          sound?.set(clamp(rate / 3, 0, 1));
          clearTimeout(hush);
          hush = setTimeout(() => sound?.set(0), 90);
        }
        lastValue = progress;
        lastAt = now;
      }

      function complete() {
        if (done) return;
        done = true;
        openButton.hidden = true;
        cancelAnimationFrame(auto);
        silence();
        navigator.vibrate?.(14);
        cleanup();
        resolve();
      }

      function glide(to, duration, then) {
        cancelAnimationFrame(auto);
        const from = progress;
        const start = performance.now();
        const step = now => {
          const t = clamp((now - start) / (duration * (reduced ? .5 : 1)), 0, 1);
          apply(from + (to - from) * (1 - (1 - t) ** 3));
          if (t < 1 && !done && !drag) auto = requestAnimationFrame(step);
          else if (t >= 1) then?.();
        };
        auto = requestAnimationFrame(step);
      }

      const finish = () => {
        if (done || committed) return;
        committed = true;
        openButton.hidden = true;
        root.dataset.tearing = '';
        hold();
        glide(1, skipAll ? 100 : 200, complete);
      };
      const reseal = () => glide(0, 260, () => { silence(); if (!drag) delete root.dataset.tearing; });

      function nudge() {
        if (nudgeAnimation?.playState === 'running') return;
        nudgeAnimation = playAnimation(packFloat, [
          { transform: 'rotateZ(0)' }, { transform: 'rotateZ(-3deg)' }, { transform: 'rotateZ(2.5deg)' }, { transform: 'rotateZ(-1.5deg)' }, { transform: 'rotateZ(0)' },
        ], { duration: 420, easing: 'ease-out', composite: 'add' });
        playAnimation(hint, [{ transform: 'translateX(-50%) scale(1)' }, { transform: 'translateX(-50%) scale(1.08)' }, { transform: 'translateX(-50%) scale(1)' }], { duration: 360 });
        audio.tick();
      }

      function onStage(event) {
        return !event.composedPath().some(node => node instanceof Element && node.matches('button, .hud, .message'));
      }
      function down(event) {
        if (done || committed || drag || event.button > 0 || !event.isPrimary || !onStage(event)) return;
        audio.unlock();
        cancelAnimationFrame(auto);
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastT: performance.now(), velocity: 0, moved: 0, locked: progress > 0 };
        try { dialog.setPointerCapture(event.pointerId); } catch { /* Synthetic pointer. */ }
      }
      function move(event) {
        if (!drag || event.pointerId !== drag.id || done) return;
        const dx = event.clientX - drag.x;
        drag.moved = Math.max(drag.moved, Math.hypot(dx, event.clientY - drag.y));
        if (!drag.locked && Math.abs(dx) > 6) {
          drag.locked = true;
          direction = Math.sign(dx);
          root.dataset.tearing = '';
          hold();
        }
        const now = performance.now();
        drag.velocity = (event.clientX - drag.lastX) / Math.max(1, now - drag.lastT);
        drag.lastX = event.clientX;
        drag.lastT = now;
        if (!drag.locked) return;
        const width = pack.getBoundingClientRect().width || 1;
        apply(Math.max(0, dx * direction) / (width * .75));
        if (progress >= 1) complete();
      }
      function up(event) {
        if (!drag || event.pointerId !== drag.id || done) return;
        const { velocity, moved } = drag;
        drag = null;
        if (moved < 8 && progress === 0) { nudge(); return; }
        const flick = velocity * direction > 1.1 && progress > .3;
        if (progress >= .78 || flick) finish();
        else reseal();
      }
      function cleanup() {
        dialog.removeEventListener('pointerdown', down);
        dialog.removeEventListener('pointermove', move);
        dialog.removeEventListener('pointerup', up);
        dialog.removeEventListener('pointercancel', up);
        tearControl = null;
      }
      dialog.addEventListener('pointerdown', down);
      dialog.addEventListener('pointermove', move);
      dialog.addEventListener('pointerup', up);
      dialog.addEventListener('pointercancel', up);
      tearControl = {
        auto() {
          if (done || committed || drag) return false;
          direction = 1;
          finish();
          return true;
        },
        cancel() { done = true; cancelAnimationFrame(auto); silence(); cleanup(); },
      };
      if (skipAll) tearControl.auto();
    });
  }

  /* Pack lifecycle */

  function resetPack() {
    pack.style.setProperty('--tear', '0');
    delete pack.dataset.torn;
    delete pack.dataset.tearDir;
    pack.getAnimations().forEach(animation => animation.cancel());
    for (const node of [packStrip, packCap]) {
      node.getAnimations().forEach(animation => animation.cancel());
      node.style.transform = '';
      node.style.visibility = '';
      delete node.dataset.away;
    }
    showRibbon(false);
    stopWave();
    tearFront = 0;
    tearDirection = 1;
    for (const name of ['--front', '--wme-inflate', '--lc', '--la']) pack.style.removeProperty(name);
    clearLight();
    packCards = null;
    applySeam(); // A new tear line for each pack.
    for (const node of [packWrap, packBody, packFloat]) {
      node.getAnimations().forEach(animation => animation.cancel());
      node.style.removeProperty('transform');
      node.style.removeProperty('opacity');
    }
    packFloat.style.animation = '';
    packWrap.style.display = '';
    delete root.dataset.tearing;
    delete root.dataset.cinematic;
    setDim(0);
  }

  async function introPack(first) {
    // Shown in the same frame as the entry's first step, never where it will end up first.
    packWrap.style.visibility = '';
    if (first && sourceRect && !reduced) {
      // The native image is object-contain in a square box; the tall pack art fills its height.
      const packRect = pack.getBoundingClientRect();
      const dx = sourceRect.left + sourceRect.width / 2 - (packRect.left + packRect.width / 2);
      const dy = sourceRect.top + sourceRect.height / 2 - (packRect.top + packRect.height / 2);
      const ratio = clamp(sourceRect.height / packRect.height, .2, 2);
      playAnimation(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 520, fill: 'forwards', easing: 'ease-out' });
      playAnimation(vignette, [{ opacity: 0 }, { opacity: 1 }], { duration: 700, fill: 'forwards' });
      audio.whoosh();
      await animate(packWrap, [
        { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${ratio})` },
        { transform: `translate3d(${dx * .3}px, ${dy * .3 - 40}px, 120px) scale(${ratio + (1 - ratio) * .7}) rotateY(-160deg)`, offset: .55 },
        { transform: 'translate3d(0, 0, 0) scale(1) rotateY(-360deg)' },
      ], { duration: 820, easing: 'cubic-bezier(.3,.7,.2,1)' });
      packWrap.style.transform = 'none';
    } else {
      playAnimation(backdrop, [{ opacity: first ? 0 : 1 }, { opacity: 1 }], { duration: 300, fill: 'forwards' });
      playAnimation(vignette, [{ opacity: first ? 0 : 1 }, { opacity: 1 }], { duration: 300, fill: 'forwards' });
      audio.whoosh(.7);
      // No fade: opacity would flatten the pack's volume while it turns.
      await animate(packWrap, [
        { transform: 'translate3d(0, 70vh, 0) rotateZ(10deg) rotateY(40deg)' },
        { transform: 'translate3d(0, 0, 0) rotateZ(0) rotateY(0)' },
      ], { duration: 620, easing: 'cubic-bezier(.2,.9,.25,1.05)' });
    }
  }

  // The seal comes off the moment the tear is done, whatever the network is doing: the
  // ribbon is flung toward the camera and off to the side, and the opening is left bare.
  function tearAway() {
    root.dataset.phase = 'burst';
    audio.rip();
    for (const name of ['--rx', '--ry']) packTilt.style.removeProperty(name);
    tilt.rx = 0;
    tilt.ry = 0;
    pack.dataset.torn = '';
    pack.style.setProperty('--front', '1');
    const direction = pack.dataset.tearDir === 'rtl' ? -1 : 1;
    // The pack straightens up once the foil has let go.
    animate(packFloat, [{ transform: getComputedStyle(packFloat).transform }, { transform: 'none' }], { duration: 180 });
    // The air the pack was holding gives one last push as the foil lets go.
    const air = parseFloat(getComputedStyle(pack).getPropertyValue('--wme-inflate')) || .84;
    playAnimation(pack, [{ '--wme-inflate': String(air) }, { '--wme-inflate': String(Math.min(1.06, air + .2)), offset: .3 }, { '--wme-inflate': String(air) }], { duration: 300, easing: 'ease-out' });
    openLight();
    // The opening: the edge and the front flare as the foil lets go (whatever is inside).
    playAnimation(pack, [{ '--surge': 0 }, { '--surge': 1, offset: .16 }, { '--surge': .3 }], { duration: 900, fill: 'forwards', easing: 'ease-out' });
    // The torn foil is flung toward the camera and off to the side.
    const flying = ribbon.on ? packStrip : packCap;
    flying.dataset.away = '';
    animate(flying, [
      { transform: 'translateZ(.6px)' },
      { transform: `translate3d(${direction * 46}%, -150%, 340px) rotateZ(${direction * 46}deg) rotateX(-28deg)` },
    ], { duration: 540, easing: 'cubic-bezier(.25,.6,.3,1)' }).then(() => { flying.style.visibility = 'hidden'; });
  }

  /* Light from inside, drawn by pack-light.js on two canvases in the scene: a soft curtain of
     light through the tear while it is torn, then, at the opening, a gentle moving light and
     one small 3D jigsaw piece per card, in the colour of its rarity, with a trail; the pieces
     roam around the cards as they come out, one making a full turn around them (see there).
     It is made of the cards in the pack, or, with anti-spoil, of random colours: the show is
     the same, and tells nothing. The torn edge's own spectrum never depends on the cards. */
  const show = reduced ? null : createLightShow({
    canvas: packLight,
    front: packLightFront,
    leak: packLeak,
    rate: () => 1 / pace(),
    sealLeft: SEAL_LEFT,
    sealRight: SEAL_RIGHT,
    lite: flat,
  });
  const LIGHT = [.3, .32, .56, .74, .9, 1]; // How strongly the inside of the pack takes the best card's colour, by tier.
  let bestTier = 0; // Of the real cards only: it sets the sound.
  let cardsPerPack = 5; // What the last pack held, so that the random show has as many pieces.
  const PIECES_STAY = 1700; // ms the pieces keep circling the settled cards.
  let releaseTimer = 0;

  function clearLight() {
    clearTimeout(releaseTimer);
    show?.clear();
    bestTier = 0;
    delete pack.dataset.lit;
    for (const name of ['--lc', '--la']) pack.style.removeProperty(name);
  }

  // The canvases are sized from the pack, so it is checked before the light is used.
  function fitLight() {
    if (!show) return false;
    const packWidth = pack.offsetWidth;
    if (!packWidth) return false;
    // Placed in the scene, not in the pack: when the pack falls away the pieces stay where they are.
    if (show.width !== packWidth) show.layout(packWidth, -.78 * packWidth + TEAR_Y / 100 * pack.offsetHeight, stage.offsetHeight, TEAR_Y / 100 * pack.offsetHeight);
    return true;
  }

  // While the foil is torn the light only leaks through the tear.
  function raiseBeams() {
    if (pack.hasAttribute('data-lit') && fitLight()) show.leak(tearFront, tearDirection);
  }

  // The opening. What room there is decides how big the show is: above the pack for the glow,
  // and around where the cards end up for the orbits, so nothing is cut off by the screen.
  function openLight() {
    tearFront = 1;
    if (!pack.hasAttribute('data-lit') || !fitLight()) return;
    const packWidth = pack.offsetWidth;
    const hudBottom = hud.getBoundingClientRect().bottom || 56;
    const seam = pack.getBoundingClientRect().top + pack.offsetHeight * TEAR_Y / 100;
    const middle = centerPoint();
    const above = Math.min(middle.y - hudBottom, innerHeight - middle.y) - 24;
    const sides = Math.min(middle.x, innerWidth - middle.x) - 16;
    show.setFit({ glow: (seam - hudBottom - 20) / (1.1 * packWidth), x: sides / (1.05 * packWidth), y: above / (1.3 * packWidth) });
    audio.whoosh(.6);
    if (bestTier >= 3) audio.shimmer();
    show.burst();
  }

  function lightPack(cards) {
    if (antiSpoil || pack.hasAttribute('data-lit') || !cards?.length) return;
    pack.dataset.lit = '';
    const byTier = [...cards].sort((a, b) => (META[b.rarity]?.tier ?? 0) - (META[a.rarity]?.tier ?? 0));
    const order = [];
    byTier.forEach((card, index) => (index % 2 ? order.unshift(card) : order.push(card)));
    show?.setCards(order.map(card => {
      const meta = META[card.rarity] || META.C;
      return { rgb: meta.rgb.split(' ').map(Number), tier: meta.tier, shiny: Boolean(card.isShiny) };
    }));
    const best = META[byTier[0].rarity] || META.C;
    bestTier = best.tier;
    pack.style.setProperty('--lc', best.rgb);
    pack.style.setProperty('--la', String(best.tier >= 1 ? LIGHT[best.tier] : 0));
    if (pack.hasAttribute('data-torn')) openLight(); // The answer came after the opening.
    else raiseBeams();
  }

  // Anti-spoil: the same show, of random colours, sizes and strengths, that does not wait for
  // the answer and has nothing to do with what is in the pack. The big turn is a random piece.
  function lightRandom() {
    if (pack.hasAttribute('data-lit') || !show) return;
    pack.dataset.lit = '';
    const count = cardsPerPack;
    const list = Array.from({ length: count }, () => {
      const rgb = HOLO[Math.floor(Math.random() * HOLO.length)];
      return { rgb: [...rgb], tier: 1 + Math.floor(Math.random() * 3), shiny: false };
    });
    show.setCards(list, Math.floor(Math.random() * count));
    pack.style.setProperty('--lc', list[0].rgb.join(' '));
    pack.style.setProperty('--la', '.4');
    if (pack.hasAttribute('data-torn')) openLight();
    else raiseBeams();
  }

  // The pile: each card is a slab, so the stack gains real thickness.
  const DECK_STEP = 4; // px of thickness per card.
  let deckJitter = [];
  function stackPose(position, key = position) {
    const jitter = deckJitter[key] || { x: 0, y: 0, r: 0 };
    return `translate3d(${jitter.x}px, ${jitter.y}px, ${-position * DECK_STEP}px) rotateZ(${jitter.r}deg)`;
  }
  const spotlightPose = 'translate3d(0, 0, 80px) scale(1.04)';
  const shade = position => (Math.min(position, 9) * .03).toFixed(3);

  /* The cards slide out of the opening. While they are inside they sit just behind the
     front of the pack, thin, so the pack's own skin hides them exactly where it should;
     the pack holds still (no tilt, no float) so the two stay lined up. The empty wrapper
     then slips straight down, uncovering them, and only once it has cleared them do they
     settle into their pile and take on their thickness: if they moved while it was still
     in front, it would hide them. */
  async function emerge(cards, best) {
    deck.replaceChildren();
    deckJitter = cards.map(() => ({ x: +rand(-1.4, 1.4).toFixed(2), y: +rand(-1.2, 1.2).toFixed(2), r: +rand(-.6, .6).toFixed(2) }));
    const cardWidth = deck.offsetWidth || 240;
    const packWidth = pack.offsetWidth || 240;
    const packHeight = pack.offsetHeight || packWidth * 1.5625;
    const fit = Math.min(1, packWidth * .86 / cardWidth); // Narrower than the pack they leave.
    const out = Math.min(1, packWidth * .94 / cardWidth);
    const cardHeight = 1.4 * cardWidth;
    const mouth = (TEAR_Y / 100 - .5) * packHeight; // Where the pack was torn, from its centre.
    const hidden = mouth + 12 + cardHeight * fit / 2; // Resting just under the opening.
    // Up to two thirds out, but never past the top of the screen (a short window leaves little room).
    const room = centerPoint().y + mouth - 72;
    const shown = clamp(room / (out * cardHeight), .2, .64);
    const lifted = mouth - cardHeight * out * shown + cardHeight * out / 2;
    const inside = index => -.8 - index * .3; // Behind the front skin (which is at 0 or more).
    const start = index => `translate3d(0, ${hidden}px, ${inside(index)}px) scale(${fit})`;
    const up = index => `translate3d(0, ${lifted - index * 9}px, ${inside(index)}px) scale(${out})`;
    cards.forEach((card, index) => {
      card.root.classList.add('in-pack');
      card.root.dataset.jit = String(index);
      card.root.style.zIndex = String(cards.length - index);
      card.root.style.setProperty('--dark', shade(index));
      card.root.style.transform = start(index);
      deck.append(card.root);
    });
    await sleep(40);
    audio.whoosh(.9);
    // The pull on the camera is a hint of the best rarity: anti-spoil keeps it out.
    if (!antiSpoil && best.meta.tier >= 3) shakeCamera(best.meta.tier >= 4 ? 8 : 5, 420);
    const direction = pack.dataset.tearDir === 'rtl' ? -1 : 1;
    // The pack starts to fall while the cards are still coming out: it slides down and away
    // (gravity: slow to start, then quicker), uncovering them.
    const shell = (async () => {
      await sleep(140);
      show?.dim(); // The light at the tear fades as the pack falls away; the pieces stay.
      const air = getComputedStyle(pack).getPropertyValue('--wme-inflate').trim() || '1';
      playAnimation(pack, [{ '--wme-inflate': air }, { '--wme-inflate': '.1' }], { duration: 520, fill: 'forwards', easing: 'ease-in' });
      await animate(packWrap, [
        { transform: 'none' },
        { transform: `translate3d(${direction * 4}%, 130vh, 0) rotateZ(${direction * 6}deg)` },
      ], { duration: 600, easing: 'cubic-bezier(.5,0,.85,.55)' });
      packWrap.style.display = 'none';
      stopWave();
    })();
    // When the pack no longer overlaps the cards, they may come forward.
    const cleared = new Promise(resolve => {
      const check = () => {
        // A pack already gone (hidden once fallen, when frames were scarce) is out of the way too.
        const box = packBody.getBoundingClientRect();
        if (!alive || !box.height || box.top > cards[0].root.getBoundingClientRect().bottom + 6) resolve();
        else requestAnimationFrame(check);
      };
      check();
    });
    // Each card makes one flowing motion: it rises out of the pack, easing to a stop at the top
    // of its climb, then, with no pause and no jolt (it starts from a stop, and the ease-in makes
    // it leave gently), it comes forward and down into the pile, and lands softly. A card's
    // climb and its fall meet at zero speed, so the joint cannot be felt.
    const flights = cards.map(async (card, index) => {
      await animate(card.root, [{ transform: start(index) }, { transform: up(index) }],
        { duration: 680, delay: index * 30 * scale, easing: 'cubic-bezier(.3,.45,.25,1)' });
      await cleared;
      if (!alive) return;
      card.root.classList.replace('in-pack', 'in-deck');
      const y0 = lifted - index * 9;
      const jitter = deckJitter[index] || { y: 0 };
      const at = share => `translate3d(0, ${(y0 + (jitter.y - y0) * share).toFixed(1)}px, ${(inside(index) + (-index * DECK_STEP - inside(index)) * share + Math.sin(Math.PI * share) * 16).toFixed(1)}px) scale(${(out + (1 - out) * share).toFixed(4)})`;
      await animate(card.root, [
        { transform: up(index) },
        { transform: at(.3), offset: .3 },
        { transform: at(.7), offset: .7 },
        { transform: `${stackPose(index)} scale(1)` },
      ], { duration: 640, easing: 'cubic-bezier(.42,0,.2,1)' });
    });
    await Promise.all(flights);
    // The cards are settled, and the pieces stay with them a good while longer before they drift off.
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => show?.release(), PIECES_STAY * pace());
    await shell;
  }

  function buildTray(count) {
    tray.replaceChildren();
    counter.replaceChildren();
    for (let index = 0; index < count; index += 1) {
      tray.append(h('div', 'slot'));
      counter.append(h('i'));
    }
    counter.classList.add('on');
  }

  function setCharge(card, value) { card.root.style.setProperty('--wme-charge', String(value)); }

  async function reveal(card, index, total) {
    const { tier } = card.meta;
    const fast = skipAll;
    // Anti-spoil: nothing before the flip may hint at the rarity (no charge, no cinematic,
    // no different turn or sound), so every card is turned the same way.
    const blind = antiSpoil;
    card.root.classList.remove('in-deck');
    captionClear();

    // The rest of the pile closes the gap: each card rises by one step.
    [...deck.children].forEach(node => {
      const position = Number(node.dataset.stack || 0);
      if (node === card.root || !node.classList.contains('in-deck')) return;
      const next = Math.max(0, position - 1);
      node.dataset.stack = String(next);
      node.style.setProperty('--dark', shade(next));
      animate(node, [{ transform: getComputedStyle(node).transform }, { transform: stackPose(next, Number(node.dataset.jit)) }], { duration: 240 });
    });

    card.root.style.zIndex = '50';
    const lifting = animate(card.root, [{ transform: getComputedStyle(card.root).transform }, { transform: spotlightPose }], { duration: 300 });
    // A plain card turns while it is still arriving; a charged one waits for the stage.
    if (!blind && !fast && tier >= 2) await lifting;
    else await sleep(140);

    if (!blind) {
      if (tier >= 4 && !fast) await legendaryCharge(card);
      else if (tier >= 2 && !fast) await charge(card, tier);
      else if (tier >= 3) setCharge(card, 1);
    }

    // Flip. Above rare the card turns a full circle, held for a beat before it lands.
    card.root.dataset.face = 'front';
    audio.flip(!blind && tier >= 3 ? .85 : 1);
    const spin = tier >= 3 && !fast && !blind;
    const flipDone = animate(card.flip, [
      { transform: 'rotateY(180deg)' },
      { transform: spin ? 'rotateY(-340deg) scale(1.06)' : 'rotateY(-12deg) scale(1.03)', offset: .78 },
      { transform: spin ? 'rotateY(-360deg)' : 'rotateY(0deg)' },
    ], { duration: spin ? 760 : 420, easing: 'cubic-bezier(.3,.7,.2,1)' });
    await (spin ? sleep(320) : flipDone);

    setCharge(card, 0);
    audio.chime(tier);
    if (tier >= 1) card.root.classList.add('pass');
    if (tier === 2) { if (!fast) shakeCamera(3, 240); }
    else if (tier === 3) {
      audio.boom();
      setDim(.4);
      if (!fast) shakeCamera(6, 420);
      navigator.vibrate?.([20, 40, 40]);
    } else if (tier >= 4) legendaryPayoff(card);
    if (card.data.isShiny) {
      audio.shimmer();
      card.root.classList.add('pass');
    }

    await Promise.all([flipDone, lifting]);
    addFavorite(card);
    liveCard = card;
    card.root.classList.add('live');
    setTiltTarget(card.tilt);
    captionShow(card, index, total);
    counter.children[index]?.classList.add('done');
    counter.children[index]?.style.setProperty('--dot', card.meta.color);
    say(`Carte ${index + 1} sur ${total} : ${card.data.title}, ${card.meta.name}${card.data.isShiny ? ', shiny' : ''}.`);
  }

  // Tension without effects: the card comes closer, its rim lights up in its own colour,
  // and the room darkens a little more at each step.
  async function charge(card, tier) {
    const duration = tier >= 3 ? 950 : 520;
    audio.rumble(duration / 1000, tier >= 3 ? 1 : .6);
    if (tier >= 3) audio.rise(duration / 1000);
    if (tier >= 3) {
      setDim(.5);
      animate(card.root, [{ transform: spotlightPose }, { transform: 'translate3d(0, -1%, 130px) scale(1.06)' }], { duration, easing: 'cubic-bezier(.5,0,.75,.4)' });
    }
    card.root.classList.add(tier >= 3 ? 'shake-2' : 'shake-1');
    const steps = tier >= 3 ? 4 : 2;
    for (let step = 0; step < steps; step += 1) {
      setCharge(card, (step + 1) / steps);
      if (step === steps - 1 && tier >= 3) card.root.classList.replace('shake-2', 'shake-3');
      await sleep(duration / steps);
    }
    card.root.classList.remove('shake-1', 'shake-2', 'shake-3');
  }

  // The legendary cinematic: letterbox, the room goes dark, three heartbeats, then the turn.
  async function legendaryCharge(card) {
    root.dataset.cinematic = 'legendary';
    setDim(.92);
    // The rest of the pile falls into shade with the room. It stays there: it never disappears.
    for (const node of deck.children) if (node !== card.root) node.style.setProperty('--dark', '.88');
    await animate(card.root, [{ transform: spotlightPose }, { transform: 'translate3d(0, -2%, 120px) scale(1.06)' }], { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)' });
    for (let beat = 0; beat < 3; beat += 1) {
      audio.heartbeat();
      setCharge(card, (beat + 1) / 3);
      playAnimation(card.tilt, [{ transform: 'scale(1)' }, { transform: 'scale(1.06)', offset: .18 }, { transform: 'scale(1)', offset: .4 },
        { transform: 'scale(1.035)', offset: .55 }, { transform: 'scale(1)' }], { duration: 480 });
      await sleep(500 - beat * 60);
    }
    audio.rumble(1, 1.2);
    audio.rise(1);
    card.root.classList.add('shake-2');
    for (let step = 0; step < 4; step += 1) {
      if (step === 2) card.root.classList.replace('shake-2', 'shake-3');
      shakeCamera(3 + step * 2, 250);
      await sleep(250);
    }
    card.root.classList.remove('shake-2', 'shake-3');
    await sleep(80);
  }

  function legendaryPayoff(card) {
    audio.boom();
    audio.fanfare();
    navigator.vibrate?.([40, 60, 120]);
    shakeCamera(12, 700);
    setDim(.5);
    delete root.dataset.cinematic;
    card.root.classList.add('again');
    for (const node of deck.children) {
      if (node !== card.root && node.classList.contains('in-deck')) node.style.setProperty('--dark', shade(Number(node.dataset.stack || 0)));
    }
  }

  /* Favorites. The star stays on the card, but it is only one of three ways in: a
     press near it counts, the F key works, and the button in the inspector too. The
     state shows at once and the site's own button confirms it in the background. */

  function renderFavoriteButton(button, data) {
    const on = Boolean(data.starred);
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-busy', String(Boolean(data.favoritePending)));
    const label = on ? 'Retirer des favoris' : 'Ajouter aux favoris';
    button.title = label;
    button.setAttribute('aria-label', label);
    const text = button.querySelector('.fav-label');
    if (text) text.textContent = on ? 'Favori' : 'Ajouter aux favoris';
  }

  function syncFavorite(data) {
    if (!data.ownedId) return;
    for (const node of shadow.querySelectorAll('.card')) {
      if (node.dataset.ownedId === data.ownedId) node.dataset.starred = String(Boolean(data.starred));
    }
    for (const button of shadow.querySelectorAll('[data-fav-for]')) {
      if (button.dataset.favFor !== data.ownedId) continue;
      const before = button.getAttribute('aria-pressed');
      renderFavoriteButton(button, data);
      if (before !== null && before !== String(Boolean(data.starred)) && !reduced) {
        button.animate([{ scale: 1 }, { scale: 1.28 }, { scale: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    }
    if (captionData === data) captionFav.hidden = !data.starred;
  }

  async function toggleFavorite(data) {
    if (!data.ownedId || data.favoritePending) return;
    favoriteNotice.hidden = true;
    const desired = !data.starred;
    data.favoritePending = true;
    data.starred = desired; // Shown at once; the site's own button confirms it.
    syncFavorite(data);
    say(desired ? 'Ajout aux favoris…' : 'Retrait des favoris…');
    try {
      await savePackFavorite(data, desired, { path: collectionPath });
      document.dispatchEvent(new Event('wme:collection-changed'));
      say(desired ? 'Carte ajoutée aux favoris.' : 'Carte retirée des favoris.');
    } catch {
      data.starred = !desired; // The site did not confirm: back to what it was.
      say('Favori non confirmé. Réessaie avec l’étoile.');
      favoriteNotice.textContent = 'Favori non confirmé. Réessaie avec l’étoile.';
      favoriteNotice.hidden = false;
    } finally {
      data.favoritePending = false;
      syncFavorite(data);
    }
  }

  function addFavorite(card) {
    if (!card.data.ownedId) return null;
    const button = iconButton('card-favorite', 'star', 'Ajouter aux favoris');
    button.dataset.favFor = card.data.ownedId;
    renderFavoriteButton(button, card.data);
    for (const type of ['pointerdown', 'pointerup', 'dblclick', 'keydown', 'keyup']) {
      button.addEventListener(type, event => event.stopPropagation(), { signal });
    }
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      lockAdvance();
      toggleFavorite(card.data);
    }, { signal });
    card.root.querySelector('.front').append(button);
    card.favoriteButton = button;
    return button;
  }

  function captionShow(card, index, total) {
    caption.dataset.tier = String(card.meta.tier);
    caption.style.setProperty('--c-rgb', card.meta.rgb);
    captionData = card.data;
    captionRarity.textContent = card.meta.name;
    captionShiny.hidden = !card.data.isShiny;
    captionFav.hidden = !card.data.starred;
    captionTitle.textContent = card.data.title;
    const details = [];
    if (card.data.pageviews !== undefined) details.push(`${numberFormat.format(card.data.pageviews)} vues / 30 j`);
    details.push(`${index + 1} / ${total}`);
    captionMeta.textContent = details.join(' · ');
    caption.classList.add('on');
  }
  function captionClear() { caption.classList.remove('on'); captionData = null; }

  // A card goes to its place in the tray in a quarter of a second, and the next one
  // is already coming forward while it travels.
  async function stash(card, index) {
    const slot = tray.children[index];
    card.root.querySelector('.card-favorite')?.remove();
    card.favoriteButton = null;
    if (liveCard === card) liveCard = null;
    card.root.classList.remove('live');
    setTiltTarget(deck);
    captionClear();
    setDim(0);
    if (!slot) { card.root.remove(); return; }
    const slotRect = slot.getBoundingClientRect();
    const { x, y } = centerPoint();
    const cardWidth = card.root.getBoundingClientRect().width || 1;
    const targetScale = slotRect.width / (cardWidth / 1.04);
    audio.whoosh(.5);
    await animate(card.root, [
      { transform: getComputedStyle(card.root).transform, opacity: 1 },
      { transform: `translate3d(${slotRect.left + slotRect.width / 2 - x}px, ${slotRect.top + slotRect.height / 2 - y}px, 0) scale(${targetScale}) rotateZ(${rand(-6, 6)}deg)`, opacity: 1 },
    ], { duration: 240, easing: 'cubic-bezier(.5,0,.2,1)' });
    const mini = createCard(card.data, assetOrigin, { face: 'front' });
    slot.replaceChildren(mini.root);
    playAnimation(mini.root, [{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 160, easing: 'ease-out' });
    card.root.remove();
  }

  /* Summary */

  function renderSummary(cards) {
    summary.replaceChildren();
    setTiltTarget(null);
    const head = h('div', 'summary-head');
    const best = cards.reduce((top, card) => card.meta.tier > top.meta.tier ? card : top, cards[0]);
    const heading = h('h2', '', best.meta.tier >= 4 ? 'Paquet légendaire' : best.meta.tier >= 3 ? 'Superbe paquet' : 'Paquet ouvert');
    heading.tabIndex = -1;
    heading.style.outline = 'none';
    head.append(heading);
    const tally = h('div', 'tally');
    for (const rarity of ['L', 'UR', 'SR', 'R', 'PC', 'C']) {
      const amount = cards.filter(card => card.data.rarity === rarity).length;
      if (!amount) continue;
      const chip = h('span', 'tally-chip');
      chip.style.setProperty('--c-rgb', META[rarity].rgb);
      chip.append(h('b', '', rarity), h('span', '', `${amount} × ${META[rarity].name}`));
      tally.append(chip);
    }
    const shinyCount = cards.filter(card => card.data.isShiny).length;
    if (shinyCount) {
      const chip = h('span', 'tally-chip shiny');
      chip.append(h('b', '', 'Shiny'), h('span', '', `× ${shinyCount}`));
      tally.append(chip);
    }
    head.append(tally);

    const fan = h('div', 'fan');
    fan.setAttribute('role', 'list');
    const count = cards.length;
    const narrow = innerWidth < 720;
    cards.forEach((card, index) => {
      const node = createCard(card.data, assetOrigin, { face: 'front' });
      const offset = index - (count - 1) / 2;
      node.root.setAttribute('role', 'listitem');
      node.root.tabIndex = 0;
      node.root.setAttribute('aria-label', `${card.data.title}, ${card.meta.name}${card.data.isShiny ? ', shiny' : ''}`);
      if (narrow) {
        const columns = Math.min(3, count);
        const row = Math.floor(index / columns);
        const inRow = Math.min(columns, count - row * columns);
        const col = index - row * columns - (inRow - 1) / 2;
        node.root.style.setProperty('--fx', `calc(${col} * (var(--w) + 10px))`);
        node.root.style.setProperty('--fy', `calc(${row - (Math.ceil(count / columns) - 1) / 2} * (var(--w) * 1.4 + 12px))`);
      } else {
        node.root.style.setProperty('--fx', `calc(${offset} * var(--w) * .96)`);
        node.root.style.setProperty('--fy', `${Math.abs(offset) ** 2 * 10}px`);
        node.root.style.setProperty('--fr', `${offset * 4}deg`);
      }
      node.root.style.zIndex = String(index + 1);
      // The click stops here: reaching the dialog's own handler would close what it just opened.
      node.root.addEventListener('click', event => { event.stopPropagation(); openInspect(card); }, { signal });
      node.root.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); openInspect(card); }
      }, { signal });
      node.root.addEventListener('pointerenter', () => { node.root.classList.add('live'); setTiltTarget(node.tilt); pointer.at = performance.now(); }, { signal });
      node.root.addEventListener('pointerleave', () => { node.root.classList.remove('live'); if (tiltTarget === node.tilt) setTiltTarget(null); node.tilt.style.removeProperty('--rx'); node.tilt.style.removeProperty('--ry'); }, { signal });
      fan.append(node.root);
      playAnimation(node.root, [
        { opacity: 0, translate: '0 60px', scale: '.8' },
        { opacity: 1, translate: '0 0', scale: '1' },
      ], { duration: 620 * scale, delay: index * 90 * scale, easing: 'cubic-bezier(.2,.9,.25,1.1)', fill: 'backwards' });
    });

    const footer = h('div', 'summary-actions');
    const another = h('button', 'btn primary', 'Ouvrir un autre paquet');
    another.type = 'button';
    const left = Number.isInteger(packsLeft) ? packsLeft : null;
    if (left !== null) another.append(h('span', '', `· ${left}`));
    another.disabled = left === 0;
    if (left === 0) another.title = 'Plus de paquet disponible pour le moment.';
    // A pack is a consumable: ignore taps and key repeats carried over from the reveal.
    const armedAt = performance.now() + 900;
    tabbed = false;
    another.addEventListener('click', event => {
      if (!event.isTrusted || busy || another.disabled || performance.now() < armedAt) return;
      if (event.detail === 0 && !tabbed) return;
      runPack(false);
    }, { signal });
    const done = h('button', 'btn large', 'Terminer');
    done.type = 'button';
    done.addEventListener('click', () => finish(), { signal });
    footer.append(another, done);
    summary.append(head, fan, footer);
    root.dataset.phase = 'summary';
    setHint('');
    counter.classList.remove('on');
    say(`Paquet terminé. ${cards.length} cartes obtenues.`);
    requestAnimationFrame(() => heading.focus({ preventScroll: true }));
  }

  /* Inspector: a card of the summary, large, with what one does with a card. The site's
     own card panel opens for that copy (favorite, discard, auction…), inside a frame on
     top of the summary. While it loads, and if it cannot open, the large card and the
     favorite star stay available. */

  const MODAL = '.fixed.inset-0, [role="dialog"], dialog[open]';
  let inspectCard = null;
  let sheet = null;

  function closeSheet({ silent = false } = {}) {
    if (!sheet) return false;
    const current = sheet;
    sheet = null;
    current.cancelled = true;
    clearInterval(current.watch);
    current.observer?.disconnect();
    current.frame.remove();
    inspect.classList.remove('sheet-ready');
    // The panel may have changed something (a favorite, a discard, a sale): tell the collection.
    if (current.ready && !silent) document.dispatchEvent(new Event('wme:collection-changed'));
    return true;
  }

  // A click at the middle of the card, as a player would give it: it never lands on the
  // star or on any button of the card, only on its face.
  function pressCard(doc, row) {
    try { row.scrollIntoView({ block: 'center' }); } catch { /* Not scrollable. */ }
    const rect = row.getBoundingClientRect();
    let target = doc.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height * .58);
    if (!target || !row.contains(target)) target = row.querySelector('h3') || row;
    const control = target.closest('button, a');
    if (control && row.contains(control) && control !== row && /favori|défauss|discard/i.test(control.getAttribute('aria-label') || control.textContent)) {
      target = row.querySelector('h3') || row;
    }
    target.click();
  }

  // Everything but the site's own panel disappears from the frame, and the panel keeps its
  // own look. If the click navigated elsewhere instead, the page is shown as it is.
  function presentSheet(run, doc) {
    // Only the card's own panel shows: the other dialogs of the page (menus, notices, other
    // panels) all stayed visible before, and a second, unrelated sheet appeared beside it.
    run.modal.setAttribute('data-wme-sheet', '');
    const style = doc.createElement('style');
    style.dataset.wme = 'sheet';
    style.textContent = 'html,body{background:#17171a!important;overflow:hidden!important}body>*{visibility:hidden!important}'
      + '[data-wme-sheet]{visibility:visible!important}[data-wme-sheet].fixed{background:transparent!important;backdrop-filter:none!important}'
      + '[role="alert"],[role="status"]{visibility:visible!important}';
    doc.head.append(style);
    // What the panel opens in turn (the sale's own dialog, a confirmation…) is shown too: hidden,
    // it could not be clicked, and the panel stood stuck. Only windows that appear after the card
    // was pressed; those the page had before stay hidden.
    const reveal = () => {
      for (const node of doc.querySelectorAll(MODAL)) {
        if (!run.before.has(node) && !node.hasAttribute('data-wme-sheet')) node.setAttribute('data-wme-sheet', '');
      }
    };
    run.observer = new MutationObserver(reveal);
    run.observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'role', 'class'] });
    run.ready = true;
    inspect.classList.add('sheet-ready');
    try { run.frame.contentWindow.focus(); } catch { /* Focus stays here. */ }
    // Closing the panel from inside it (its own close button, Escape, a finished discard) returns to the summary.
    run.watch = setInterval(() => {
      if (run.cancelled || !alive) { clearInterval(run.watch); return; }
      let open = false;
      try { open = run.modal.isConnected || [...doc.querySelectorAll(MODAL)].some(node => !run.before.has(node)); } catch { open = false; }
      run.gone = open ? 0 : run.gone + 1;
      if (run.gone >= 3) showSheetInfo();
    }, 250);
  }

  async function openNativeSheet(card) {
    closeSheet({ silent: true });
    const data = card.data;
    const account = document.documentElement.getAttribute('data-wme-account');
    if (!UUID.test(data.ownedId || '') || !account || !navigator.onLine) return 'unavailable';
    const frame = document.createElement('iframe');
    frame.title = `Fiche de ${data.title}`;
    frame.className = 'sheet-frame';
    frame.src = new URL(collectionPath, location.origin).href;
    const run = { frame, cancelled: false, ready: false, gone: 0, before: null, modal: null, watch: 0 };
    sheet = run;
    sheetSite.append(frame);
    const walk = collectionWalker(frame, { ownedId: data.ownedId, title: data.title, account, path: collectionPath });
    const deadline = Date.now() + 25_000;
    let pressed = 0;
    try {
      while (Date.now() < deadline && !run.cancelled && alive) {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (run.cancelled || !alive) return 'cancelled';
        if (document.documentElement.getAttribute('data-wme-account') !== account) break;
        const found = walk({ search: !pressed });
        if (!found?.row) continue;
        const { doc, row } = found;
        if (!pressed) {
          run.before = new Set(doc.querySelectorAll(MODAL));
          pressed = Date.now();
          pressCard(doc, row);
          continue;
        }
        const fresh = [...doc.querySelectorAll(MODAL)].filter(node => !run.before.has(node));
        // An overlay and its panel can come as two elements: the panel is the one to show.
        const modal = fresh.find(node => node.matches('[role="dialog"], dialog')) ?? fresh[0];
        if (modal) {
          run.modal = modal;
          presentSheet(run, doc);
          return 'ready';
        }
        if (Date.now() - pressed > 4000) break; // The press did nothing.
      }
    } catch { /* Handled below. */ }
    const cancelled = run.cancelled; // Closing the sheet marks it cancelled, so read it first.
    if (sheet === run) closeSheet({ silent: true });
    return cancelled ? 'cancelled' : 'failed';
  }

  // The site's panel, in the sheet's column. Its actions are the site's own, so they all work
  // as on the collection page; it is only ever opened by the player.
  async function openSheetFor(card) {
    inspectNote.hidden = true;
    inspect.classList.add('site');
    inspect.classList.remove('sheet-ready');
    sheetBack.focus({ preventScroll: true });
    const outcome = await openNativeSheet(card);
    if (inspectCard !== card) return;
    if (outcome === 'failed' || outcome === 'unavailable') {
      showSheetInfo();
      inspectNote.textContent = 'La fiche du site ne s’est pas ouverte. Tu retrouves cette carte dans ta collection.';
      inspectNote.hidden = false;
    }
  }
  function showSheetInfo() {
    closeSheet();
    inspect.classList.remove('site', 'sheet-ready');
  }

  const numberLabel = value => (Number.isFinite(value) ? numberFormat.format(value) : '—');
  // What the sheet says about a card, beside it.
  function fillSheet(card) {
    const data = card.data;
    const meta = META[data.rarity] || META.C;
    const chips = h('div', 'sheet-chips');
    const rarity = h('span', 'sheet-rarity', meta.name);
    rarity.style.setProperty('--c-rgb', meta.rgb);
    chips.append(rarity);
    if (data.isShiny) chips.append(h('span', 'sheet-rarity shiny', 'Shiny'));
    const title = h('h2', 'sheet-title', data.title);
    const stats = h('dl', 'sheet-stats');
    const stat = (label, value, name) => {
      const row = h('div', `sheet-stat${name ? ` ${name}` : ''}`);
      row.append(h('dt', '', label), h('dd', '', value));
      stats.append(row);
      return row;
    };
    stat('Attaque', numberLabel(data.atk));
    stat('Défense', numberLabel(data.def));
    stat('Vues Wikipédia', numberLabel(data.pageviews));
    const price = stat('Prix moyen', '…', 'price');
    sheetInfo.replaceChildren(chips, title);
    if (data.subtitle) sheetInfo.append(h('p', 'sheet-subtitle', data.subtitle));
    sheetInfo.append(stats);
    inspectWiki.href = `https://fr.wikipedia.org/wiki/${encodeURIComponent(data.title.replace(/ /g, '_'))}`;
    // What copies of this rarity sold for lately, from the site (read only). Hidden if unknown.
    const asked = card;
    getMarketSummary(data.id).then(summary => {
      if (inspectCard !== asked) return;
      const { average, count, source } = getSuggestedPriceFromSummary({ card: { rarity: data.rarity } }, summary);
      price.querySelector('dd').textContent = source === 'average'
        ? `${numberFormat.format(Math.round(average))} WB`
        : 'Aucune vente';
      price.title = source === 'average' ? `Moyenne de ${count} vente${count > 1 ? 's' : ''} récente${count > 1 ? 's' : ''} en ${meta.name.toLowerCase()}` : '';
    }, () => { if (inspectCard === asked) price.remove(); });
  }

  function openInspect(card) {
    closeSheet({ silent: true });
    inspect.classList.remove('site', 'sheet-ready');
    inspectNote.hidden = true;
    inspectCard = card;
    const node = createCard(card.data, assetOrigin, { face: 'front' });
    const owned = Boolean(card.data.ownedId);
    node.root.classList.add('live');
    inspectStage.replaceChildren(node.root);
    fillSheet(card);
    inspectFav.hidden = !owned;
    inspectSheet.hidden = !owned;
    inspectFav.dataset.favFor = card.data.ownedId || '';
    inspectFav.innerHTML = `${ICONS.star}<span class="fav-label"></span>`;
    renderFavoriteButton(inspectFav, card.data);
    inspect.classList.add('on');
    setTiltTarget(node.tilt);
    audio.flip(1.2);
    playAnimation(node.root, [{ transform: 'scale(.6) rotateY(-30deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 320, easing: 'cubic-bezier(.2,.9,.25,1.05)' });
    playAnimation(sheetSide, [{ transform: 'translateX(16px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 280, delay: 60, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    requestAnimationFrame(() => inspectClose.focus({ preventScroll: true }));
  }
  function closeInspect() {
    if (!inspect.classList.contains('on')) return false;
    closeSheet();
    inspect.classList.remove('on', 'sheet-ready', 'site');
    inspectCard = null;
    setTiltTarget(null);
    setTimeout(() => { if (!inspect.classList.contains('on')) inspectStage.replaceChildren(); }, 300);
    return true;
  }

  /* Errors */

  function showMessage(title, text, buttons) {
    message.replaceChildren(h('h2', '', title), h('p', '', text));
    const row = h('div', 'row');
    for (const { label, primary, action } of buttons) {
      const node = h('button', `btn${primary ? ' primary' : ''}`, label);
      node.type = 'button';
      node.addEventListener('click', action, { signal });
      row.append(node);
    }
    message.append(row);
    message.hidden = false;
    setHint('');
    requestAnimationFrame(() => row.lastElementChild?.focus({ preventScroll: true }));
  }

  async function failPack(error) {
    openButton.hidden = true;
    tearControl?.cancel();
    setHint('');
    loading.classList.remove('on');
    playAnimation(packFloat, [{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(9px)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(0)' }], { duration: 380 });
    await animate(packWrap, [{ opacity: 1, transform: 'none' }, { opacity: .35, transform: 'translateY(20px) scale(.94)' }], { duration: 420 });
    const kind = error?.kind;
    if (kind === 'verification') {
      showMessage('Vérification requise', 'Wiki Masters demande une vérification avant d’ouvrir un paquet. Aucun paquet n’a été consommé.', [
        { label: 'Fermer', action: () => finish() },
        { label: 'Vérifier maintenant', primary: true, action: () => finish({ verification: true }) },
      ]);
    } else if (kind === 'auth') {
      showMessage('Session expirée', 'Reconnecte-toi à Wiki Masters, puis réessaie.', [{ label: 'Recharger', primary: true, action: () => finish({ reload: true }) }]);
    } else if (kind === 'uncertain') {
      showMessage('Résultat à vérifier', 'Le paquet a peut-être été ouvert. Vérifie ta collection avant de réessayer.', [
        { label: 'Fermer', action: () => finish({ reload: true }) },
        { label: 'Voir ma collection', primary: true, action: () => finish({ navigate: '/collection' }) },
      ]);
    } else {
      showMessage('Ouverture impossible', error?.message || 'Wiki Masters refuse l’ouverture pour le moment.', [{ label: 'Fermer', primary: true, action: () => finish({ reload: opened > 0 }) }]);
    }
  }

  /* One pack, from summon to summary */

  async function runPack(first) {
    if (busy || !alive) return;
    busy = true;
    openButton.hidden = true;
    skipAll = false;
    message.hidden = true;
    summary.replaceChildren();
    closeInspect();
    root.dataset.phase = 'summon';
    skipButton.hidden = true;
    tray.replaceChildren();
    deck.replaceChildren();
    resetPack();
    // Out of sight until its art is on and its entry starts (see introPack): without the art,
    // its back, sides and inside are not yet cut to its outline and showed as bare shapes.
    packWrap.style.visibility = 'hidden';
    await dressPack();
    setTiltTarget(packTilt);
    if (antiSpoil) lightRandom();

    // A trusted click reached this point: exactly one request, never retried.
    let failure = null;
    const request = Promise.resolve().then(requestOpen).then(result => {
      packsLeft = result.packsRemaining;
      opened += 1;
      renderStock();
      packCards = result.cards;
      cardsPerPack = clamp(result.cards.length, 3, 12);
      lightPack(packCards);
      return result;
    }, error => { failure = error; throw error; });
    request.catch(() => {});

    await introPack(first);
    if (!alive) return;
    if (failure) { busy = false; return failPack(failure); }
    root.dataset.phase = 'ready';
    renderStyleButton();
    setHint('Ou glisse sur le haut du paquet pour le déchirer');
    openButton.disabled = false;
    openButton.hidden = false;
    dialog.focus({ preventScroll: true });

    const failed = request.then(() => null, error => error);
    const outcome = await Promise.race([tearGesture().then(() => 'torn'), failed.then(error => error ? 'failed' : new Promise(() => {}))]);
    if (!alive) return;
    if (outcome === 'failed') { busy = false; return failPack(await failed); }
    openButton.hidden = true;
    setHint('');
    styleButton.hidden = true;

    // The pack is open: the seal comes off at once, whatever the network does. A ring
    // only appears if the answer is late.
    tearAway();
    const waiting = setTimeout(() => loading.classList.add('on'), 500);
    let result;
    // The light show gets its moment before the cards come out; without it (anti-spoil) the pace is the same as ever.
    // The cards' back too: they do not come out as plain colour (it is long ready, but for a slow
    // first opening), and they do not wait for it more than a moment.
    const back = Promise.race([dressBack(packLook), sleep(1500)]);
    try { [result] = await Promise.all([request, sleep(pack.hasAttribute('data-lit') ? 520 : 260), back]); } catch (error) {
      clearTimeout(waiting);
      loading.classList.remove('on');
      busy = false;
      return failPack(error);
    }
    clearTimeout(waiting);
    loading.classList.remove('on');
    if (!alive) return;

    const cards = result.cards.map(data => createCard(data, assetOrigin));
    const best = cards.reduce((top, card) => card.meta.tier > top.meta.tier ? card : top, cards[0]);
    // Keep the server order, which rises in rarity: the best card closes the pack, anti-spoil or
    // not (anti-spoil only hides the rarity until each flip: the light's colours, the staging).
    const ordered = cards.map((card, index) => ({ card, index })).sort((a, b) => a.card.meta.tier - b.card.meta.tier || a.index - b.index).map(item => item.card);
    ordered.forEach((card, index) => { card.root.dataset.stack = String(index); });

    buildTray(ordered.length);
    await emerge(ordered, best);
    if (!alive) return;
    root.dataset.phase = 'deck';
    dialog.focus({ preventScroll: true });
    skipButton.hidden = false;
    setTiltTarget(deck);

    const nextHint = (card, last) => `${last ? 'Touche pour voir ton paquet' : 'Touche pour continuer'}${card.data.ownedId ? '<span class="keys"><kbd>F</kbd> favori</span>' : ''}`;
    for (let index = 0; index < ordered.length; index += 1) {
      const card = ordered[index];
      const last = index === ordered.length - 1;
      if (index === 0) {
        setHint('Touche les cartes pour les révéler');
        await waitAdvance();
      }
      if (!alive || finishing) return;
      setHint('');
      await reveal(card, index, ordered.length);
      if (!alive || finishing) return;
      if (!skipAll) setHint(nextHint(card, last));
      await (skipAll ? sleep(card.meta.tier >= 3 ? 500 : 90) : waitAdvance());
      if (!alive || finishing) return;
      setHint('');
      // The next card is already coming forward while this one travels to its place.
      const stashing = stash(card, index);
      if (last) await stashing;
    }
    if (!alive || finishing) return;
    skipButton.hidden = true;
    renderSummary(ordered);
    busy = false;
  }

  /* Close */

  let finishing = false;
  async function finish({ reload = opened > 0, verification = false, navigate = null } = {}) {
    if (finishing) return;
    finishing = true;
    advance();
    tearControl?.cancel();
    const keepDark = reload || navigate;
    const fading = [stage, hud, summary, tray, caption, hint, message, counter, bars, dim]
      .map(node => playAnimation(node, [{ opacity: getComputedStyle(node).opacity }, { opacity: 0 }], { duration: 320, fill: 'forwards' }).finished.catch(() => {}));
    if (!keepDark) fading.push(playAnimation(backdrop, [{ opacity: 1 }, { opacity: 0 }], { duration: 380, fill: 'forwards' }).finished.catch(() => {}),
      playAnimation(vignette, [{ opacity: 1 }, { opacity: 0 }], { duration: 380, fill: 'forwards' }).finished.catch(() => {}));
    await Promise.all(fading);
    const outcome = { opened, reload, verification, navigate };
    if (!keepDark) destroy();
    else stopPresentation();
    onClose?.(outcome, destroy);
  }

  function stopPresentation() {
    alive = false;
    controller.abort();
    cancelAnimationFrame(tiltFrame);
    tiltFrame = null;
    tearControl?.cancel();
    audio.close();
    advance();
  }

  function destroy() {
    stopPresentation();
    show?.clear();
    if (dialog.open) dialog.close();
    host.remove();
    for (const item of packUrls) URL.revokeObjectURL(item);
    upcoming?.ready.then(({ discard }) => discard());
  }

  /* Wiring */

  function escape() {
    // From the site's panel, back to the sheet first.
    if (inspect.classList.contains('site')) { showSheetInfo(); return; }
    if (closeInspect() || !message.hidden) return;
    if (root.dataset.phase === 'summary') finish();
    else requestSkip();
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); escape(); }, { signal });
  dialog.addEventListener('pointermove', event => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
    pointer.at = performance.now();
  }, { signal, passive: true });
  dialog.addEventListener('pointerleave', () => { pointer.active = false; }, { signal });
  dialog.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    pointerAdvance = null;
    if (event.composedPath().some(node => node instanceof Element && node.matches('button, .hud, .message'))) return;
    // A press near the star is a star press, never "next card".
    if (root.dataset.phase === 'deck' && insideZone(favoriteZone(), event.clientX, event.clientY)) return;
    // A press begun during an animation cannot become valid on release.
    pointerAdvance = beginAdvanceInput();
  }, { signal });
  dialog.addEventListener('pointercancel', () => { pointerAdvance = null; }, { signal });
  dialog.addEventListener('click', event => {
    audio.unlock();
    const path = event.composedPath();
    if (path.some(node => node instanceof Element && node.matches('button, .hud, .message'))) return;
    // The inspector closes and opens its own things; the reveal is not behind it.
    if (inspect.classList.contains('on')) return;
    if (root.dataset.phase === 'deck' && event.detail > 0 && insideZone(favoriteZone(), event.clientX, event.clientY)) {
      pointerAdvance = null;
      if (liveCard) { lockAdvance(); toggleFavorite(liveCard.data); }
      return;
    }
    const input = event.detail === 0 ? beginAdvanceInput() : pointerAdvance;
    pointerAdvance = null;
    if (alive && !finishing && input && input === advanceResolver) advance();
  }, { signal });
  // Keys are handled at the window, whatever element kept the focus: a hidden
  // pack or card must never let a key fall through to the page or a button.
  let tabbed = false;
  addEventListener('keydown', event => {
    if (!alive || finishing) return;
    const inside = event.composedPath().includes(host);
    if (!inside) event.stopPropagation();
    if (event.key === 'Tab') { tabbed = true; return; }
    if (event.key === 'Escape') { event.preventDefault(); if (!event.repeat) escape(); return; }
    if ((event.key === 'f' || event.key === 'F') && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const data = inspect.classList.contains('on') ? inspectCard?.data : root.dataset.phase === 'deck' ? liveCard?.data : null;
      if (data?.ownedId) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) { lockAdvance(); toggleFavorite(data); }
        return;
      }
    }
    if (event.key !== ' ' && event.key !== 'Enter' && event.key !== 'ArrowRight') return;
    if (event.repeat) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const onButton = event.composedPath().some(node => node instanceof Element && node.matches('button'));
    if (root.dataset.phase === 'ready' && !onButton) { event.preventDefault(); audio.unlock(); tearControl?.auto(); return; }
    if (root.dataset.phase === 'summon' && !onButton) { event.preventDefault(); return; }
    if (root.dataset.phase === 'deck' && !onButton) { event.preventDefault(); if (beginAdvanceInput()) advance(); return; }
    if (!onButton && !shadow.activeElement) event.preventDefault();
  }, { signal, capture: true });
  addEventListener('keyup', event => { if (alive && !event.composedPath().includes(host)) event.stopPropagation(); }, { signal, capture: true });
  // Isolate the page from interactions inside the experience.
  for (const name of ['click', 'dblclick', 'pointerdown', 'pointerup', 'keydown', 'keyup', 'wheel', 'touchstart', 'touchmove']) {
    shadow.addEventListener(name, event => event.stopPropagation(), { signal });
  }
  skipButton.addEventListener('click', requestSkip, { signal });
  speedButton.addEventListener('click', () => {
    speed = speed === 3 ? 1 : speed + 1;
    syncSpeed();
    onSpeedChange?.(speed);
  }, { signal });
  // CSS animations need the same treatment only when they start.
  shadow.addEventListener('animationstart', event => {
    if (!(event.target instanceof Element)) return;
    for (const animation of event.target.getAnimations()) animation.playbackRate = speed;
  }, { signal });
  /* Switching design: the pack turns edge on, takes its new art there and turns back. The turn is
     added to the tilt the pack already has toward the pointer (composite `add`): replacing it made
     the pack jump flat as it set off, and snap back toward the pointer (up on the button) as it
     landed. It turns the short way to exactly edge on, whatever its tilt, waits there only if the
     art is not ready yet, and keeps its speed through the change (the two halves meet at the same
     angular speed). */
  styleButton.addEventListener('click', async () => {
    if (switching || !['summon', 'ready'].includes(root.dataset.phase)) return;
    switching = true;
    packLook = nextLook().name;
    onPackStyleChange?.(packLook);
    renderStyleButton();
    audio.whoosh(.4);
    const lean = tiltTarget === packTilt ? tilt.ry : 0;
    const edge = (lean >= 0 ? 90 : -90) - lean;
    const away = playAnimation(packTilt, [{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${edge.toFixed(2)}deg)` }], { duration: 200, easing: 'cubic-bezier(.4, 0, .8, .6)', composite: 'add', fill: 'forwards' });
    // The new art goes on once the pack is edge on, not before.
    await dressPack(away.finished.catch(() => {}));
    if (!alive) return;
    const back = playAnimation(packTilt, [{ transform: `rotateY(${edge.toFixed(2)}deg)` }, { transform: 'rotateY(0deg)' }], { duration: 260, easing: 'cubic-bezier(.16, .4, .3, 1)', composite: 'add' });
    away.cancel();
    await back.finished.catch(() => {});
    switching = false;
  }, { signal });
  closeButton.addEventListener('click', () => finish(), { signal });
  openButton.addEventListener('click', event => {
    if (!event.isTrusted || !alive || finishing || root.dataset.phase !== 'ready' || openButton.disabled) return;
    audio.unlock();
    // Complete only the gesture for this pack. runPack already owns its one POST.
    if (tearControl?.auto()) {
      openButton.disabled = true;
      dialog.focus({ preventScroll: true });
    }
  }, { signal });
  muteButton.addEventListener('click', () => {
    audio.muted = !audio.muted;
    muteButton.innerHTML = audio.muted ? ICONS.mute : ICONS.sound;
    muteButton.setAttribute('aria-label', audio.muted ? 'Activer le son' : 'Couper le son');
    muteButton.title = muteButton.getAttribute('aria-label');
    onMuteChange?.(audio.muted);
  }, { signal });
  if (muted) {
    muteButton.innerHTML = ICONS.mute;
    muteButton.setAttribute('aria-label', 'Activer le son');
    muteButton.title = 'Activer le son';
  }
  inspect.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('button, a, .sheet')) return;
    closeInspect();
  }, { signal });
  inspectFav.addEventListener('click', () => { if (inspectCard) toggleFavorite(inspectCard.data); }, { signal });
  inspectSheet.addEventListener('click', () => { if (inspectCard) openSheetFor(inspectCard); }, { signal });
  sheetBack.addEventListener('click', () => { showSheetInfo(); inspectSheet.focus({ preventScroll: true }); }, { signal });
  inspectClose.addEventListener('click', closeInspect, { signal });

  function renderSpoil() {
    spoilButton.innerHTML = ICONS[antiSpoil ? 'eyeOff' : 'eye'];
    spoilButton.append(h('span', '', 'Anti-spoil'));
    spoilButton.setAttribute('aria-pressed', String(antiSpoil));
    spoilButton.dataset.on = String(antiSpoil);
    spoilButton.title = antiSpoil
      ? 'Anti-spoil activé : rien ne trahit la rareté avant le retournement, et les cartes sortent dans le désordre'
      : 'Anti-spoil : ne laisser aucun indice de rareté avant le retournement';
    spoilButton.setAttribute('aria-label', spoilButton.title);
  }
  spoilButton.addEventListener('click', () => {
    antiSpoil = !antiSpoil;
    if (['summon', 'ready', 'burst'].includes(root.dataset.phase)) {
      // The light is made of the cards without anti-spoil and of random colours with it.
      clearLight();
      if (antiSpoil) lightRandom();
      else lightPack(packCards);
    }
    renderSpoil();
    onAntiSpoilChange?.(antiSpoil);
    audio.tick();
  }, { signal });
  renderSpoil();

  document.body.append(host);
  dialog.showModal();
  renderStock();
  syncSpeed();
  audio.unlock();
  runPack(true).catch(() => {
    failPack({ kind: 'uncertain' });
  });

  return {
    get opened() { return opened; },
    close: finish,
    destroy,
  };
}

/* ─── Native integration ──────────────────────────────────────────────────── */

const NORMAL_PACK = 'button:has(img[alt="Ouvrir un paquet"])';
const VERIFICATION_LIFETIME = 12 * 60 * 60_000;

class OpenError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

async function requestNativeOpen(beforeSend) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Délai dépassé.', 'TimeoutError')), 25_000);
  let response;
  try {
    response = await networkFetch('/api/packs/open', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { Accept: 'application/json' }, signal: controller.signal,
    }, { beforeSend });
  } catch (error) {
    throw new OpenError(error.uncertain === false ? 'refused' : 'uncertain',
      error.code === 'NETWORK_PAUSED' ? 'WikiMasters est temporairement indisponible. Réessayez après la pause.'
        : error.code === 'REQUEST_CANCELLED' ? 'Ouverture annulée avant son envoi.' : 'Connexion interrompue.');
  } finally { clearTimeout(timer); }
  const payload = await response.json().catch(() => null);
  if (response.redirected || response.status === 401) throw new OpenError('auth', 'Session expirée.');
  if (response.ok) {
    try { return normalizePackResponse(payload); }
    catch { throw new OpenError('uncertain', 'Réponse incomplète.'); }
  }
  if (response.status >= 500) throw new OpenError('uncertain', 'Erreur du serveur.');
  const hint = `${payload?.error || ''} ${payload?.code || ''}`;
  if (payload?.human_verification_required || /human_verification_required/.test(hint)) throw new OpenError('verification', 'Vérification requise.');
  const serverMessage = safeServerMessage(payload?.error) || safeServerMessage(payload?.message);
  throw new OpenError('refused', serverMessage || 'Wiki Masters refuse l’ouverture pour le moment.');
}

// Returns { state } when the extension may open this pack, or { reason } for the native flow.
function readNativeState(button, cache) {
  let state = null;
  try { state = JSON.parse(button.getAttribute('data-wme-pack-state')); } catch { state = null; }
  // The adapter briefly clears its marker after unrelated mutations (the regen timer).
  if (!state && cache.button === button && Date.now() - cache.at < 4_000) state = cache.state;
  if (!state || typeof state !== 'object') return { reason: 'état du paquet non confirmé par l’adaptateur' };
  const account = document.documentElement.getAttribute('data-wme-account');
  const verifiedAt = Date.parse(state.humanVerifiedAt);
  const blockedUntil = Date.parse(state.blockedUntil);
  if (!account || state.accountKey !== account) return { reason: 'compte non confirmé' };
  if (!Number.isInteger(state.remaining) || state.remaining < 1) return { reason: 'stock vide' };
  if (!Number.isFinite(verifiedAt) || Date.now() - verifiedAt >= VERIFICATION_LIFETIME) return { reason: 'vérification humaine à renouveler' };
  if (Number.isFinite(blockedUntil) && blockedUntil > Date.now()) return { reason: 'ouverture bloquée par le site' };
  if (button.disabled || button.getAttribute('aria-disabled') === 'true') return { reason: 'bouton désactivé' };
  return { state };
}

export function installPackOpening({ cssUrl, packUrl, puzzleUrl, puzzleBackUrl, greenUrl, greenBackUrl, globeUrl, globeBackUrl }) {
  let cssText;
  let packSvg;
  let puzzleSvg;
  let greenSvg;
  let globeSvg;
  const art = url => fetch(url).then(response => response.ok ? response.text() : Promise.reject(new Error('pack')));
  art(packUrl).then(svg => { packSvg = svg; }, () => {});
  if (puzzleUrl) art(puzzleUrl).then(svg => { puzzleSvg = svg; }, () => {});
  if (greenUrl) art(greenUrl).then(svg => { greenSvg = svg; }, () => {});
  if (globeUrl) art(globeUrl).then(svg => { globeSvg = svg; }, () => {});
  let active = null;
  const cache = { button: null, state: null, at: 0 };
  const css = fetch(cssUrl).then(response => response.ok ? response.text() : Promise.reject(new Error(`styles ${response.status}`)))
    .then(text => { cssText = text; }, () => {});

  // Remember the adapter's last confirmed state between its rescans.
  new MutationObserver(records => {
    for (const record of records) {
      const value = record.target.getAttribute?.('data-wme-pack-state');
      if (!value) continue;
      try { cache.state = JSON.parse(value); cache.button = record.target; cache.at = Date.now(); } catch { /* ignore */ }
    }
  }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-wme-pack-state'] });

  function onPulls() { return location.pathname.replace(/\/$/, '') === '/pulls'; }

  // The design is kept as `packDesign`: the older `packStyle` (dark or classic) is left behind,
  // so that everyone once started on the drawn packs; the default is now the globe (players who
  // picked a design keep it).
  async function preferences() {
    try { return await chrome.storage.local.get(['packFxMuted', 'packDesign', 'packFxSpeed', 'packAntiSpoil']); } catch { return {}; }
  }
  function savePreference(values) {
    if (extensionAlive()) chrome.storage.local.set(values).catch(() => {});
  }
  // The native Paquets page shows the same pack design as the experience (see site-theme.css).
  const DESIGNS = ['globe', 'puzzle', 'green', 'dark', 'classic'];
  const designOf = value => (DESIGNS.includes(value) ? value : 'globe');
  function applyStyle(value) {
    document.documentElement.setAttribute('data-wme-pack-style', designOf(value));
  }
  preferences().then(({ packDesign }) => applyStyle(packDesign));
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.packDesign) applyStyle(changes.packDesign.newValue);
    });
  } catch { /* Outside the extension. */ }

  function release() {
    active = null;
    document.documentElement.removeAttribute('data-wme-pack-opening');
  }

  // The design's card back is drawn while the pointer reaches the button: even the first opening
  // of the page has it (see cardBack).
  const backUrls = { puzzle: puzzleBackUrl, green: greenBackUrl, globe: globeBackUrl };
  window.addEventListener('pointerover', event => {
    if (!onPulls() || !(event.target instanceof Element) || !event.target.closest(NORMAL_PACK)) return;
    const design = document.documentElement.getAttribute('data-wme-pack-style');
    if (backUrls[design]) cardBack(design, backUrls[design]).catch(() => {});
  }, { passive: true });

  window.addEventListener('click', event => {
    if (!event.isTrusted || event.button !== 0 || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    if (!onPulls()) return;
    const button = event.target instanceof Element ? event.target.closest(NORMAL_PACK) : null;
    if (!button) return;
    if (active) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    // Orphaned by an extension reload: the native flow stays in charge.
    if (cssText === undefined || !extensionAlive()) return;
    const { state } = readNativeState(button, cache);
    if (!state) {
      // Native flow: verification, block, empty stock or unknown state.
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();

    const image = button.querySelector('img');
    const rect = image?.getBoundingClientRect();
    document.documentElement.setAttribute('data-wme-pack-opening', '');
    active = true;
    // The trusted click was taken over: if the experience cannot start, hand
    // the same intent back to the native flow instead of swallowing it.
    const fallBack = () => {
      for (const host of document.querySelectorAll('[data-wme="pack-opening"]')) host.remove();
      release();
      if (button.isConnected) button.click();
    };
    preferences().then(({ packFxMuted, packDesign, packFxSpeed, packAntiSpoil }) => {
      active = openPackExperience({
        requestOpen: () => requestNativeOpen(() => Boolean(active) && onPulls()
          && document.documentElement.getAttribute('data-wme-account') === state.accountKey),
        remaining: state.remaining,
        capacity: 10,
        sourceRect: rect && rect.width ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null,
        packSrc: packUrl,
        packSvg,
        puzzleSvg,
        puzzleBack: puzzleBackUrl,
        greenSvg,
        greenBack: greenBackUrl,
        globeSvg,
        globeBack: globeBackUrl,
        cssText,
        muted: packFxMuted === true,
        packStyle: designOf(packDesign),
        speed: packFxSpeed,
        onSpeedChange: value => savePreference({ packFxSpeed: value }),
        antiSpoil: packAntiSpoil === true,
        onAntiSpoilChange: value => savePreference({ packAntiSpoil: value }),
        onPackStyleChange: value => {
          applyStyle(value);
          savePreference({ packDesign: value });
        },
        onMuteChange: value => savePreference({ packFxMuted: value }),
        onClose(outcome, destroy) {
          if (outcome.opened > 0) document.dispatchEvent(new Event('wme:collection-changed'));
          if (outcome.navigate) { location.assign(outcome.navigate); return; }
          if (outcome.reload) { location.reload(); return; }
          destroy?.();
          release();
          // Let the native flow handle Wiki Masters' human verification.
          if (outcome.verification && button.isConnected) button.click();
        },
      });
    }).catch(fallBack);
  }, true);

  document.documentElement.setAttribute('data-wme-pack-fx', 'ready');
  return css;
}
