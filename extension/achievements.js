/* Claim earned achievements through the site's own buttons and session.
 * No credentials, private React state, invented API or parallel claim requests.
 * Away from /achievements, a short-lived same-origin frame loads the native list: the whole site
 * boots in it, so it runs every quarter of an hour, and never while a pack is being opened.
 */
(() => {
  if (window !== window.top) return;
  const INTERVAL = 15 * 60_000;
  const STORAGE_KEY = 'wme:achievements:schedule';
  const channel = new BroadcastChannel('wme:achievements');
  let running = false;
  let activeController;
  let timer;
  let localSchedule = { next: 0, failures: 0 };
  let lastPath = location.pathname;
  let network;
  import(chrome.runtime.getURL('network.js')).then(module => {
    network = module;
    if (!running) tick();
  }).catch(() => { /* Reloading the extension must not start uncoordinated claims. */ });

  function readSchedule() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(value?.next) && Number.isInteger(value?.failures)) return value;
    } catch { /* A storage restriction must not stop the native page working. */ }
    return localSchedule;
  }

  function saveSchedule(value) {
    localSchedule = value;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* In-memory throttle remains. */ }
  }

  function refreshBalance() { document.dispatchEvent(new Event('wme:balance-refresh')); }
  channel.onmessage = event => { if (event.data === 'claimed') refreshBalance(); };
  const onAchievements = () => location.pathname.replace(/\/$/, '') === '/achievements';
  const available = () => network && network.getNetworkPause().until <= Date.now() && !document.hidden && navigator.onLine
    && Boolean(document.querySelector('nav a[href="/achievements"]'));

  function assertActive(signal) {
    if (signal.aborted || !available()) throw new DOMException('Réclamation suspendue', 'AbortError');
  }

  function pause(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException('Suspendu', 'AbortError'));
      const cancel = () => { clearTimeout(timeout); reject(new DOMException('Suspendu', 'AbortError')); };
      const timeout = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, ms);
      signal.addEventListener('abort', cancel, { once: true });
    });
  }

  async function waitFor(read, signal, timeout = 25_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      assertActive(signal);
      const result = read();
      if (result) return result;
      await pause(250, signal);
    }
    throw new Error('La page des succès ne répond pas.');
  }

  function achievementPage(doc) {
    return doc?.location.pathname.replace(/\/$/, '') === '/achievements'
      && [...doc.querySelectorAll('main h1')].some(heading => heading.textContent.trim() === 'Succès')
      && doc.querySelector('main .card-frame h3');
  }

  async function claimAvailable(signal) {
    let frame;
    let count = 0;
    let attemptedClaim = false;
    try {
      let doc = document;
      if (!onAchievements()) {
        frame = document.createElement('iframe');
        frame.hidden = true;
        frame.tabIndex = -1;
        frame.setAttribute('aria-hidden', 'true');
        frame.setAttribute('data-wme', 'achievement-worker');
        frame.title = 'Synchronisation des succès';
        frame.src = new URL('/achievements', location.origin).href;
        document.body.append(frame);
        doc = await waitFor(() => {
          const loaded = frame.contentDocument;
          return achievementPage(loaded) ? loaded : null;
        }, signal);
      } else {
        await waitFor(() => achievementPage(doc), signal);
      }
      // The native page first loads earned rows, then completes its own sync.
      await pause(2_000, signal);
      let idleSince = Date.now();
      const deadline = Date.now() + 90_000;
      const attempted = new Set();
      while (Date.now() < deadline) {
        assertActive(signal);
        if (!achievementPage(doc)) throw new DOMException('Page changée', 'AbortError');
        const button = [...doc.querySelectorAll('main .card-frame button')].find(item =>
          item.textContent.trim() === 'Réclamer' && !item.disabled && !attempted.has(item));
        if (!button) {
          const pending = [...doc.querySelectorAll('main .card-frame button')]
            .some(item => /^Réclamation/.test(item.textContent.trim()));
          if (!pending && Date.now() - idleSince >= 3_000) return;
          await pause(250, signal);
          continue;
        }
        const card = button.closest('.card-frame');
        attempted.add(button);
        attemptedClaim = true;
        button.click();
        // A claim is confirmed only when the same earned card remains mounted
        // and its claim button disappears. Never repeat a pending click.
        await waitFor(() => {
          if (!achievementPage(doc) || !card.isConnected) throw new DOMException('Page changée', 'AbortError');
          return !card.querySelector('button') && /wikibidous reçus pour|Récompense déjà réclamée/.test(doc.querySelector('main').textContent);
        }, signal);
        count += 1;
        idleSince = Date.now();
        await pause(400, signal);
      }
      throw new Error('Synchronisation des succès interrompue.');
    } finally {
      frame?.remove();
      if (count || attemptedClaim) {
        refreshBalance();
        channel.postMessage('claimed');
      }
    }
  }

  async function tick() {
    clearTimeout(timer);
    const opening = document.documentElement.hasAttribute('data-wme-pack-opening');
    if (!running && available() && !opening) {
      const pathChanged = lastPath !== location.pathname;
      lastPath = location.pathname;
      // Visiting the earned list explicitly should not wait for the periodic run.
      const immediate = pathChanged && onAchievements();
      if (immediate || Date.now() >= readSchedule().next) {
        running = true;
        try {
          await navigator.locks.request('wme:achievement-claims', { ifAvailable: true }, async lock => {
            if (!lock || (!immediate && Date.now() < readSchedule().next)) return;
            const previous = readSchedule();
            saveSchedule({ ...previous, next: Date.now() + INTERVAL });
            const controller = new AbortController();
            activeController = controller;
            try {
              await claimAvailable(controller.signal);
              saveSchedule({ next: Date.now() + INTERVAL, failures: 0 });
            } catch (error) {
              const failures = error.name === 'AbortError' ? previous.failures : Math.min(previous.failures + 1, 5);
              const delay = error.name === 'AbortError' ? 60_000 : Math.min(15 * 60_000, 60_000 * 2 ** (failures - 1));
              saveSchedule({ next: Date.now() + delay, failures });
            } finally { activeController = null; }
          });
        } catch { /* Extension reload or unavailable lock: do not issue uncoordinated claims. */ }
        finally { running = false; }
      }
    }
    timer = setTimeout(tick, 10_000);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) activeController?.abort();
    else if (!running) tick();
  });
  window.addEventListener('offline', () => activeController?.abort());
  document.addEventListener('wme:network-state', () => {
    if (network?.getNetworkPause().until > Date.now()) activeController?.abort();
    else if (!running) tick();
  });
  window.addEventListener('online', () => { if (!running) tick(); });
  window.addEventListener('pagehide', () => { clearTimeout(timer); activeController?.abort(); });
  window.addEventListener('pageshow', () => { if (!running) tick(); });
  tick();
})();
