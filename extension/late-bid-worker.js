import { isAccount, marketKey } from './market-policy.js';
import { lateBidKey, LATE_BID_WINDOW_MS, eligibleLateBid } from './late-bid-policy.js';
import { readPrefixed } from './stored.js';

const PREFIX = 'wme:late-bids:';
const ALARM = 'wme:late-bids';
const DUE_ALARM = 'wme:late-bids-due';
const URLS = ['https://www.wiki-masters.com/*', 'https://wiki-masters.com/*'];
const CHECK_MS = 9_000;
const stopKey = (account, id) => `wme:late-stop:${account}:${id}`;
const identity = (account, id) => `${account}:${id}`;
const stopped = new Set();
const stopEpochs = new Map();
const authorizedJobs = new Map();
let queue = Promise.resolve();
let ticking = false;
let wakeTimer;
let scheduleRevision = 0;

const serial = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
const load = async account => (await chrome.storage.local.get(lateBidKey(account)))[lateBidKey(account)] || { plans: {} };
const save = (account, state) => chrome.storage.local.set({ [lateBidKey(account)]: state });

function validSender(sender) {
  return sender.id === chrome.runtime.id && sender.frameId === 0 && Number.isInteger(sender.tab?.id)
    && /^https:\/\/(www\.)?wiki-masters\.com\//.test(sender.url || '');
}

