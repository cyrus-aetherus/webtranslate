/**
 * StatsTracker — Records LLM API call statistics in memory,
 * periodically flushing to chrome.storage.local.
 *
 * Data model:
 *   Session  — resets per tab (keyed by tabId), tracks current page
 *   All-time — cumulative, never resets unless user clears
 *   Daily    — last 30 days, rolled up by date
 *
 * Concurrency-safe: all accumulation happens in-memory first;
 * storage.local is only written on flush (every 10 records or 30 s).
 */

const STORAGE_SESSION = 'wt_stats_session';
const STORAGE_ALLTIME = 'wt_stats_alltime';
const STORAGE_DAILY   = 'wt_stats_daily';
const FLUSH_EVERY      = 10;
const MAX_DAILY_DAYS   = 30;

export class StatsTracker {
  constructor() {
    /** @type {Record<string, SessionStats>} */
    this._sessions = {};   // tabId → session
    this._allTime = null;  // loaded lazily
    this._daily   = [];    // loaded lazily
    this._sinceFlush = 0;
    this._flushTimer = setInterval(() => this.flush(), 30000);
    this._loaded = false;
  }

  /**
   * Ensure all-time + daily stats are loaded from storage.
   * Call once at SW startup.
   */
  async init() {
    if (this._loaded) return;
    try {
      const data = await chrome.storage.local.get([STORAGE_ALLTIME, STORAGE_DAILY]);
      this._allTime = data[STORAGE_ALLTIME]
        ? JSON.parse(data[STORAGE_ALLTIME])
        : { calls: 0, promptTokens: 0, completionTokens: 0, segments: 0, errors: 0 };
      this._daily = data[STORAGE_DAILY] ? JSON.parse(data[STORAGE_DAILY]) : [];
    } catch {
      this._allTime = { calls: 0, promptTokens: 0, completionTokens: 0, segments: 0, errors: 0 };
      this._daily = [];
    }
    this._loaded = true;
  }

  /**
   * Record a completed API call.
   * @param {object} opts
   * @param {string} opts.tabId
   * @param {number} opts.segmentCount — how many paragraphs in this batch
   * @param {number} [opts.promptTokens]
   * @param {number} [opts.completionTokens]
   * @param {boolean} [opts.error]
   */
  record({ tabId, segmentCount, promptTokens, completionTokens, error }) {
    // Per-session
    const key = String(tabId);
    let s = this._sessions[key];
    if (!s) {
      s = { startedAt: Date.now(), calls: 0, promptTokens: 0, completionTokens: 0, segments: 0, errors: 0 };
      this._sessions[key] = s;
    }
    s.calls++;
    s.segments += segmentCount || 0;
    if (error) s.errors++;
    else {
      s.promptTokens += promptTokens || 0;
      s.completionTokens += completionTokens || 0;
    }

    // All-time
    this._allTime.calls++;
    this._allTime.segments += segmentCount || 0;
    if (error) this._allTime.errors++;
    else {
      this._allTime.promptTokens += promptTokens || 0;
      this._allTime.completionTokens += completionTokens || 0;
    }

    // Daily
    const today = new Date().toISOString().slice(0, 10);
    let d = this._daily.find(r => r.date === today);
    if (!d) {
      d = { date: today, calls: 0, promptTokens: 0, completionTokens: 0, segments: 0, errors: 0, cost: 0 };
      this._daily.unshift(d);
    }
    d.calls++;
    d.segments += segmentCount || 0;
    if (error) d.errors++;
    else {
      d.promptTokens += promptTokens || 0;
      d.completionTokens += completionTokens || 0;
    }

    if (++this._sinceFlush >= FLUSH_EVERY) this.flush();
  }

  /**
   * Persist to storage.local.
   */
  async flush() {
    if (!this._loaded) return;
    this._sinceFlush = 0;
    // Trim daily to 30 days
    const cutoff = new Date(Date.now() - MAX_DAILY_DAYS * 864e5).toISOString().slice(0, 10);
    this._daily = this._daily.filter(r => r.date >= cutoff);
    try {
      await chrome.storage.local.set({
        [STORAGE_ALLTIME]: JSON.stringify(this._allTime),
        [STORAGE_DAILY]: JSON.stringify(this._daily),
      });
    } catch { /* quota or context lost */ }
  }

  /**
   * Get current session stats for a tab, or all-time.
   * @param {'session'|'alltime'|'daily'} type
   * @param {string} [tabId] — required for 'session'
   */
  getStats(type, tabId) {
    if (type === 'session') {
      const s = this._sessions[String(tabId)];
      return s ? { ...s } : { calls: 0, promptTokens: 0, completionTokens: 0, segments: 0, errors: 0, startedAt: 0 };
    }
    if (type === 'alltime') return { ...this._allTime || { calls: 0, promptTokens: 0, completionTokens: 0, segments: 0, errors: 0 } };
    if (type === 'daily') return [...this._daily];
    return null;
  }

  /** Clear all stats (user action). */
  async clearAll() {
    this._sessions = {};
    this._allTime = { calls: 0, promptTokens: 0, completionTokens: 0, segments: 0, errors: 0 };
    this._daily = [];
    try { await chrome.storage.local.remove([STORAGE_ALLTIME, STORAGE_DAILY]); } catch {}
  }

  dispose() { clearInterval(this._flushTimer); this.flush(); }
}
