/* The light that comes out of the opened pack, drawn on two canvases.
 *
 * It is made from what it is told about the cards (their colours and rarities), and with
 * anti-spoil it is told random ones, so the show is the same and says nothing:
 *  - while the foil is torn, a soft curtain of light leaks through the tear;
 *  - at the opening, a gentle light rises from the tear and keeps moving, and one small
 *    jigsaw piece per card slips out of the pack. Each piece is solid and turns in 3D, has the
 *    colour of its card, and pulls a twisting satin ribbon behind it;
 *  - the pieces then roam all around the cards as they come out and settle: each on its own
 *    tilted orbit around the place the cards end up (a fixed centre, not the cards themselves:
 *    the pieces do not share the cards' or the camera's movements), passing behind the cards
 *    and in front of them, and one of them (the best card's) makes a full turn around the
 *    cards, beautifully, with a long trail;
 *  - at the end they drift outward, away from the cards, and fade.
 * There are two canvases so that a piece can go behind the cards (one just behind the pack's
 * front and in front of its inside) and in front of them (one in front of everything).
 */

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const easeOut = t => 1 - (1 - t) ** 3;
const easeInOut = t => (t < .5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutBack = (t, overshoot = 1.5) => 1 + (overshoot + 1) * (t - 1) ** 3 + overshoot * (t - 1) ** 2;

// The rarity colours in a ring: what the edge of the torn foil shows, whatever is inside.
export const HOLO = [
  [255, 225, 68], [250, 153, 49], [237, 111, 163], [198, 167, 242], [177, 207, 242], [184, 242, 213],
];
export function holoAt(u) {
  const count = HOLO.length;
  const at = (((u % 1) + 1) % 1) * count;
  const index = Math.floor(at);
  const t = at - index;
  const a = HOLO[index % count];
  const b = HOLO[(index + 1) % count];
  return [0, 1, 2].map(channel => Math.round(a[channel] + (b[channel] - a[channel]) * t));
}
// The colour of the wave that runs along the torn edge, at `x` (0 to 1 along the seal), `phase` cycles
// into its drift. Everything that shows the wave (the torn edge of the body, the edge of the
// ribbon, the light under the tear) asks here, so that they always agree in size, phase and
// direction: the spectrum goes round twice along the seal.
export const WAVE_PERIODS = 2;
export function waveColor(x, phase) {
  return holoAt(x * WAVE_PERIODS - phase);
}
// Where a colour sits in the ring (the nearest, for colours that are not in it).
function ringIndex(color) {
  let best = 0;
  let distance = Infinity;
  HOLO.forEach((entry, index) => {
    const d = (entry[0] - color[0]) ** 2 + (entry[1] - color[1]) ** 2 + (entry[2] - color[2]) ** 2;
    if (d < distance) { distance = d; best = index; }
  });
  return best;
}

const rgba = (color, alpha) => `rgba(${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])},${clamp(alpha, 0, 1).toFixed(3)})`;
const lighten = (color, t) => color.map(value => Math.round(value + (255 - value) * t));
const shade = (color, factor) => color.map(value => Math.round(clamp(value * factor, 0, 255)));
const mix = (a, b, t) => a.map((value, index) => Math.round(lerp(value, b[index], t)));

/* ─── The jigsaw piece ────────────────────────────────────────────────────── */

// Half of a knob, from the edge to its head, in the edge's own units (u along, v outward).
const KNOB = [[.28, 0], [.36, .012], [.41, .058], [.405, .112]];

// A piece is a unit square whose four edges each carry a knob or take one, with the
// corners and the joins rounded off once. Each piece gets its own combination and its own
// little offsets, so no two are alike.
function pieceOutline() {
  const corners = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]];
  const points = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const tab = Math.random() < .5 ? 1 : -1;
    const shift = (Math.random() - .5) * .1;
    const lift = (Math.random() - .5) * .04;
    const profile = [[0, 0], ...KNOB.map(([u, v]) => [u + shift, v])];
    const centre = .5 + shift;
    for (let step = 0; step <= 10; step += 1) {
      const angle = (210 - step * 24) * Math.PI / 180;
      profile.push([centre + .118 * Math.cos(angle), .2 + lift + .118 * Math.sin(angle)]);
    }
    for (const [u, v] of [...KNOB].reverse()) profile.push([1 - u + shift, v]);
    const [sx, sy] = corners[edge];
    const [ex, ey] = corners[(edge + 1) % 4];
    const dx = ex - sx;
    const dy = ey - sy;
    for (const [u, v] of profile) points.push([sx + dx * u + dy * v * tab, sy + dy * u - dx * v * tab]);
  }
  // One pass of corner cutting rounds everything off.
  const rounded = [];
  for (let index = 0; index < points.length; index += 1) {
    const [px, py] = points[index];
    const [qx, qy] = points[(index + 1) % points.length];
    rounded.push([.75 * px + .25 * qx, .75 * py + .25 * qy], [.25 * px + .75 * qx, .25 * py + .75 * qy]);
  }
  // Outward normals of the walls, in the piece's plane.
  const normals = rounded.map(([px, py], index) => {
    const [qx, qy] = rounded[(index + 1) % rounded.length];
    const length = Math.hypot(qx - px, qy - py) || 1;
    return [(qy - py) / length, -(qx - px) / length];
  });
  return { points: rounded, normals };
}