async function send(tab, message) {
  let timer;
  try {
    return await Promise.race([
      chrome.tabs.sendMessage(tab, message, { frameId: 0 }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Connexion au marché interrompue.')),
        message.action === 'late-bid' ? 70_000 : 25_000); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function command(tab, account, action, data = {}) {
  const result = await send(tab, { type: 'wme:market-command', accountKey: account, action, ...data });
  if (!result?.ok) throw Object.assign(new Error(result?.error?.message || 'Marché indisponible.'), result?.error || {});
  return result.value;
}

function finish(plan, status, message = '') {
  plan.active = false;
  plan.status = status;
  plan.message = message;
  plan.nextAt = 0;
  plan.updatedAt = Date.now();
}

function uncertain(plan) {
  // Keep the journal: neither Stop nor a worker restart can erase ambiguity.
  finish(plan, 'uncertain', 'Dernière mise à vérifier dans Mes enchères.');
}

function recover(state) {
  let changed = false;
  for (const plan of Object.values(state.plans || {})) {
    if (plan?.pending && plan.status !== 'uncertain') { uncertain(plan); changed = true; }
  }
  return changed;
}

function updateFromAuction(plan, auction, account) {
  const now = Date.now();
  plan.endAt = auction.endAt;
  plan.title = auction.title;
  plan.updatedAt = now;
  plan.message = '';
  if (auction.status !== 'active') {
    const status = auction.status === 'cancelled' ? 'cancelled'
      : auction.status === 'settled_sold' ? (auction.bidderId === account ? 'won' : 'lost') : 'ended';
    finish(plan, status);
    return;
  }
  if (auction.sellerId === account) { finish(plan, 'error', 'Vous ne pouvez pas miser sur votre propre carte.'); return; }
  if (auction.endAt <= now) {
    // Only a fresh server state can confirm settlement. The old deadline may
    // also have been extended by a bid; never use it to infer a win or a loss.
    plan.status = 'watching';
    plan.message = 'Résultat en attente.';
    plan.nextAt = now + Math.min(60_000, Math.max(CHECK_MS, now - auction.endAt));
  } else if (auction.endAt - now > LATE_BID_WINDOW_MS) {
    plan.status = auction.bidderId === account ? 'leading' : 'scheduled';
    plan.nextAt = auction.endAt - LATE_BID_WINDOW_MS;
  } else if (auction.bidderId === account) {
    plan.status = 'leading';
    plan.nextAt = Math.min(now + CHECK_MS, auction.endAt + 500);
  } else if (auction.minBid > plan.maxBid) {
    finish(plan, 'limit', 'La prochaine mise dépasse votre plafond.');
  } else {
    plan.status = 'watching';
    plan.nextAt = Math.min(now + CHECK_MS, auction.endAt + 500);
  }
}

async function isStopped(account, id) {
  return stopped.has(identity(account, id)) || Boolean((await chrome.storage.local.get(stopKey(account, id)))[stopKey(account, id)]);
}

function defer(plan, error) {
  const terminal = ['AUTH_REQUIRED', 'FORBIDDEN', 'INVALID_RESPONSE', 'insufficient_balance', 'MUTATION_PENDING'].includes(error.code);
  if (terminal) { finish(plan, 'error', error.message || 'Vérifiez votre compte avant de reprendre.'); return; }
  const changed = ['bid_too_low', 'REQUEST_CANCELLED', 'AUCTION_CHANGED'].includes(error.code);
  const delay = Math.max(changed ? CHECK_MS : 30_000,
    (Number.isFinite(error.retryAfter) ? error.retryAfter : 0) * 1_000);
  plan.status = 'watching';
  plan.message = changed ? '' : 'Marché indisponible · reprise automatique.';
  plan.nextAt = Date.now() + delay;
  plan.updatedAt = Date.now();
}

async function processPlan(account, id, tab) {
  const state = await load(account);
  const plan = state.plans?.[id];
  if (!plan) return;
  if (plan.pending) {
    if (plan.status !== 'uncertain') { uncertain(plan); await save(account, state); }
    return;
  }
  if (!plan.active || plan.nextAt > Date.now()) return;
  if (await isStopped(account, id)) { finish(plan, 'cancelled'); await save(account, state); return; }
  try {
    const auction = await command(tab, account, 'detail', { id });
    if (!auction || auction.id !== id || !Number.isFinite(auction.endAt) || !isAccount(auction.sellerId)) {
      throw Object.assign(new Error('Les données de cette enchère sont incomplètes.'), { code: 'INVALID_RESPONSE' });
    }
    updateFromAuction(plan, auction, account);
    if (await isStopped(account, id)) { finish(plan, 'cancelled'); return; }
    const amount = eligibleLateBid(plan, auction, account);
    if (amount === null) return;
    const pending = { jobId: crypto.randomUUID(), id, amount, at: Date.now(), endAt: auction.endAt, runId: plan.runId };
    plan.pending = pending;
    plan.status = 'bidding';
    plan.message = '';
    await save(account, state);
    if (await isStopped(account, id)) { plan.pending = null; finish(plan, 'cancelled'); return; }
    try {
      authorizedJobs.set(pending.jobId, { tab, account, auction, ...pending });
      await command(tab, account, 'late-bid', { id, amount, jobId: pending.jobId, runId: plan.runId });
      plan.lastBid = { amount, at: Date.now() };
      plan.pending = null;
      plan.status = 'leading';
      // POST does not return the extended end_at. Re-read it, including when
      // the previous deadline has just passed, before any further decision.
      plan.nextAt = Math.max(Date.now() + 1_000, Math.min(Date.now() + CHECK_MS, auction.endAt + 500));
      plan.updatedAt = Date.now();
      await save(account, state);
    } catch (error) {
      if (error.uncertain === false) {
        plan.pending = null;
        defer(plan, error);
      } else uncertain(plan);
    } finally { authorizedJobs.delete(pending.jobId); }
  } catch (error) {
    if (plan.pending) uncertain(plan);
    else defer(plan, error);
  } finally {
    if (stopped.has(identity(account, id)) && plan.status !== 'uncertain') finish(plan, 'cancelled');
    await save(account, state);
  }
}

function pendingWork(plan) { return plan?.pending && plan.status !== 'uncertain'; }
function statesIn(all) {
  return Object.entries(all).filter(([key, value]) => key.startsWith(PREFIX) && isAccount(key.slice(PREFIX.length))
    && value?.plans && typeof value.plans === 'object').map(([key, state]) => ({ account: key.slice(PREFIX.length), state }));
}

async function reschedule() {
  const revision = ++scheduleRevision;
  clearTimeout(wakeTimer);
  const all = await readPrefixed(PREFIX);
  if (revision !== scheduleRevision) return;
  let nearest = Infinity;
  for (const { state } of statesIn(all)) for (const plan of Object.values(state.plans)) {
    if (pendingWork(plan)) nearest = Math.min(nearest, Date.now() + 1_000);
    else if (plan?.active && Number.isFinite(plan.nextAt)) nearest = Math.min(nearest, plan.nextAt);
  }
  if (!Number.isFinite(nearest)) {
    await chrome.alarms.clear(DUE_ALARM);
    if (revision !== scheduleRevision) void reschedule().catch(() => {});
    return;
  }
  const when = Math.max(Date.now() + 1_000, nearest);
  await chrome.alarms.create(DUE_ALARM, { when });
  if (revision !== scheduleRevision) { void reschedule().catch(() => {}); return; }
  if (when - Date.now() <= 60_000) wakeTimer = setTimeout(() => { void tick(); }, Math.max(1_000, when - Date.now()));
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const all = await readPrefixed(PREFIX);
    const due = statesIn(all).flatMap(({ account, state }) => Object.values(state.plans)
      .filter(plan => isAccount(plan?.id) && (pendingWork(plan) || (plan.active && plan.nextAt <= Date.now())))
      .map(plan => ({ account, plan })));
    if (!due.length) return;
    // Due times initially follow end_at - one minute; overdue, unprocessed
    // plans precede recently checked ones so a busy auction cannot starve them.
    due.sort((a, b) => (a.plan.nextAt || 0) - (b.plan.nextAt || 0) || a.plan.endAt - b.plan.endAt);
    const tabs = (await chrome.tabs.query({ url: URLS })).filter(tab => !tab.discarded);
    const peers = (await Promise.all(tabs.map(async tab => {
      try { return { tab, info: await send(tab.id, { type: 'wme:market-probe' }) }; } catch { return null; }
    }))).filter(peer => peer?.info?.ready);
    const started = Date.now();
    let count = 0;
    for (const { account, plan } of due) {
      if (count >= 4 || Date.now() - started >= 20_000) break;
      const peer = peers.filter(item => item.info.accountKey === account)
        .sort((a, b) => Number(b.info.onMarket) - Number(a.info.onMarket))[0];
      if (!peer && !pendingWork(plan)) continue;
      count += 1;
      await serial(() => processPlan(account, plan.id, peer?.tab.id));
    }
    // One disconnected account must not keep waking the worker while another
    // account still has a connected tab.
    const unavailable = new Set(due.filter(item => !peers.some(peer => peer.info.accountKey === item.account)).map(item => item.account));
    if (unavailable.size) await serial(async () => {
      for (const account of unavailable) {
        const state = await load(account);
        for (const plan of Object.values(state.plans)) if (plan.active && plan.nextAt <= Date.now()) plan.nextAt = Date.now() + 30_000;
        await save(account, state);
      }
    });
  } catch { /* Storage/tab availability is retried by the next alarm. No POST is replayed. */ }
  finally {
    ticking = false;
    void reschedule().catch(() => {});
  }
}

async function authorize(message, sender) {
  const job = authorizedJobs.get(message.jobId);
  if (!job || job.tab !== sender.tab.id || job.account !== message.accountKey || job.id !== message.id
    || job.amount !== message.amount || job.runId !== message.runId || stopped.has(identity(job.account, job.id))) return false;
  const values = await chrome.storage.local.get([lateBidKey(job.account), stopKey(job.account, job.id)]);
  const plan = values[lateBidKey(job.account)]?.plans?.[job.id];
  const allowed = authorizedJobs.get(message.jobId) === job && !stopped.has(identity(job.account, job.id))
    && !values[stopKey(job.account, job.id)] && plan?.active && plan.runId === job.runId
    && plan.pending?.jobId === job.jobId && plan.pending.id === job.id && plan.pending.amount === job.amount
    && plan.pending.runId === job.runId && Date.now() - job.at <= 25_000
    && eligibleLateBid({ ...plan, pending: null }, job.auction, job.account) === job.amount;
  if (allowed) authorizedJobs.delete(message.jobId);
  return Boolean(allowed);
}

async function setPlan(account, id, maxBid, sender, epoch) {
  if (!Number.isSafeInteger(maxBid) || maxBid < 1 || maxBid > 100_000) throw new Error('Choisissez un plafond entre 1 et 100 000 WB.');
  const state = await load(account);
  if (recover(state)) await save(account, state);
  const previous = state.plans[id];
  if (previous?.pending || previous?.status === 'uncertain') throw new Error('Vérifiez d’abord la dernière mise dans Mes enchères.');
  if (!previous?.active && Object.values(state.plans).filter(plan => plan.active).length >= 50) throw new Error('50 enchères automatiques sont déjà actives.');
  const keyword = (await chrome.storage.local.get(marketKey(account)))[marketKey(account)];
  if (keyword?.pending?.id === id || keyword?.entries?.some(entry => entry.id === id && entry.status === 'unknown')) {
    throw new Error('Une mise sur cette carte est encore à vérifier dans Mes enchères.');
  }
  const auction = await command(sender.tab.id, account, 'detail', { id });
  if (!auction || auction.id !== id || !isAccount(auction.sellerId) || !Number.isFinite(auction.endAt)) throw new Error('Enchère indisponible.');
  if (auction.sellerId === account) throw new Error('Vous ne pouvez pas miser sur votre propre carte.');
  if (auction.status !== 'active' || auction.endAt <= Date.now()) throw new Error('Cette enchère est déjà terminée.');
  if (auction.bidderId === account && auction.currentBid > maxBid) {
    throw new Error(`Votre mise actuelle de ${auction.currentBid} WB est déjà engagée. Le plafond ne peut pas être inférieur.`);
  }
  if (auction.bidderId !== account && auction.minBid > maxBid) {
    throw new Error(`La mise minimale est actuellement de ${auction.minBid} WB. Choisissez un plafond au moins égal.`);
  }
  const keywordNow = (await chrome.storage.local.get(marketKey(account)))[marketKey(account)];
  if (keywordNow?.pending?.id === id || keywordNow?.entries?.some(entry => entry.id === id && entry.status === 'unknown')) {
    throw new Error('Une mise sur cette carte est encore à vérifier dans Mes enchères.');
  }
  const key = identity(account, id);
  if ((stopEpochs.get(key) || 0) !== epoch) throw new Error('Programmation annulée.');
  await chrome.storage.local.remove(stopKey(account, id));
  if ((stopEpochs.get(key) || 0) !== epoch) {
    await chrome.storage.local.set({ [stopKey(account, id)]: true });
    throw new Error('Programmation annulée.');
  }
  stopped.delete(key);
  const plan = { id, runId: crypto.randomUUID(), title: auction.title, maxBid, endAt: auction.endAt,
    active: true, status: 'scheduled', message: '', nextAt: 0, createdAt: previous?.createdAt || Date.now(),
    updatedAt: Date.now(), lastBid: previous?.lastBid || null, pending: null };
  updateFromAuction(plan, auction, account);
  if (plan.active && auction.endAt - Date.now() <= LATE_BID_WINDOW_MS) plan.nextAt = Date.now();
  state.plans[id] = plan;
  await save(account, state);
  if (stopped.has(key)) { finish(plan, 'cancelled'); await save(account, state); }
  return state;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!validSender(sender) || !isAccount(message?.accountKey)) return;
  if (message.type === 'wme:late-authorize') {
    authorize(message, sender).then(allowed => respond({ allowed }), () => respond({ allowed: false }));
    return true;
  }
  if (!['wme:late-get', 'wme:late-set', 'wme:late-stop', 'wme:late-dismiss', 'wme:late-wake'].includes(message.type)) return;
  const account = message.accountKey;
  const id = message.id;
  if (['wme:late-set', 'wme:late-stop', 'wme:late-dismiss'].includes(message.type) && !isAccount(id)) {
    respond({ ok: false, error: 'Identifiant d’enchère invalide.' }); return;
  }
  const key = identity(account, id);
  const epoch = stopEpochs.get(key) || 0;
  let revoked = Promise.resolve();
  if (message.type === 'wme:late-stop') {
    stopped.add(key);
    stopEpochs.set(key, epoch + 1);
    revoked = chrome.storage.local.set({ [stopKey(account, id)]: true });
    revoked.catch(() => {});
  }
  const task = async () => {
    await revoked;
    const info = await send(sender.tab.id, { type: 'wme:market-probe' });
    if (info?.accountKey !== account || (message.type === 'wme:late-set' && !info.ready)) throw new Error('Compte WikiMasters indisponible.');
    if (message.type === 'wme:late-set') return setPlan(account, id, message.maxBid, sender, epoch);
    const state = await load(account);
    if (message.type === 'wme:late-stop') {
      if (recover(state)) await save(account, state);
      const plan = state.plans[id];
      if (plan && plan.status !== 'uncertain') finish(plan, 'cancelled');
      await save(account, state);
    }
    if (message.type === 'wme:late-dismiss') {
      // Only a finished plan leaves the list. An uncertain one is removed on the
      // user's explicit confirmation that Mes enchères was checked; a running or
      // pending plan never is.
      if (recover(state)) await save(account, state);
      const plan = state.plans[id];
      if (plan && (plan.active || (plan.pending && plan.status !== 'uncertain'))) throw new Error('Cette enchère est encore en cours.');
      if (plan) {
        delete state.plans[id];
        await save(account, state);
        await chrome.storage.local.remove(stopKey(account, id));
      }
    }
    return state;
  };
  // Read-only UI updates must not wait behind a slow bid. State changes and
  // final authorizations still have their own serialized/durable safeguards.
  const result = ['wme:late-get', 'wme:late-wake'].includes(message.type) ? task() : serial(task);
  result.then(state => {
    respond({ ok: true, state });
    if (message.type === 'wme:late-wake' || message.type === 'wme:late-set') void tick();
    else void reschedule().catch(() => {});
  }, error => respond({ ok: false, error: error.message || 'Programmation indisponible.' }));
  return true;
});

chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM || alarm.name === DUE_ALARM) void tick(); });
async function arm() { await chrome.alarms.create(ALARM, { periodInMinutes: .5 }); await reschedule(); }
chrome.runtime.onInstalled.addListener(() => { void arm().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { void arm().catch(() => {}); });
void arm().catch(() => {});
