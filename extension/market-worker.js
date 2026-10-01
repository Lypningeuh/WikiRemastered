import { MARKET_DEFAULTS, marketKey, marketSettings, eligibleBid, isAccount } from './market-policy.js';
import { lateBidKey } from './late-bid-policy.js';
import { readPrefixed } from './stored.js';

const ALARM = 'wme:market-bids';
const stopKey = account => `wme:market-stop:${account}`;
const URLS = ['https://www.wiki-masters.com/*', 'https://wiki-masters.com/*'];
const stopped = new Set();
const authorizedJobs = new Map();
let queue = Promise.resolve();
let ticking = false;
const serial = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
const load = async account => (await chrome.storage.local.get(marketKey(account)))[marketKey(account)]
  || { settings: { ...MARKET_DEFAULTS }, active: false, used: 0, entries: [], attempted: [] };
const save = (account, state) => chrome.storage.local.set({ [marketKey(account)]: state });

async function send(tabId, message) {
  let timeout;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(tabId, message, { frameId: 0 }),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Connexion au marché interrompue.')), message.action === 'bid' ? 45_000 : 25_000); }),
    ]);
  } finally { clearTimeout(timeout); }
}

async function command(tab, account, action, data = {}) {
  const result = await send(tab, { type: 'wme:market-command', accountKey: account, action, ...data });
  if (!result?.ok) throw Object.assign(new Error(result?.error?.message || 'Connexion au marché en attente.'), result?.error || {});
  return result.value;
}

function record(state, entry) {
  state.entries = [entry, ...(state.entries || [])].slice(0, 100);
}

async function recover(account, state) {
  if (!state.pending) return state;
  // Worker/browser interruption cannot turn a sent bid into a fresh allowance.
  record(state, { ...state.pending, status: 'unknown' });
  state.pending = null;
  state.active = false;
  state.busy = false;
  state.error = 'Dernière mise à vérifier dans Mes enchères. Son montant reste compté.';
  await save(account, state);
  return state;
}

async function cycle(account, tab) {
  const state = await recover(account, await load(account));
  if ((await chrome.storage.local.get(stopKey(account)))[stopKey(account)]) {
    state.active = false;
    state.busy = false;
    state.status = 'Session arrêtée';
    await save(account, state);
    return;
  }
  if (!state.active || stopped.has(account) || state.nextAt > Date.now()) return;
  if (state.used >= state.settings.budget) {
    state.active = false;
    state.busy = false;
    state.status = 'Budget atteint · session terminée';
    await save(account, state);
    return;
  }
  state.busy = true;
  state.error = '';
  state.status = 'Recherche d’enchères…';
  await save(account, state);
  const seen = new Set();
  const cycleStarted = Date.now();
  try {
    const latePlans = (await chrome.storage.local.get(lateBidKey(account)))[lateBidKey(account)]?.plans || {};
    // Continue large markets on the next passage. The content script re-reads
    // each candidate under the shared auction lock before sending a bid.
    let page = state.page || 1;
    pages: for (let count = 0; count < 10 && state.active && !stopped.has(account); count += 1) {
      const result = await command(tab, account, 'list', { page });
      for (const listed of result.auctions) {
        if (stopped.has(account) || !state.active) break;
        if (Date.now() - cycleStarted > 60_000) { state.page = page; break pages; }
        if (!listed || seen.has(listed.id)) continue;
        seen.add(listed.id);
        const latePlan = latePlans[listed.id];
        if (latePlan?.active || latePlan?.pending || latePlan?.status === 'uncertain') continue;
        const auction = listed;
        const amount = eligibleBid(auction, state, account);
        if (amount === null) continue;
        const rebid = state.attempted.includes(auction.id);
        const entry = { id: auction.id, title: auction.title, amount, rebid, at: Date.now(), jobId: crypto.randomUUID() };
        state.used += amount;
        if (!rebid) state.attempted.push(auction.id);
        state.pending = entry;
        state.status = `Mise de ${amount} WB…`;
        // No network mutation is allowed before this reservation is durable.
        await save(account, state);
        if (stopped.has(account)) {
          state.used -= amount;
          if (!rebid) state.attempted = state.attempted.filter(id => id !== auction.id);
          state.pending = null;
          break;
        }
        try {
          authorizedJobs.set(entry.jobId, { tab, account, id: auction.id, amount, sessionId: state.id });
          await command(tab, account, 'bid', { id: auction.id, amount, sessionId: state.id, jobId: entry.jobId });
          record(state, { ...entry, status: 'placed' });
          state.lastBids ??= {};
          state.lastBids[auction.id] = amount;
          state.pending = null;
          state.failures = 0;
          await save(account, state);
        } catch (error) {
          // Only an explicit rejection before/at the server releases funds.
          // A dropped tab response may hide a successful mutation.
          const certain = error.uncertain === false;
          const reserved = certain && error.code === 'AUCTION_RESERVED';
          const changed = certain && error.code === 'AUCTION_CHANGED';
          if (!reserved) record(state, { ...entry, status: changed ? 'skipped' : certain ? 'failed' : 'unknown' });
          state.pending = null;
          if (certain) {
            state.used -= amount;
            if (!rebid) state.attempted = state.attempted.filter(id => id !== auction.id);
          } else {
            state.active = false;
            state.error = 'Résultat de la mise à vérifier dans Mes enchères. Session arrêtée.';
          }
          await save(account, state);
          if (reserved || changed) continue;
          throw error;
        } finally { authorizedJobs.delete(entry.jobId); }
        if (state.used >= state.settings.budget) {
          state.active = false;
          state.status = 'Budget atteint · session terminée';
          break;
        }
        // Gentle pacing also applies to POSTs, independently of price loading.
        await new Promise(resolve => setTimeout(resolve, 1_000));
      }
      page = result.hasMore ? page + 1 : 1;
      state.page = page;
      if (!result.hasMore) break;
      if (state.active && !stopped.has(account)) await new Promise(resolve => setTimeout(resolve, 500));
    }
    state.failures = 0;
    state.nextAt = Date.now() + state.settings.intervalSeconds * 1_000;
    if (state.active) state.status = 'Surveillance active';
  } catch (error) {
    if (state.pending) {
      record(state, { ...state.pending, status: 'unknown' });
      state.pending = null;
      state.active = false;
    }
    state.failures = Math.min(6, (state.failures || 0) + 1);
    const pause = Math.max(state.settings.intervalSeconds * 1_000,
      Math.min(15 * 60_000, 30_000 * 2 ** state.failures), (error.retryAfter || 0) * 1_000);
    state.nextAt = Date.now() + pause;
    if (['AUTH_REQUIRED', 'FORBIDDEN', 'INVALID_RESPONSE', 'insufficient_balance'].includes(error.code)) state.active = false;
    if (state.active) {
      state.error = '';
      state.status = 'Marché indisponible · reprise automatique';
    } else state.error ||= error.message || 'Session arrêtée. Vérifiez vos enchères.';
  } finally {
    if (stopped.has(account)) {
      state.active = false;
      state.status = 'Session arrêtée';
    }
    state.busy = false;
    await save(account, state);
  }
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const all = await readPrefixed('wme:market:');
    const accounts = Object.entries(all).filter(([key, value]) => key.startsWith('wme:market:')
      && isAccount(key.slice('wme:market:'.length)) && (value.active || value.pending))
      .map(([key]) => key.slice('wme:market:'.length));
    if (!accounts.length) return;
    const tabs = (await chrome.tabs.query({ url: URLS })).filter(tab => !tab.discarded);
    const peers = (await Promise.all(tabs.map(async tab => {
      try { return { tab, info: await send(tab.id, { type: 'wme:market-probe' }) }; }
      catch { return null; }
    }))).filter(peer => peer?.info?.ready);
    for (const account of accounts) {
      const peer = peers.filter(item => item.info.accountKey === account)
        .sort((a, b) => Number(b.info.onMarket) - Number(a.info.onMarket))[0];
      if (peer) await serial(() => cycle(account, peer.tab.id));
    }
  } catch { /* The saved session and pending journal remain for the next alarm. */ }
  finally { ticking = false; }
}

