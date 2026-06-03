/**
 * CacheManager — Three-tier translation cache.
 *
 *   L1 (memory) : Map<fingerprint, translation>   — instant lookup
 *   L2 (session): chrome.storage.session            — survives page refresh
 *   L3 (local)  : chrome.storage.local              — survives browser restart
 *
 * Cache keys are based on a hash of `location.origin + location.pathname`
 * so the same article gets cache hits across tabs and across sessions.
 * Query parameters and hash fragments are ignored.
 */

const MAX_PER_PAGE = 500;
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_THRESHOLD = 20;
const MAX_LOCAL_PAGES = 10;

/**
 * Simple FNV-1a hash of a string → hex.
 */
function fnvHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 16777619) | 0;
  }
  return (h >>> 0).toString(16);
}

/** Build a stable cache key from the current page URL (ignoring query/hash). */
function pageCacheKey() {
  const u = location.origin + location.pathname;
  return 'wt_cache_' + fnvHash(u);
}

export class CacheManager {
  constructor() {
    this._key = pageCacheKey();
    /** @type {Map<string, string>} */
    this._memory = new Map();
    this._dirty = false;
    this._writesSinceFlush = 0;
    this._flushTimer = setInterval(() => this._persist(), FLUSH_INTERVAL_MS);
  }

  /**
   * Load cached translations from L2 (session) then L3 (local).
   * Must be awaited before first get().
   */
  async load() {
    // 1) L2 — chrome.storage.session (fast, survives page refresh)
    try {
      const data = await chrome.storage.session.get(this._key);
      if (data[this._key]) {
        const parsed = JSON.parse(data[this._key]);
        for (const [k, v] of Object.entries(parsed)) this._memory.set(k, v);
      }
    } catch { /* unavailable */ }

    // 2) L3 — chrome.storage.local (survives browser restart)
    if (this._memory.size === 0) {
      try {
        const data = await chrome.storage.local.get(this._key);
        if (data[this._key]) {
          const parsed = JSON.parse(data[this._key]);
          for (const [k, v] of Object.entries(parsed)) this._memory.set(k, v);
        }
      } catch { /* unavailable */ }
    }
  }

  get(fp) { return this._memory.get(fp) ?? null; }
  has(fp) { return this._memory.has(fp); }

  set(fp, translation) {
    this._memory.set(fp, translation);
    this._dirty = true;
    this._writesSinceFlush++;
    if (this._writesSinceFlush >= FLUSH_THRESHOLD) this._persist();
    if (this._memory.size > MAX_PER_PAGE) this._evictLRU();
  }

  clear() { this._memory.clear(); this._dirty = true; this._persist(); }

  /** Persist to session AND local storage. */
  async _persist() {
    if (!this._dirty) return;
    const obj = JSON.stringify(Object.fromEntries(this._memory));

    // L2 — session
    try { await chrome.storage.session.set({ [this._key]: obj }); } catch {}

    // L3 — local (with LRU page limit)
    try {
      const data = await chrome.storage.local.get('wt_pages');
      let pages = data.wt_pages ? JSON.parse(data.wt_pages) : [];
      // Move current page to front (LRU)
      pages = pages.filter(p => p !== this._key);
      pages.unshift(this._key);
      if (pages.length > MAX_LOCAL_PAGES) pages = pages.slice(0, MAX_LOCAL_PAGES);
      await chrome.storage.local.set({
        [this._key]: obj,
        wt_pages: JSON.stringify(pages),
      });
    } catch {}

    this._dirty = false;
    this._writesSinceFlush = 0;
  }

  _evictLRU() {
    const over = this._memory.size - MAX_PER_PAGE;
    const del = Math.ceil(over + MAX_PER_PAGE * 0.1);
    let c = 0;
    for (const k of this._memory.keys()) { if (c++ >= del) break; this._memory.delete(k); }
    this._dirty = true;
  }

  dispose() { clearInterval(this._flushTimer); this._persist(); }
}