function rotation(ax, ay, az) {
  const [sx, cx] = [Math.sin(ax), Math.cos(ax)];
  const [sy, cy] = [Math.sin(ay), Math.cos(ay)];
  const [sz, cz] = [Math.sin(az), Math.cos(az)];
  // Rz * Ry * Rx.
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}
const apply = (m, x, y, z) => [m[0][0] * x + m[0][1] * y + m[0][2] * z, m[1][0] * x + m[1][1] * y + m[1][2] * z, m[2][0] * x + m[2][1] * y + m[2][2] * z];

const normalize = v => { const length = Math.hypot(...v); return v.map(value => value / length); };
const LIGHT_DIRECTION = normalize([-.45, -.6, .66]);
const HALF_VECTOR = normalize([LIGHT_DIRECTION[0], LIGHT_DIRECTION[1], LIGHT_DIRECTION[2] + 1]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const STRENGTH = [.6, .62, .74, .86, .95, 1]; // How bright a card's light is, by tier.
const SIZE = [.92, .94, 1.02, 1.12, 1.24, 1.32]; // How big its piece is, by tier.
const LEAK = [.05, .06, .1, .14, .19, .24]; // How far its light reaches through the tear (in pack widths).
const REACH = [.3, .34, .5, .68, .86, 1]; // How high the light rises at the opening (in pack widths).

const EMERGE = 780; // ms for a piece to slip out and join its orbit.
const EXIT = 1500; // ms for the pieces to drift off and fade.
const TRAIL = 520; // ms of trail behind a piece.
const TRAIL_STEP = 3; // ms between two points of a trail, on a fixed grid of time (see traceTrail): 5 px at most.
const TWIST = .0034; // How fast a ribbon turns about its path, in radians per ms of the path.
const LOOP_START = 420; // When the big turn begins, after its piece set out.
const LOOP = 1900; // How long the big turn takes.
const THICKNESS = .09; // Half the thickness of a piece, in piece widths.

// A ribbon is painted in a ramp of shades of its colour, from its shadow to the sheen that
// whitens it where it faces the light: so many that two neighbours cannot be told apart.
const TONES = 64;
const TONE_TOP = 1.6; // The brightest a ribbon gets: up to 1 it is lit, past 1 the sheen whitens it.
function ribbonTones(color) {
  const body = shade(color, .82); // Deepened like the face of the piece, so pale colours still read.
  const lit = shade(body, 1.1);
  return Array.from({ length: TONES }, (_, index) => {
    const value = index / (TONES - 1) * TONE_TOP;
    return rgba(value <= 1 ? shade(body, .3 + .8 * value) : lighten(lit, (value - 1) / (TONE_TOP - 1) * .7), 1);
  });
}

export function createLightShow({ canvas, front, leak, rate = () => 1, sealLeft = 3.4, sealRight = 96.6, lite = false }) {
  const layers = { back: canvas.getContext('2d'), front: front.getContext('2d'), leak: leak.getContext('2d') };
  const sprite = canvas.ownerDocument.createElement('canvas').getContext('2d'); // Where a fading piece is drawn solid first.
  let ctx = layers.back;
  let width = 0; // The pack's width, which everything is measured in.
  let ox = 0; // The centre of the scene (where the cards end up), in canvas pixels.
  let oy = 0;
  let cx = 0; // The centre of the tear.
  let cy = 0;
  let scale = 1;
  let cssWidth = 0;
  let cssHeight = 0;
  let fitGlow = 1; // How much of its height the glow gets, when the window leaves little room above the pack.
  let fitX = 1; // How much of their room the pieces' orbits get, sideways and up and down.
  let fitY = 1;
  let cards = [];
  let pieces = [];
  let mode = 'idle'; // idle, leak, burst or out.
  let torn = 0; // How far along the pack the foil has parted.
  let direction = 1;
  let burstTime = 0; // Since the opening.
  let exitTime = 0; // When the pieces began to leave.
  let dimTime = null; // When the light at the tear began to fade.
  let clock = 0; // Free-running, for what keeps moving.
  let last = 0;
  let frame = 0;
  let centre = { x: 0, y: 0 }; // Where the cards end up: the pieces circle this, and stay clear of the cards' own movement.

  // Both canvases are 4.2 pack widths wide and 4.4 tall, in the coordinates of the scene: the middle of
  // the pile is 2.1 widths from the left and 2.6 from the top, the tear above it. They are big so
  // that nothing is cut off where the eye can see it; what does reach their edges fades out first.
  // The perspective (1400 px, centred 40 % down the stage) would make the one in front look bigger
  // and the one behind smaller, and a piece changing canvas would jump: each is scaled back about the
  // perspective's own centre, so that the two line up exactly.
  const PERSPECTIVE = 1400;
  function layout(packWidth, seamY, stageHeight, seamInPack, depths = { back: -2.6, front: 34 }) {
    width = packWidth;
    cssWidth = 4.2 * width;
    cssHeight = 4.4 * width;
    // A budget of pixels: a big window must not make the show heavy. Without hardware acceleration
    // (`lite`) every pixel of these canvases is composited by the processor at every frame: far
    // fewer, drawn smaller and stretched (the light is soft, the pieces small, it hardly shows).
    scale = lite
      ? clamp(Math.sqrt(.55e6 / (cssWidth * cssHeight)), .45, 1)
      : clamp(Math.min(devicePixelRatio || 1, Math.sqrt(2.6e6 / (cssWidth * cssHeight))), 1, 2);
    for (const [element, depth] of [[canvas, depths.back], [front, depths.front]]) {
      element.width = Math.round(cssWidth * scale);
      element.height = Math.round(cssHeight * scale);
      element.style.width = `${cssWidth}px`;
      element.style.height = `${cssHeight}px`;
      element.style.left = `${-2.1 * width}px`;
      element.style.top = `${-2.6 * width}px`;
      element.style.transformOrigin = `${2.1 * width}px ${2.6 * width - .04 * stageHeight}px`;
      element.style.transform = `translateZ(${depth}px) scale(${((PERSPECTIVE - depth) / PERSPECTIVE).toFixed(5)})`;
    }
    // The curtain and the glow are on a canvas in the pack itself (1.7 widths wide, 1.5 tall, the tear
    // 1.3 from its top): they lean, tilt and fall with it, and never drift off the tear.
    leak.width = Math.round(1.7 * width * scale);
    leak.height = Math.round(1.5 * width * scale);
    leak.style.width = `${1.7 * width}px`;
    leak.style.height = `${1.5 * width}px`;
    leak.style.left = `${-.35 * width}px`;
    leak.style.top = `${seamInPack - 1.3 * width}px`;
    ox = 2.1 * width;
    oy = 2.6 * width;
    cx = ox;
    cy = oy + seamY;
    centre = { x: ox, y: oy };
  }

  // How much of a thing is seen at (x, y): it fades out over the last stretch before the edge of the canvas.
  function edgeFade(x, y) {
    const margin = .5 * width;
    return smooth(clamp(Math.min(x, cssWidth - x, y, cssHeight - y) / margin, 0, 1));
  }

  // `list` is what to show, in the order along the tear; `star` is the piece that makes the big turn.
  function setCards(list, star = null) {
    const count = list.length;
    cards = list.map((card, index) => ({ ...card, index, pos: (index + .5) / count, k: count > 1 ? index / (count - 1) * 2 - 1 : 0 }));
    let top = 0;
    cards.forEach((card, index) => { if (card.tier > cards[top].tier) top = index; });
    const starIndex = star ?? top;
    const offset = Math.random() * TAU;
    pieces = cards.map((card, index) => {
      const u = Math.random();
      return {
        card,
        hue: ringIndex(card.rgb),
        shape: pieceOutline(),
        tones: ribbonTones(card.rgb),
        star: index === starIndex,
        twist: Math.random() * TAU, // Where its ribbon is in its twist.
        bend: 0, // Which way its path curls: fixed on the first frame, so that it can never flip.
        spin: [Math.random() * TAU, Math.random() * TAU, Math.random() * TAU],
        turn: [(Math.random() < .5 ? -1 : 1) * (1.5 + Math.random() * 1.6), (Math.random() < .5 ? -1 : 1) * (1.2 + Math.random() * 1.6), (Math.random() < .5 ? -1 : 1) * (.8 + Math.random())],
        curl: (index % 2 ? 1 : -1) * (.16 + Math.random() * .18),
        delay: 50 + Math.abs(card.k) * 120 + index * 16,
        // Its place around the cards: spread over the whole way round, on its own tilted ellipse.
        angle: offset + index / count * TAU + (Math.random() - .5) * .5,
        way: Math.random() < .5 ? -1 : 1,
        speed: .42 + Math.random() * .5,
        rx: 1.22 + u * .6,
        ry: 1.12 + (1 - u) * .5,
        tilt: (Math.random() - .5) * .7,
      };
    });
  }

  // Where the pack's left edge and the tear are, on the canvas being drawn on.
  let originX = 0;
  let originY = 0;
  const seamAt = (pos, left) => left + (sealLeft + pos * (sealRight - sealLeft)) / 100 * width;
  const seamX = pos => seamAt(pos, originX);

  function withLayer(name, draw) {
    ctx = layers[name];
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    // The scene's canvases have the pack at the middle; the pack's own has it a little in.
    originX = name === 'leak' ? .35 * width : 1.6 * width;
    originY = name === 'leak' ? 1.3 * width : cy;
    draw();
  }

  /* While the foil is torn: a soft curtain of light along the part of the tear that is open,
     as high as the cards beneath are rare and in their colours, blended into each other
     (bumps with no points, so it never reads as teeth), flickering a little. */
  function drawLeak(visible) {
    const count = cards.length;
    const spanPx = (sealRight - sealLeft) / 100 * width;
    const pixel = 1 / scale;
    const left = Math.round(seamX(0) / pixel) * pixel; // Whole device pixels, so the columns neither overlap nor leave gaps.
    const sigma = .62 / count;
    const step = 2;
    for (let x = 0; x <= spanPx; x += step) {
      const pos = x / spanPx;
      const along = direction > 0 ? pos : 1 - pos;
      const open = smooth(clamp((torn - along * .96) / .16, 0, 1)) * visible;
      if (open <= .01) continue;
      let weight = 0;
      let high = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      let bright = 0;
      for (const card of cards) {
        const near = Math.exp(-(((pos - card.pos) / sigma) ** 2));
        const strength = STRENGTH[card.tier] ?? 1;
        weight += near;
        high += near * (LEAK[card.tier] ?? .1);
        bright += near * strength;
        red += near * card.rgb[0];
        green += near * card.rgb[1];
        blue += near * card.rgb[2];
      }
      if (weight < .02) continue;
      const flicker = 1 + .1 * Math.sin(clock * .011 + x * .09) + .06 * Math.sin(clock * .027 + x * .21);
      const rise = high / weight * width * open * flicker * Math.min(1, weight);
      const color = [red / weight, green / weight, blue / weight].map(Math.round);
      const gradient = ctx.createLinearGradient(0, originY, 0, originY - rise);
      gradient.addColorStop(0, rgba(lighten(color, .3), .78 * bright / weight * open));
      gradient.addColorStop(.45, rgba(color, .3 * bright / weight * open));
      gradient.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(left + x, originY - rise, step, rise);
    }
  }

  /* The light that rises from the tear once it is open: one soft, tall glow per card, in its
     colour, swaying and breathing out of step, so the light is never still. */
  function drawGlow(time, fade) {
    const slot = (sealRight - sealLeft) / 100 * width / cards.length;
    const swell = smooth(clamp(time / 420, 0, 1)) * fade;
    // The light stays within the opening: above the tear there is only air, and a glow near an end
    // of it spilled past the sides of the pack. Such a glow is drawn in a little and narrowed to the
    // room it has (its gradient still fades out before its edge, so nothing is cut).
    const left = seamX(0);
    const right = seamX(1);
    const margin = Math.min(slot * .7, (right - left) / 2);
    for (const card of cards) {
      const strength = STRENGTH[card.tier] ?? 1;
      const breathe = .84 + .16 * Math.sin(clock * .0021 + card.index * 1.3) + .06 * Math.sin(clock * .0053 + card.index * 2.1);
      const x = clamp(seamX(card.pos) + Math.sin(clock * .0009 + card.index * 1.7) * slot * .3, left + margin, right - margin);
      const room = Math.min(x - left, right - x);
      const high = width * fitGlow * (REACH[card.tier] ?? .5) * (.92 + .08 * Math.sin(clock * .0014 + card.index));
      const half = Math.min(slot * 1.15, room);
      ctx.save();
      ctx.translate(x, originY);
      ctx.scale(1, -high / half);
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, half);
      gradient.addColorStop(0, rgba(lighten(card.rgb, .35), .3 * strength * swell * breathe));
      gradient.addColorStop(.45, rgba(card.rgb, .13 * strength * swell * breathe));
      gradient.addColorStop(1, rgba(card.rgb, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(-half, 0, half * 2, half);
      ctx.restore();
      // A pool where it leaves the tear.
      const radius = Math.min(slot * 1.3, room);
      const pool = ctx.createRadialGradient(x, originY, 0, x, originY, radius);
      pool.addColorStop(0, rgba(lighten(card.rgb, .4), .34 * strength * swell));
      pool.addColorStop(1, rgba(card.rgb, 0));
      ctx.fillStyle = pool;
      ctx.fillRect(x - radius, originY - radius, radius * 2, radius * 1.05);
    }
  }

  /* Where a piece is, `t` ms after it set out: from the tear (curling, with a swirl to one side
     that dies away) to its place on its own orbit around the cards, then round that orbit.
     The big turn is one full lap, eased at both ends. `depth` says which side of the cards it
     is on: positive, in front. */
  function place(piece, t, wobble) {
    const { card } = piece;
    const halfWidth = .47 * width; // Half a card, as the pile ends up.
    const halfHeight = .66 * width;
    const seconds = t / 1000;
    let theta = piece.angle + piece.way * piece.speed * seconds;
    let radiusX = halfWidth * piece.rx * fitX;
    let radiusY = halfHeight * piece.ry * fitY;
    if (piece.star) {
      const lap = easeInOut(clamp((t - LOOP_START) / LOOP, 0, 1));
      theta = piece.angle + piece.way * (TAU * lap + piece.speed * .35 * seconds);
      radiusX = halfWidth * 1.42 * fitX;
      radiusY = halfHeight * 1.3 * fitY;
    }
    const cos = Math.cos(piece.tilt);
    const sin = Math.sin(piece.tilt);
    const ex = radiusX * Math.cos(theta);
    const ey = radiusY * Math.sin(theta);
    const targetX = centre.x + ex * cos - ey * sin;
    const targetY = centre.y + ex * sin + ey * cos;
    const along = clamp(t / EMERGE, 0, 1);
    const eased = easeOut(along);
    const startX = seamAt(card.pos, 1.6 * width);
    const startY = cy + .1 * width;
    const dx = targetX - startX;
    const dy = targetY - startY;
    const length = Math.hypot(dx, dy) || 1;
    // The path curls to one side and straightens out. To reach a place below the tear, it goes
    // round the side of the pack (the way the piece is going), not through it. The side is chosen
    // once, on the first frame: chosen again each frame, it flipped, and the piece jumped sideways.
    // The curl is a bump that is flat at both ends (no kink where the emerge ends).
    const low = clamp((targetY - cy) / (1.2 * width), 0, 1);
    const perpX = -dy / length;
    const perpY = dx / length;
    if (!piece.bend) piece.bend = Math.sign(perpX * (Math.sign(targetX - ox) || Math.sign(piece.curl))) || Math.sign(piece.curl);
    const bulge = Math.abs(piece.curl) * (1 + 3.2 * low);
    const swirl = Math.sin(Math.PI * along) ** 1.6 * bulge * width * (1 - .35 * eased) * piece.bend;
    let x = lerp(startX, targetX, eased) + perpX * swirl;
    let y = lerp(startY, targetY, eased) + perpY * swirl;
    const settle = smooth(clamp((t - EMERGE * .6) / 500, 0, 1));
    x += Math.sin(wobble * .0011 + card.index * 1.9) * .02 * width * settle;
    y += Math.sin(wobble * .0015 + card.index * 1.3) * .016 * width * settle;
    return { x, y, along, depth: Math.sin(theta) };
  }

  /* One piece, solid: the outline extruded, turned in 3D and lit from the top left. The
     walls facing the camera are drawn far to near, then the face that looks at us, with a
     bevel, a gradient and a sheen that moves as it turns. */
  function drawPiece(piece, x, y, size, ax, ay, az, alpha) {
    const { points, normals } = piece.shape;
    const color = piece.card.rgb;
    const count = points.length;
    const matrix = rotation(ax, ay, az);
    const camera = 5 * size;
    const half = THICKNESS * size;
    const near = new Array(count);
    const far = new Array(count);
    for (let index = 0; index < count; index += 1) {
      const [px, py] = points[index];
      for (const [list, z] of [[near, half], [far, -half]]) {
        const [rx, ry, rz] = apply(matrix, px * size, py * size, z);
        const factor = camera / (camera - rz);
        list[index] = [x + rx * factor, y + ry * factor, rz];
      }
    }
    const faceNormal = apply(matrix, 0, 0, 1);
    const facing = faceNormal[2] >= 0;
    const capNormal = facing ? faceNormal : faceNormal.map(value => -value);
    const cap = facing ? near : far;
    // The walls that face the camera.
    const walls = [];
    for (let index = 0; index < count; index += 1) {
      const normal = apply(matrix, normals[index][0], normals[index][1], 0);
      if (normal[2] <= 0) continue;
      const next = (index + 1) % count;
      walls.push({ index, next, normal, depth: (near[index][2] + near[next][2] + far[index][2] + far[next][2]) / 4 });
    }
    walls.sort((a, b) => a.depth - b.depth);
    ctx.globalAlpha = alpha;
    ctx.lineJoin = 'round'; // A wall seen edge on is a sliver: mitred, its stroke shot out in spikes.
    for (const wall of walls) {
      const light = .22 + .78 * Math.max(0, dot(wall.normal, LIGHT_DIRECTION));
      ctx.fillStyle = rgba(shade(color, .42 + .56 * light), 1);
      ctx.beginPath();
      ctx.moveTo(near[wall.index][0], near[wall.index][1]);
      ctx.lineTo(near[wall.next][0], near[wall.next][1]);
      ctx.lineTo(far[wall.next][0], far[wall.next][1]);
      ctx.lineTo(far[wall.index][0], far[wall.index][1]);
      ctx.closePath();
      ctx.fill();
      // The same colour round the edge of each wall seals the joins between them.
      ctx.lineWidth = .7;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.stroke();
    }
    // The face.
    const bright = .42 + .7 * Math.max(0, dot(capNormal, LIGHT_DIRECTION));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of cap) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    // The pale rarity colours are deepened a little so that they still read as colours once lit.
    const body = shade(color, .82);
    const face = ctx.createLinearGradient(minX, minY, maxX, maxY);
    face.addColorStop(0, rgba(lighten(shade(body, bright), .16), 1));
    face.addColorStop(1, rgba(shade(body, bright * .66), 1));
    const path = () => {
      ctx.beginPath();
      cap.forEach(([px, py], index) => (index ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
    };
    path();
    ctx.fillStyle = face;
    ctx.fill();
    // The bevel: the outline again, a little inside, catching the light.
    const middleX = (minX + maxX) / 2;
    const middleY = (minY + maxY) / 2;
    ctx.save();
    path();
    ctx.clip();
    ctx.beginPath();
    cap.forEach(([px, py], index) => {
      const bx = middleX + (px - middleX) * .8;
      const by = middleY + (py - middleY) * .8;
      if (index) ctx.lineTo(bx, by);
      else ctx.moveTo(bx, by);
    });
    ctx.closePath();
    ctx.lineWidth = Math.max(1.2, size * .075);
    const bevel = ctx.createLinearGradient(minX, minY, maxX, maxY);
    bevel.addColorStop(0, rgba(lighten(color, .8), .55));
    bevel.addColorStop(.5, rgba(lighten(color, .3), .08));
    bevel.addColorStop(1, 'rgba(0,0,0,.3)');
    ctx.strokeStyle = bevel;
    ctx.stroke();
    // The sheen: a soft band that slides over the face as the piece turns.
    const spec = Math.max(0, dot(capNormal, HALF_VECTOR)) ** 14;
    const slide = clamp(.5 + capNormal[0] * 1.2 - capNormal[1] * .6, -.2, 1.2);
    const sheen = ctx.createLinearGradient(minX, minY, maxX, maxY);
    sheen.addColorStop(clamp(slide - .22, 0, 1), 'rgba(255,255,255,0)');
    sheen.addColorStop(clamp(slide, 0, 1), `rgba(255,255,255,${(.08 + .42 * spec).toFixed(3)})`);
    sheen.addColorStop(clamp(slide + .22, 0, 1), 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
    ctx.restore();
    // The edge of the face.
    path();
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba(lighten(color, .6), .55);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* A piece that is fading in or out is drawn solid on a sheet of its own, then laid on with its
     opacity: drawn straight on the canvas at that opacity, its walls showed through its face. */
  function drawFadingPiece({ piece, x, y, size, ax, ay, az, alpha }) {
    const reach = size * 1.05 + 2; // Past the farthest a piece can reach from its centre, in perspective.
    const left = Math.floor((x - reach) * scale);
    const top = Math.floor((y - reach) * scale);
    const span = Math.ceil(2 * reach * scale) + 2;
    const sheet = sprite.canvas;
    if (sheet.width < span || sheet.height < span) {
      sheet.width = Math.max(sheet.width, span);
      sheet.height = Math.max(sheet.height, span);
    }
    sprite.setTransform(1, 0, 0, 1, 0, 0);
    sprite.clearRect(0, 0, span, span);
    sprite.setTransform(scale, 0, 0, scale, -left, -top); // The same pixels as on the canvas, moved to the corner.
    const target = ctx;
    ctx = sprite;
    drawPiece(piece, x, y, size, ax, ay, az, 1);
    ctx = target;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(sheet, 0, 0, span, span, left, top, span, span);
    ctx.restore();
  }

  /* Where a piece is, how big, and on which layer, at any moment of the show (the moment need
     not be now): the whole path is a function of time. The trail is worked out from that, by
     asking for where the piece was at closely spaced moments in the past, instead of from points
     recorded frame by frame (at high speed those were many pixels apart, so the curves showed
     corners, and their spacing depended on the frame rate). */
  function stateAt(piece, time) {
    const t = time - piece.delay;
    if (t <= 0) return null;
    const at = place(piece, t, clock - (burstTime - time));
    let { x, y } = at;
    const exit = mode === 'out' && time > exitTime ? clamp((time - exitTime) / EXIT, 0, 1) : 0;
    // Leaving: drifting outward, away from the cards, slowly at first.
    if (exit > 0) {
      const dx = x - centre.x;
      const dy = y - centre.y;
      const length = Math.hypot(dx, dy) || 1;
      const travel = exit ** 1.7 * width * .95;
      x += dx / length * travel;
      y += dy / length * travel;
    }
    const emerge = easeOutBack(clamp(t / 260, 0, 1), 1.3);
    // Nearer to us, a little bigger.
    const near = 1 + .2 * at.depth * smooth(at.along);
    // A piece still slipping out of the pack (inside its outline, below the tear) stays behind its
    // front; otherwise it goes on the side of the cards it is on.
    const inside = Math.abs(x - ox) < .52 * width && y > cy;
    return {
      x, y, t, exit, depth: at.depth, along: at.along,
      scale: clamp(emerge, 0, 1.15) * near * (1 + .12 * exit),
      layer: (at.along < 1 && inside) || at.depth <= 0 ? 'back' : 'front',
    };
  }

  /* The trail: a satin ribbon that the piece pulls behind it. It is solid and lit like the piece
     itself, not a glowing line. It turns about its path as it goes: wide and lit where one face
     looks at us, pinched where it is seen edge on, and the other face, in shade, beyond; its
     light changes as it bends, and it catches a sheen where it faces the light. It comes out of
     the piece narrow, keeps its width, and ends in a short point.
     How it is made, so that nothing shows that should not:
     - its points are where the piece was at moments on a fixed grid of time (plus one at the
       piece and one at the very tail), so a point stays where it is from one frame to the next:
       nothing crawls along the ribbon, and its curves are the path's own (points 5 px apart at most);
     - it is opaque, always: it never fades as a whole (a semi-transparent ribbon built from
       adjacent shapes shows its joins, and laying it on through a sheet of its own was most of the
       cost of the show). It fades by getting thinner and shorter instead, as the pieces leave or
       near the edge of the canvas;
     - it is painted in many close shades, each shade one fill of all the stretches that have it (see
       addStretch), and each stretch of one shade reaches one step into its neighbours, so no seam
       shows between two;
     - it is worked out once a frame, and each canvas draws the stretches that are on its side of
       the cards (a ribbon that changes side is cut into runs that share the point where they meet). */
  function traceTrail(piece, time, exit, head, size) {
    // Leaving, it reels in, shorter and thinner together (thinner alone, it turned into a wire),
    // ahead of its piece's fade; under a pixel wide, it fades.
    const thin = (1 - exit) ** 1.6;
    const life = (piece.star ? TRAIL * 1.7 : TRAIL) * thin;
    if (thin < .02) return null;
    const points = [{ ...head, moment: time }];
    let moment = Math.floor(time / TRAIL_STEP) * TRAIL_STEP;
    if (time - moment < TRAIL_STEP * .4) moment -= TRAIL_STEP; // Not a point on top of the first.
    for (; time - moment < life; moment -= TRAIL_STEP) {
      const state = stateAt(piece, moment);
      if (!state) break;
      state.moment = moment;
      points.push(state);
    }
    const end = stateAt(piece, time - life);
    if (end) points.push({ ...end, moment: time - life });
    const count = points.length;
    if (count < 3) return null;
    let heading = [1, 0];
    let along = 0; // How far back from the piece, in pixels.
    for (let index = 0; index < count; index += 1) {
      const point = points[index];
      if (index) along += Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y);
      // Its sides, from the direction it is going (the points are dense, so this is smooth).
      const a = points[Math.min(count - 1, index + 1)];
      const b = points[Math.max(0, index - 1)];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length > .001) heading = [dx / length, dy / length];
      const sideX = -heading[1];
      const sideY = heading[0];
      // How it faces: it turns about the path, its satin face towards us (cos 1), edge on (cos 0),
      // then its matte back (cos -1). Each face is lit by where its normal points; the two are
      // blended across the narrow neck where it is edge on, so the turn shows no hard line.
      const angle = piece.twist + point.moment * TWIST;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const light = sideX * sin * LIGHT_DIRECTION[0] + sideY * sin * LIGHT_DIRECTION[1] + cos * LIGHT_DIRECTION[2];
      const half = sideX * sin * HALF_VECTOR[0] + sideY * sin * HALF_VECTOR[1] + cos * HALF_VECTOR[2];
      const satin = .3 + .7 * Math.max(0, light) + .7 * Math.max(0, half) ** 18;
      const matte = .24 + .46 * Math.max(0, -light) + .12 * Math.max(0, -half) ** 18;
      const facing = .5 + .5 * Math.sign(cos) * smooth(clamp(Math.abs(cos) / .3, 0, 1));
      point.tone = clamp(Math.round(lerp(matte, satin, facing) / TONE_TOP * (TONES - 1)), 0, TONES - 1);
      // Its width: full for most of its length, then quickly to a point (a long, thin tail reads
      // as a wire); narrow where it leaves the piece, so it comes out of it, not from beside it.
      const age = clamp((time - point.moment) / life, 0, 1);
      const taper = (1 - age ** 2.4) ** .8;
      const root = .3 + .7 * smooth(clamp(along / (.45 * size), 0, 1));
      const spread = size * .16 * point.scale * taper * root * thin * edgeFade(point.x, point.y) * (.1 + .9 * Math.abs(cos));
      point.lx = point.x + sideX * spread;
      point.ly = point.y + sideY * spread;
      point.rx = point.x - sideX * spread;
      point.ry = point.y - sideY * spread;
    }
    return points;
  }

  /* A stretch of a ribbon (points `a` to `b`), added to the fill of its shade. Everything added to
     a fill must wind the same way, or where two parts overlap they cancel out and leave a hole: a
     stretch is one outline, turned to wind the right way. But where the piece turns tighter than
     its ribbon is wide (it nearly stops and turns as it joins its orbit), the inner edge runs
     backwards and folds over: such a stretch is added step by step instead, each step turned the
     right way and a crossed one cut into two triangles, so that a fold is simply filled. */
  const winding = (a, b, c, d, e, f) => (c - a) * (f - b) - (d - b) * (e - a);
  function addStretch(path, points, a, b) {
    let way = 0;
    for (let index = a + 1; index <= b; index += 1) {
      const p = points[index - 1];
      const q = points[index];
      const first = winding(p.lx, p.ly, q.lx, q.ly, q.rx, q.ry);
      const second = winding(p.lx, p.ly, q.rx, q.ry, p.rx, p.ry);
      const step = first + second >= 0 ? 1 : -1;
      if ((first >= 0) !== (second >= 0) || (way && step !== way)) {
        for (let at = a + 1; at <= b; at += 1) addStep(path, points[at - 1], points[at]);
        return;
      }
      way = step;
    }
    if (way >= 0) {
      path.moveTo(points[a].lx, points[a].ly);
      for (let index = a + 1; index <= b; index += 1) path.lineTo(points[index].lx, points[index].ly);
      for (let index = b; index >= a; index -= 1) path.lineTo(points[index].rx, points[index].ry);
    } else {
      path.moveTo(points[a].rx, points[a].ry);
      for (let index = a + 1; index <= b; index += 1) path.lineTo(points[index].rx, points[index].ry);
      for (let index = b; index >= a; index -= 1) path.lineTo(points[index].lx, points[index].ly);
    }
    path.closePath();
  }
  function addStep(path, p, q) {
    const first = winding(p.lx, p.ly, q.lx, q.ly, q.rx, q.ry);
    const second = winding(p.lx, p.ly, q.rx, q.ry, p.rx, p.ry);
    if ((first >= 0) === (second >= 0)) {
      if (first + second >= 0) {
        path.moveTo(p.lx, p.ly); path.lineTo(q.lx, q.ly); path.lineTo(q.rx, q.ry); path.lineTo(p.rx, p.ry);
      } else {
        path.moveTo(p.rx, p.ry); path.lineTo(q.rx, q.ry); path.lineTo(q.lx, q.ly); path.lineTo(p.lx, p.ly);
      }
      path.closePath();
      return;
    }
    path.moveTo(p.lx, p.ly);
    if (first >= 0) { path.lineTo(q.lx, q.ly); path.lineTo(q.rx, q.ry); } else { path.lineTo(q.rx, q.ry); path.lineTo(q.lx, q.ly); }
    path.closePath();
    path.moveTo(p.lx, p.ly);
    if (second >= 0) { path.lineTo(q.rx, q.ry); path.lineTo(p.rx, p.ry); } else { path.lineTo(p.rx, p.ry); path.lineTo(q.rx, q.ry); }
    path.closePath();
  }

  function drawTrail(piece, points, name) {
    // The runs on this canvas, each with the point on either side of it (on the other canvas).
    const runs = [];
    let start = -1;
    for (let index = 0; index <= points.length; index += 1) {
      const on = index < points.length && points[index].layer === name;
      if (on && start < 0) start = index;
      if (!on && start >= 0) {
        runs.push([Math.max(0, start - 1), Math.min(points.length - 1, index)]);
        start = -1;
      }
    }
    if (!runs.length) return;
    const shades = new Map();
    for (const [from, to] of runs) {
      if (to - from < 1) continue;
      // Each stretch of one shade, reaching one step into its neighbours.
      for (let first = from; first <= to;) {
        const { tone } = points[first];
        let last = first;
        while (last < to && points[last + 1].tone === tone) last += 1;
        const a = Math.max(from, first - 1);
        const b = Math.min(to, last + 1);
        if (b > a) {
          let path = shades.get(tone);
          if (!path) { path = new Path2D(); shades.set(tone, path); }
          addStretch(path, points, a, b);
        }
        first = last + 1;
      }
    }
    for (const [tone, path] of shades) {
      ctx.fillStyle = piece.tones[tone];
      ctx.fill(path);
    }
  }

  // Works out where every piece and its trail are at `time`, far to near.
  function movePieces(time) {
    const exit = mode === 'out' ? clamp((time - exitTime) / EXIT, 0, 1) : 0;
    const drawn = [];
    for (const piece of pieces) {
      const at = stateAt(piece, time);
      if (!at) continue;
      const { card } = piece;
      const { x, y, layer, t } = at;
      const size = width * .125 * (SIZE[card.tier] ?? 1) * at.scale * (piece.star ? 1.1 : 1);
      const spinning = t / 1000 * (1 - .55 * smooth(clamp(t / 1400, 0, 1)));
      const alpha = smooth(clamp(t / 120, 0, 1)) * (1 - exit) ** 1.2 * edgeFade(x, y);
      drawn.push({
        piece, x, y, size, layer, alpha, depth: at.depth, strength: STRENGTH[card.tier] ?? 1,
        trail: traceTrail(piece, time, exit, at, size),
        ax: piece.spin[0] + piece.turn[0] * spinning,
        ay: piece.spin[1] + piece.turn[1] * spinning,
        az: piece.spin[2] + piece.turn[2] * spinning,
      });
    }
    drawn.sort((a, b) => a.depth - b.depth);
    return drawn;
  }

  function drawPieces(name, drawn) {
    // A soft halo around each piece, in its colour: all the glow there is.
    ctx.globalCompositeOperation = 'lighter';
    for (const item of drawn) {
      if (item.layer !== name) continue;
      const radius = item.size * 1.35;
      const halo = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, radius);
      halo.addColorStop(0, rgba(item.piece.card.rgb, .2 * item.strength * item.alpha));
      halo.addColorStop(1, rgba(item.piece.card.rgb, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(item.x - radius, item.y - radius, radius * 2, radius * 2);
    }
    ctx.globalCompositeOperation = 'source-over';
    // Far to near, each piece over its own ribbon, so the ones in front cover the ones behind.
    for (const item of drawn) {
      if (item.trail) drawTrail(item.piece, item.trail, name);
      if (item.layer !== name || item.alpha < .004) continue;
      if (item.alpha > .996) drawPiece(item.piece, item.x, item.y, item.size, item.ax, item.ay, item.az, 1);
      else drawFadingPiece(item);
    }
  }

  function draw() {
    for (const name of ['back', 'front', 'leak']) {
      const surface = layers[name];
      surface.setTransform(1, 0, 0, 1, 0, 0);
      surface.globalCompositeOperation = 'source-over';
      surface.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
    }
    if (!cards.length || !width) return;
    if (mode === 'leak') {
      withLayer('leak', () => { ctx.globalCompositeOperation = 'lighter'; drawLeak(1); });
    }
    if (mode === 'burst' || mode === 'out') {
      const fade = dimTime === null ? 1 : 1 - smooth(clamp((burstTime - dimTime) / 380, 0, 1));
      withLayer('leak', () => {
        ctx.globalCompositeOperation = 'lighter';
        drawLeak(clamp(1 - burstTime / 260, 0, 1));
        drawGlow(burstTime, fade);
      });
      const moved = movePieces(burstTime);
      withLayer('back', () => drawPieces('back', moved));
      withLayer('front', () => drawPieces('front', moved));
    }
  }

  function tick(now) {
    frame = 0;
    const step = Math.min(48, now - last) * rate();
    last = now;
    clock += step;
    if (mode === 'burst' || mode === 'out') {
      burstTime += step;
    }
    draw();
    if (mode === 'out' && burstTime - exitTime > EXIT + 60) { finish(); return; }
    if (mode !== 'idle') frame = requestAnimationFrame(tick);
  }
  function run() {
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  }
  function finish() {
    mode = 'idle';
    for (const surface of Object.values(layers)) {
      surface.setTransform(1, 0, 0, 1, 0, 0);
      surface.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
    }
  }

  return {
    layout,
    setCards,
    get ready() { return Boolean(width); },
    get width() { return width; },
    // How much room the glow and the orbits have, from 0 to 1.
    setFit({ glow = 1, x = 1, y = 1 }) {
      fitGlow = clamp(glow, .35, 1);
      fitX = clamp(x, .5, 1);
      fitY = clamp(y, .5, 1);
    },
    // The tear is going on: `progress` is how far along the pack the foil has parted.
    leak(progress, way) {
      if (!cards.length || mode === 'burst' || mode === 'out') return;
      torn = progress;
      direction = way;
      mode = 'leak';
      run();
    },
    burst() {
      if (!cards.length) return;
      mode = 'burst';
      burstTime = 0;
      exitTime = 0;
      dimTime = null;
      run();
    },
    // The light at the tear fades (the pack is falling away); the pieces stay with the cards.
    dim() {
      if (mode === 'burst' && dimTime === null) dimTime = burstTime;
    },
    // The pieces drift off.
    release() {
      if (mode !== 'burst') return;
      mode = 'out';
      exitTime = burstTime;
      if (dimTime === null) dimTime = burstTime;
    },
    clear() {
      cards = [];
      pieces = [];
      cancelAnimationFrame(frame);
      frame = 0;
      finish();
      burstTime = 0;
      torn = 0;
      dimTime = null;
    },
  };
}
