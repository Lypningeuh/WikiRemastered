/* What the background workers read from storage: only the keys with a given prefix. Reading
   everything (get(null)) every 30 seconds also read and decoded the collection and price caches,
   which are the bulk of the storage, for nothing. getKeys() needs Chrome 130; before it, the
   whole storage is read as it used to be. */
export async function readPrefixed(prefix) {
  const area = chrome.storage.local;
  if (typeof area.getKeys !== 'function') {
    const all = await area.get(null);
    return Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith(prefix)));
  }
  const keys = (await area.getKeys()).filter(key => key.startsWith(prefix));
  return keys.length ? area.get(keys) : {};
}
