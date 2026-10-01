/* Measures how smoothly the real pack opening runs in Chrome, in real time (no virtual time):
 *   node scripts/perf.mjs            with the GPU
 *   node scripts/perf.mjs software   as without hardware acceleration
 * Reports, per moment (the pack waiting, the cut and the light, the cards coming out and a
 * reveal), the frames per second and the slowest frames, from requestAnimationFrame.
 * With SHOTS=<folder>, also a screenshot at the end of each moment, to see what it looks like.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const FILM = fileURLToPath(new URL('..', import.meta.url));
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const software = process.argv[2] === 'software';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let shot = 0;

const ROUTES = { '/lab/film-opening.html': join(FILM, 'scripts/opening-lab.html') };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  const path = ROUTES[pathname] || join(REPO, pathname);
  try {
    if (!statSync(path).isFile()) throw new Error();
    response.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(readFileSync(path));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = 9950 + Math.floor(Math.random() * 40);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'wr-perf-'))}`,
  '--window-size=1440,810', '--mute-audio', ...(software ? ['--disable-gpu', '--disable-gpu-compositing'] : []), 'about:blank',
], { stdio: 'ignore' });
let page;
for (let k = 0; k < 60 && !page; k += 1) {
  await sleep(200);
  try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch { /* not yet */ }
}
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
let id = 0;
const pending = new Map();
socket.addEventListener('message', event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise(resolve => { id += 1; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async expression => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
const click = async ([x, y]) => { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };

await send('Page.enable');
await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/lab/film-opening.html` });
for (let k = 0; k < 100 && !(await evaluate('window.ready === true')); k += 1) await sleep(100);
await sleep(1500);
// Frame intervals, from requestAnimationFrame, into window.__frames.
await evaluate(`(() => { window.__frames = []; let last = performance.now(); const tick = now => { window.__frames.push(now - last); last = now; requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true; })()`);
const phase = async (name, ms) => {
  await evaluate('window.__frames = []');
  await sleep(ms);
  const frames = await evaluate('window.__frames');
  const sorted = [...frames].sort((a, b) => a - b);
  const fps = frames.length / (ms / 1000);
  const p95 = sorted[Math.floor(sorted.length * .95)] ?? 0;
  const worst = sorted[sorted.length - 1] ?? 0;
  console.log(`${name.padEnd(22)} ${fps.toFixed(0).padStart(3)} fps   95 % sous ${p95.toFixed(0)} ms   pire ${worst.toFixed(0)} ms`);
  if (!SHOTS) return;
  const { result } = await send('Page.captureScreenshot', { format: 'png' });
  shot += 1;
  writeFileSync(join(SHOTS, `${shot}-${name.replace(/\W+/g, '-')}.png`), Buffer.from(result.data, 'base64'));
};
const inOpening = body => `(() => { const shadow = document.querySelector('[data-wme=pack-opening]')?.shadowRoot; if (!shadow) return null; ${body} })()`;
console.log(software ? 'Sans accélération matérielle' : 'Avec le GPU', await evaluate(inOpening(`return 'flat=' + (shadow.querySelector('.root')?.hasAttribute('data-flat') ?? '?')`)) ?? '');
await evaluate(`window.launch('globe'), true`);
await sleep(600);
console.log('flat mode:', await evaluate(inOpening(`return shadow.querySelector('.root')?.hasAttribute('data-flat')`)));
await phase('arrivée', 1200);
await phase('paquet au repos', 2000);
const button = await evaluate(inOpening(`const b = shadow.querySelector('.pack-open-button'); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`));
if (button) await click(button);
await phase('découpe et lumière', 2200);
await phase('cartes qui sortent', 1500);
await click([720, 420]);
await phase('révélation', 1500);
socket.close();
chrome.kill();
server.close();