function validSender(sender) {
  return sender.id === chrome.runtime.id && sender.frameId === 0 && Number.isInteger(sender.tab?.id)
    && /^https:\/\/(www\.)?wiki-masters\.com\//.test(sender.url || '');
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'wme:market-authorize' && validSender(sender)) {
    const job = authorizedJobs.get(message.jobId);
    const allowed = Boolean(job && !stopped.has(job.account) && job.tab === sender.tab.id
      && job.account === message.accountKey && job.id === message.id && job.amount === message.amount
      && job.sessionId === message.sessionId);
    if (allowed) authorizedJobs.delete(message.jobId);
    respond({ allowed });
    return;
  }
  if (!['wme:market-start', 'wme:market-stop', 'wme:market-settings', 'wme:market-get'].includes(message?.type)
    || !validSender(sender) || !isAccount(message.accountKey)) return;
  const account = message.accountKey;
  // Stop is latched immediately, even if a network call holds the work queue.
  let revoked = Promise.resolve();
  if (message.type === 'wme:market-stop') {
    stopped.add(account);
    revoked = chrome.storage.local.set({ [stopKey(account)]: true });
    revoked.catch(() => {});
  }
  serial(async () => {
    await revoked;
    const info = await send(sender.tab.id, { type: 'wme:market-probe' });
    if (info?.accountKey !== account || (message.type === 'wme:market-start' && !info.ready)) {
      throw new Error('Compte Wiki Masters indisponible.');
    }
    let state = await recover(account, await load(account));
    if (message.type === 'wme:market-start') {
      if (!info.onMarket) throw new Error('Démarrez la session depuis le marché.');
      if (state.active) return state;
      state = { id: crypto.randomUUID(), settings: marketSettings(message.settings), active: true,
        busy: false, used: 0, entries: [], attempted: [], lastBids: {}, pending: null, startedAt: Date.now(), nextAt: 0, page: 1 };
      await chrome.storage.local.remove(stopKey(account));
      stopped.delete(account);
    } else if (message.type === 'wme:market-stop') {
      state.active = false;
      state.busy = false;
      state.status = 'Session arrêtée';
    } else if (message.type === 'wme:market-settings' && !state.active) {
      // An empty chip list is a valid saved draft, but cannot start a session.
      const settings = message.settings;
      state.settings = settings?.keywords?.length ? marketSettings(settings)
        : { ...marketSettings({ ...settings, keywords: ['draft'] }), keywords: [] };
    }
    await save(account, state);
    return state;
  }).then(state => {
    respond({ ok: true, state });
    if (message.type === 'wme:market-start') void tick();
  }, error => respond({ ok: false, error: error.message }));
  return true;
});

chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void tick(); });
async function arm() {
  await chrome.alarms.create(ALARM, { periodInMinutes: .5 });
}
chrome.runtime.onInstalled.addListener(() => { void arm(); });
chrome.runtime.onStartup.addListener(() => { void arm(); });
void arm();
