/**
 * Read-only page adapter. The live collection has no public DOM instance IDs.
 * Its React list is keyed by user_cards.id (not the catalog card ID).
 * Expose only that binding and narrowly scoped account/pack metadata to the UI.
 * Never call React setters, inspect authentication state, or intercept traffic.
 */
(() => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const packSelector = 'button:has(img[alt="Ouvrir un paquet"])';
  const humanVerificationLifetime = 12 * 60 * 60 * 1000;
  let timer = null;

  function setAttribute(element, name, value) {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  function ownValue(object, key) {
    if (!object || typeof object !== 'object') return undefined;
    // Never invoke getters or walk arbitrary nested application objects.
    return Object.getOwnPropertyDescriptor(object, key)?.value;
  }

  function domFiber(element) {
    const key = Object.keys(element).find((name) => name.startsWith('__reactFiber$'));
    return key ? element[key] : null;
  }

  function belongsToCurrentTree(fiber) {
    let ancestor = fiber;
    // The /pulls button sits 82 levels deep (27 September 2026): keep generous headroom.
    for (let depth = 0; ancestor && depth < 400; depth += 1) {
      if (!ancestor.return) return ancestor.tag === 3 && ancestor.stateNode?.current === ancestor;
      ancestor = ancestor.return;
    }
    return false;
  }

  function currentFiber(element) {
    const fiber = domFiber(element);
    if (belongsToCurrentTree(fiber)) return fiber;
    if (fiber?.alternate && belongsToCurrentTree(fiber.alternate)) return fiber.alternate;
    return null;
  }

  function readAccountKey() {
    const ids = new Set();
    const navs = document.querySelectorAll('nav.w-64,nav[class~="md:hidden"][class~="order-last"]');
    if (!navs.length) return null;
    for (const nav of navs) {
      let fiber = currentFiber(nav);
      let id = null;
      for (let depth = 0; fiber && depth < 24; depth += 1, fiber = fiber.return) {
        const candidate = ownValue(fiber.memoizedProps, 'userId');
        if (candidate !== undefined) {
          if (typeof candidate !== 'string' || !uuid.test(candidate)) return null;
          id = candidate.toLowerCase();
          break;
        }
      }
      if (!id) return null;
      ids.add(id);
    }
    return ids.size === 1 ? [...ids][0] : null;
  }

  function readPackProfile(button) {
    let fiber = currentFiber(button);
    // The normal button is rendered directly by the /pulls page component.
    // Stop at its nearest component: never inspect shared providers' hooks.
    for (let depth = 0; fiber && depth < 16; depth += 1, fiber = fiber.return) {
      if (![0, 11, 14, 15].includes(fiber.tag)) continue;
      let hook = fiber.memoizedState;
      for (let index = 0; hook && index < 40; index += 1, hook = ownValue(hook, 'next')) {
        const value = ownValue(hook, 'memoizedState');
        const id = ownValue(value, 'id');
        const remaining = ownValue(value, 'packs_remaining');
        if (typeof id === 'string' && uuid.test(id) && Number.isInteger(remaining)) {
          return {
            accountKey: id.toLowerCase(),
            remaining,
            packsLastRegenAt: ownValue(value, 'packs_last_regen_at'),
            isPro: ownValue(value, 'is_pro') === true,
            blockedUntil: ownValue(value, 'activity_blocked_until') ?? ownValue(value, 'packs_blocked_until'),
            humanVerifiedAt: ownValue(value, 'pack_human_verified_at'),
          };
        }
      }
      return null;
    }
    return null;
  }

  function nullableDate(value) {
    if (value == null) return null;
    if (typeof value !== 'string' || value.length > 64 || !Number.isFinite(Date.parse(value))) return undefined;
    return value;
  }

  function readPackState(button, accountKey) {
    if (!accountKey || !button.isConnected) return null;
    const profile = readPackProfile(button);
    if (!profile || profile.accountKey !== accountKey) return null;
    const panel = button.nextElementSibling?.querySelector('.card-frame.px-6.py-3');
    const line = panel?.querySelector(':scope > div.text-lg');
    const spans = line ? [...line.children] : [];
    if (spans.length !== 2 || spans.some((element) => element.tagName !== 'SPAN')) return null;
    const number = spans[0].textContent.trim();
    const capacity = spans[1].textContent.replace(/\s/g, '');
    if (!/^(?:[0-9]|10)$/.test(number) || capacity !== '/10' || Number(number) !== profile.remaining) return null;
    const packsLastRegenAt = nullableDate(profile.packsLastRegenAt);
    const blockedUntil = nullableDate(profile.blockedUntil);
    const humanVerifiedAt = nullableDate(profile.humanVerifiedAt);
    if ([packsLastRegenAt, blockedUntil, humanVerifiedAt].includes(undefined)) return null;
    const now = Date.now();
    const verifiedAge = humanVerifiedAt === null ? Infinity : now - Date.parse(humanVerifiedAt);
    const verified = verifiedAge >= 0 && verifiedAge < humanVerificationLifetime;
    const blocked = blockedUntil !== null && Date.parse(blockedUntil) > now;
    return {
      accountKey,
      remaining: profile.remaining,
      packsLastRegenAt,
      isPro: profile.isPro,
      blockedUntil,
      humanVerifiedAt,
      canOpen: profile.remaining === 10 && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && !blocked && verified,
    };
  }

  function clearPackMarkers() {
    for (const button of document.querySelectorAll('[data-wme-pack-state]')) button.removeAttribute('data-wme-pack-state');
  }

  function scanPacks(accountKey) {
    if (location.pathname.replace(/\/$/, '') !== '/pulls') {
      clearPackMarkers();
      return;
    }
    const buttons = document.querySelectorAll(packSelector);
    if (buttons.length !== 1) {
      clearPackMarkers();
      return;
    }
    const button = buttons[0];
    for (const previous of document.querySelectorAll('[data-wme-pack-state]')) {
      if (previous !== button) previous.removeAttribute('data-wme-pack-state');
    }
    const state = readPackState(button, accountKey);
    if (state) setAttribute(button, 'data-wme-pack-state', JSON.stringify(state));
    else button.removeAttribute('data-wme-pack-state');
  }

  function scanCollection() {
    if (location.pathname.replace(/\/$/, '') !== '/collection') return;
    for (const wrapper of document.querySelectorAll('main .relative.isolate.group')) {
      const keys = Object.keys(wrapper);
      const fiber = wrapper[keys.find((key) => key.startsWith('__reactFiber$'))];
      const props = wrapper[keys.find((key) => key.startsWith('__reactProps$'))];
      const children = Array.isArray(props?.children) ? props.children : [props?.children];
      const cardProps = children.find((child) => child?.props?.card?.id)?.props;
      const id = fiber?.key;
      if (!uuid.test(id || '') || !cardProps || !wrapper.querySelector('h3')) {
        wrapper.removeAttribute('data-wme-owned-id');
        wrapper.removeAttribute('data-wme-owned-row');
        continue;
      }
      setAttribute(wrapper, 'data-wme-owned-id', id);
      setAttribute(wrapper, 'data-wme-catalog-id', String(cardProps.card.id));
      setAttribute(wrapper, 'data-wme-starred', String(Boolean(cardProps.topRight?.props?.starred)));
      setAttribute(wrapper, 'data-wme-pending', String(Boolean(cardProps.pendingTradeLabel)));
      // Read-only display fallback: keep visible facts available even when a
      // collection/protection request fails. Never authorize a discard with it.
      const card = cardProps.card;
      if (uuid.test(card.id || '')) {
        setAttribute(wrapper, 'data-wme-owned-row', JSON.stringify({ id,
          card: { id: card.id, rarity: typeof card.rarity === 'string' ? card.rarity : null,
            pageviews: typeof card.pageviews === 'number' || typeof card.pageviews === 'string' ? card.pageviews : null },
        }));
      } else wrapper.removeAttribute('data-wme-owned-row');
    }
  }

  function scanMarketplace() {
    const marker = 'data-wme-auction-row';
    if (location.pathname !== '/marketplace') {
      for (const previous of document.querySelectorAll(`[${marker}]`)) previous.removeAttribute(marker);
      return;
    }
    for (const wrapper of document.querySelectorAll('div[id^="marketplace-auction-"], [data-wme-auction-row]')) {
      const wrapperId = wrapper.id.startsWith('marketplace-auction-') ? wrapper.id.slice('marketplace-auction-'.length) : '';
      const props = ownValue(currentFiber(wrapper), 'memoizedProps');
      const childProps = ownValue(ownValue(props, 'children'), 'props');
      const auction = ownValue(childProps, 'auction');
      const id = ownValue(auction, 'id');
      const card = ownValue(auction, 'card');
      const cardId = ownValue(card, 'id');
      const title = ownValue(card, 'wikipedia_title');
      if (wrapper.tagName !== 'DIV' || !uuid.test(wrapperId)
        || typeof id !== 'string' || !uuid.test(id) || id.toLowerCase() !== wrapperId.toLowerCase()
        || typeof cardId !== 'string' || !uuid.test(cardId) || typeof title !== 'string' || !title.trim()) {
        wrapper.removeAttribute(marker);
        continue;
      }
      const rawViews = ownValue(card, 'pageviews');
      const views = typeof rawViews === 'number' || (typeof rawViews === 'string' && /^\d+$/.test(rawViews)) ? Number(rawViews) : null;
      const category = ownValue(card, 'category');
      const rarity = ownValue(card, 'rarity');
      // Display metadata only. Bidding always reads a fresh, authenticated API row.
      const row = {
        id: id.toLowerCase(),
        sellerId: typeof ownValue(auction, 'seller_id') === 'string' ? ownValue(auction, 'seller_id').toLowerCase() : null,
        status: typeof ownValue(auction, 'status') === 'string' ? ownValue(auction, 'status') : null,
        endAt: typeof ownValue(auction, 'end_at') === 'string' ? Date.parse(ownValue(auction, 'end_at')) : null,
        card: {
          id: cardId.toLowerCase(),
          wikipedia_title: title,
          category: typeof category === 'string' ? category : null,
          pageviews: Number.isSafeInteger(views) && views >= 0 ? views : null,
          rarity: typeof rarity === 'string' ? rarity : null,
        },
      };
      const snapshotRarity = ownValue(auction, 'snapshot_rarity');
      if (typeof snapshotRarity === 'string') row.snapshot_rarity = snapshotRarity;
      setAttribute(wrapper, marker, JSON.stringify(row));
    }
  }

  function scanAuctionDetail() {
    const marker = 'data-wme-auction-detail';
    const parts = location.pathname.replace(/\/$/, '').split('/');
    const id = parts.length === 3 && parts[1] === 'marketplace' && uuid.test(parts[2]) ? parts[2].toLowerCase() : null;
    const input = id ? document.querySelector('main input[type="number"][aria-label="Montant de la mise"]') : null;
    const block = input?.closest('div.card-frame.p-4.space-y-3');
    let row = null;
    let fiber = input ? currentFiber(input) : null;
    // The detail page owns params and its auction state. Read only its auction
    // fields, so a route transition cannot bind the previous card to a new URL.
    for (let depth = 0; fiber && depth < 40; depth += 1, fiber = fiber.return) {
      if (ownValue(ownValue(fiber, 'memoizedProps'), 'params') === undefined) continue;
      let hook = ownValue(fiber, 'memoizedState');
      for (let index = 0; hook && index < 50; index += 1, hook = ownValue(hook, 'next')) {
        const value = ownValue(hook, 'memoizedState');
        const auctionId = ownValue(value, 'id');
        const cardId = ownValue(ownValue(value, 'card'), 'id');
        const sellerId = ownValue(value, 'seller_id');
        const status = ownValue(value, 'status');
        const endAt = Date.parse(ownValue(value, 'end_at'));
        if (typeof auctionId === 'string' && auctionId.toLowerCase() === id && uuid.test(cardId || '')
          && uuid.test(sellerId || '') && typeof status === 'string' && Number.isFinite(endAt)) {
          row = { id, sellerId: sellerId.toLowerCase(), status, endAt };
          break;
        }
      }
      break;
    }
    for (const previous of document.querySelectorAll(`[${marker}]`)) {
      if (previous !== block || !row) previous.removeAttribute(marker);
    }
    if (block && row) setAttribute(block, marker, JSON.stringify(row));
  }

  function scan() {
    clearTimeout(timer);
    timer = null;
    const root = document.documentElement;
    if (!root) return;
    const accountKey = readAccountKey();
    if (accountKey) setAttribute(root, 'data-wme-account', accountKey);
    else root.removeAttribute('data-wme-account');
    scanPacks(accountKey);
    scanCollection();
    scanMarketplace();
    scanAuctionDetail();
  }

  function schedule() {
    if (timer !== null) return;
    timer = setTimeout(scan, 80);
  }
  // Changes made inside the extension's own nodes (prices, panels, the opening) carry no state of
  // the site: they do not call for a new scan. Removing one of them from the page still does.
  const own = node => Boolean((node instanceof Element ? node : node?.parentElement)?.closest?.('[data-wme]'));
  const observer = new MutationObserver(records => {
    if (records.every(record => own(record.target))) return;
    // A changing count/disabled state must not leave an old open permission live.
    clearPackMarkers();
    schedule();
  });
  observer.observe(document, {
    childList: true, characterData: true, subtree: true, attributes: true,
    attributeFilter: ['aria-label', 'disabled', 'aria-disabled'],
  });
  document.addEventListener('DOMContentLoaded', schedule, { once: true });
  window.addEventListener('pageshow', schedule);
  window.addEventListener('popstate', schedule);
  // Explicit snapshot reads must also work in a throttled background tab.
  document.addEventListener('wme:scan', scan);
  // Dispatch from the isolated content script after a confirmed server mutation.
  document.addEventListener('wme:balance-refresh', () => {
    window.dispatchEvent(new CustomEvent('wikimasters:wikibidous-balance-refresh'));
  });
  scan();
})();
