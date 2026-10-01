/* Films the extension's real pack opening from the lab (lab/pack-opening.html), frame by frame,
 * for the film: node scripts/capture.mjs <take> [frames]
 *   pack    the globe pack (the default): cut, light, cards out, five reveals (legendary last), the summary
 *   design  the design switch: three clicks, the pack turns from the globe to the puzzle, the
 *           green and the dark foil
 *   green   the green pack: waiting, cut, its cards out, the first reveals (a check of the design)
 *   globe   the same, on the white pack
 * Frames land in public/capture/<take>/f00000.jpg (1920 × 1080). The page runs on virtual time
 * (scripts/virtual-time.js), moved by exactly 1/60 s per frame, so the capture is smooth however
 * slow the screenshots are. Clicks are real (trusted) input events, as a player's would be.
 * Needs Google Chrome and a network connection (the lab's cards show the site's pictures).
 * Debugging aids: CHROME_FLAGS adds flags to Chrome ("--disable-gpu --disable-gpu-compositing"
 * reproduces a browser without hardware acceleration); INJECT_CSS and INJECT_JS run in the
 * opening's shadow root at frame 5; CAPTURE_DIR writes the frames there instead of public/capture/<take>
 * (a debugging take then leaves the film's footage alone).
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const FILM = fileURLToPath(new URL('..', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
const FRAME = 1000 / 60;
// The opening lays itself out for a 1440 × 810 window; it is shot at 2×, so the film can move in close.
const VIEW = { width: 1440, height: 810, scale: 2 };
const [take = 'pack', limit = '2400'] = process.argv.slice(2);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const ROUTES = { '/lab/film-opening.html': join(FILM, 'scripts/opening-lab.html') };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  const path = ROUTES[pathname] || join(REPO, pathname);
  try {
    if (!statSync(path).isFile()) throw new Error();
    response.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(readFileSync(path));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const port = 9800 + Math.floor(Math.random() * 150);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'wr-capture-'))}`,
  `--window-size=${VIEW.width},${VIEW.height}`, '--hide-scrollbars', `--force-device-scale-factor=${VIEW.scale}`, '--mute-audio', ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(' ') : []), 'about:blank',
], { stdio: 'ignore' });
let page;
for (let attempt = 0; attempt < 60 && !page; attempt += 1) {
  await sleep(200);
  try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(target => target.type === 'page'); } catch { /* Not up yet. */ }
}
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
let sequence = 0;
const pending = new Map();
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  if (message.method === 'Runtime.exceptionThrown') console.error('page error:', message.params.exceptionDetails?.exception?.description?.split('\n')[0]);
});
const send = (method, params = {}) => new Promise(resolve => {
  sequence += 1;
  pending.set(sequence, resolve);
  socket.send(JSON.stringify({ id: sequence, method, params }));
});
const evaluate = async expression => {
  const reply = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.exception?.description || 'evaluate failed');
  return reply.result?.result?.value;
};
const click = async ([x, y]) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
};
const move = ([x, y]) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
const inOpening = body => `(() => { const shadow = document.querySelector('[data-wme=pack-opening]')?.shadowRoot; if (!shadow) return null; ${body} })()`;
const centerOf = selector => evaluate(inOpening(`const node = shadow.querySelector(${JSON.stringify(selector)}); if (!node || node.hidden) return null; const r = node.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`));
const state = () => evaluate(inOpening(`return { phase: shadow.querySelector('.root')?.dataset.phase || '', hint: shadow.querySelector('.hint')?.textContent || '', tier: [...shadow.querySelectorAll('.caption')].pop()?.dataset.tier ?? null };`));

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: VIEW.width, height: VIEW.height, deviceScaleFactor: VIEW.scale, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(join(FILM, 'scripts/virtual-time.js'), 'utf8') });

// The film's lab page: the pack flies in from where its (hidden) button is, over the room's colour.
await send('Page.navigate', { url: `${origin}/lab/film-opening.html` });
for (let attempt = 0; attempt < 100 && !(await evaluate('window.ready === true')); attempt += 1) await sleep(100);
// Let the page's own start-up timers run, and the pictures of the cards load.
for (let k = 0; k < 30; k += 1) await evaluate('window.__vtAdvance(33)');
await evaluate(`Promise.all([...document.fonts].map(font => font.load().catch(() => {})).concat([
  'https://www.wiki-masters.com/cards/grande-muraille.jpg', 'https://www.wiki-masters.com/logo.png',
  'https://www.wiki-masters.com/commun.png', 'https://www.wiki-masters.com/peu_commun.png', 'https://www.wiki-masters.com/rare.png', 'https://www.wiki-masters.com/super_rare.png', 'https://www.wiki-masters.com/legendaire.png',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ae/Flamant_Rose_Villeneuve-l%C3%A8s-Maguelone.jpg/500px-Flamant_Rose_Villeneuve-l%C3%A8s-Maguelone.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Fuji_Kawaguchi_357.JPG/500px-Fuji_Kawaguchi_357.JPG',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Saturn_during_Equinox.jpg/500px-Saturn_during_Equinox.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/Crab_Nebula.jpg/500px-Crab_Nebula.jpg',
].map(src => new Promise(resolve => { const image = new Image(); image.onload = image.onerror = resolve; image.src = src; })))).then(() => true)`);

const out = process.env.CAPTURE_DIR || join(FILM, 'public/capture', take);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The take's script: called before every frame with the frame number and the opening's state;
// it clicks when the moment comes, and says when the take is over.
const marks = {};
const at = name => marks[name];
const mark = (name, frame) => { if (marks[name] === undefined) marks[name] = frame; };
const scripts = {
  globe: (...args) => scripts.green(...args), // Same take, on the white pack.
  async pack(frame, s) {
    if (frame === 0) await evaluate(`window.launch('globe'), true`);
    if (!s) return;
    if (s.phase === 'ready') mark('ready', frame);
    // A slow drift of the pointer, so the pack leans to it as it would under a hand.
    if (s.phase === 'ready' || s.phase === '') await move([720 + Math.sin(frame / 50) * 170, 390 + Math.cos(frame / 70) * 70]);
    if (at('ready') !== undefined && frame === at('ready') + 150) {
      const button = await centerOf('.pack-open-button');
      if (button) { marks.openButton = button; marks.openAt = frame; await click(button); }
    }
    if (s.phase === 'deck') {
      mark('deck', frame);
      const waiting = /Touche/.test(s.hint);
      if (waiting) mark(`wait${marks.reveals || 0}`, frame);
      else delete marks[`wait${marks.reveals || 0}`];
      const since = at(`wait${marks.reveals || 0}`);
      const dwell = (marks.reveals || 0) === 0 ? 20 : [44, 44, 60, 72, 110][Math.min(4, Number(s.tier) || 0)];
      if (waiting && since !== undefined && frame - since >= dwell) {
        await click([720, 420]);
        marks.reveals = (marks.reveals || 0) + 1;
        (marks.clicks ||= []).push(frame);
      }
    }
    if (s.phase === 'summary') mark('summary', frame);
    if (at('summary') !== undefined && frame >= at('summary') + 200) return 'done';
  },
  async green(frame, s) {
    if (frame === 0) await evaluate(`window.launch(${JSON.stringify(take === 'globe' ? 'globe' : 'green')}), true`);
    if (!s) return;
    if (s.phase === 'ready') mark('ready', frame);
    if (s.phase === 'ready') await move([720 + Math.sin(frame / 50) * 170, 390 + Math.cos(frame / 70) * 70]);
    if (at('ready') !== undefined && frame === at('ready') + 90) {
      const button = await centerOf('.pack-open-button');
      if (button) await click(button);
    }
    if (s.phase === 'deck') {
      mark('deck', frame);
      if (/Touche/.test(s.hint) && frame - at('deck') > 40 && !marks.clicked) { marks.clicked = frame; await click([720, 420]); }
    }
    if (marks.clicked && frame >= marks.clicked + 90) return 'done';
  },
  async design(frame, s) {
    if (frame === 0) await evaluate(`window.launch('globe'), true`);
    if (!s) return;
    if (s.phase === 'ready') mark('ready', frame);
    if (s.phase === 'ready') await move([720 + Math.sin(frame / 50) * 170, 390 + Math.cos(frame / 70) * 70]);
    // Three clicks, a beat and a half apart: globe, puzzle, green, dark.
    if (at('ready') !== undefined && [40, 130, 220].includes(frame - at('ready'))) {
      const button = await evaluate(inOpening(`const b = [...shadow.querySelectorAll('.hud button')].find(b => /design/i.test(b.textContent) && !b.hidden); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`));
      if (button) { marks.designButton = button; (marks.designClicks ||= []).push(frame); await click(button); }
    }
    if (at('ready') !== undefined && frame >= at('ready') + 310) return 'done';
  },
};

const started = Date.now();
let frame = 0;
let lastPhase = null;
for (; frame < Number(limit); frame += 1) {
  const s = await state();
  // A debugging aid: extra CSS in the opening's shadow root (INJECT_CSS).
  if (process.env.INJECT_CSS && frame === 5) await evaluate(inOpening(`const style = document.createElement('style'); style.textContent = ${JSON.stringify(process.env.INJECT_CSS)}; shadow.append(style); return true;`));
  if (process.env.INJECT_JS && frame === 5) await evaluate(inOpening(process.env.INJECT_JS));
  // Every change of phase, for the soundtrack's cues.
  if (s && s.phase !== lastPhase) { (marks.phases ||= []).push([frame, s.phase]); lastPhase = s.phase; }
  if ((await scripts[take](frame, s)) === 'done') break;
  await evaluate(`window.__vtAdvance(${FRAME})`);
  const { result } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true });
  writeFileSync(join(out, `f${String(frame).padStart(5, '0')}.jpg`), Buffer.from(result.data, 'base64'));
  if (frame % 60 === 0) console.log(`${take} ${frame} ${s?.phase ?? '-'} "${(s?.hint ?? '').slice(0, 40)}" ${((Date.now() - started) / 1000).toFixed(0)} s`);
}
writeFileSync(join(out, 'marks.json'), JSON.stringify({ frames: frame, ...marks }, null, 2));
console.log(`${take}: ${frame} frames`, marks);
socket.close();
chrome.kill();
server.close();
