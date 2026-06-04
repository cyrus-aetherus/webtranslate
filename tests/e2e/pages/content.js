(function () {
  'use strict';

  /**
   * WebTranslate global constants
   * Message protocol enums, state machine states, default configuration, DOM selectors
   */

  // ==================== Message Types (CS ↔ SW ↔ Panel) ====================
  const MSG = {
    // Content Script → Service Worker
    TRANSLATE_BATCH: 'TRANSLATE_BATCH',
    CANCEL_BATCH: 'CANCEL_BATCH',
    STOP_ALL: 'STOP_ALL',
    DOWNLOAD: 'DOWNLOAD',
    OPEN_PANEL: 'OPEN_PANEL',

    // Service Worker → Content Script
    TRANSLATE_BATCH_RESULT: 'TRANSLATE_BATCH_RESULT',
    DOWNLOAD_PROGRESS: 'DOWNLOAD_PROGRESS',
    DOWNLOAD_COMPLETE: 'DOWNLOAD_COMPLETE',

    // Panel ↔ Content Script (via chrome.runtime.connect Port)
    BATCH_RESULT: 'BATCH_RESULT',
    SCROLL_TO: 'SCROLL_TO',
  };

  // ==================== Translation State Machine ====================
  const State = {
    IDLE: 'IDLE',
    SCANNING: 'SCANNING',
    TRANSLATING: 'TRANSLATING',
    PAUSED: 'PAUSED',
    ERROR: 'ERROR',
  };

  // ==================== DOM Selectors ====================
  const CONTENT_SELECTORS = [
    'article',
    'main',
    '.content',
    '.post',
    '.entry-content',
    '[role="main"]',
    '.markdown-body',
    '.prose',
    '#main-content',
    '.post-content',
    '.page-content',
    '.document',
    '.docs-content',
    '.doc-content',
    '.article-content',
    '.entry',
  ];

  const TRANSLATABLE_TAGS = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'LI', 'TD', 'TH', 'BLOCKQUOTE',
    'DD', 'DT', 'FIGCAPTION',
  ]);

  const EXCLUDED_CONTAINERS = new Set([
    'NAV', 'HEADER', 'FOOTER', 'ASIDE',
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE',
  ]);

  const EXCLUDED_ROLES = [
    'complementary', 'navigation', 'banner', 'contentinfo',
  ];

  // CSS class name patterns that indicate non-content areas
  const EXCLUDED_CLASS_PATTERNS = [
    /(^|\s)(ad-|ads-|advertisement|banner|sponsor)/i,
    /(^|\s)(sidebar|side-bar|side_nav)/i,
    /(^|\s)(nav-|navbar|menu-|dropdown|breadcrumbs)/i,
    /(^|\s)(modal|popup|toast|notification|cookie-banner|consent)/i,
  ];

  /**
   * Content Root Finder
   * Finds the best content root(s) for translation extraction.
   * Multi-candidate collection + deduplication + smart sibling merging.
   */


  /**
   * Find all candidate content roots on the page.
   * @returns {Element[]}
   */
  function findContentRoots() {
    const candidates = [];

    for (const selector of CONTENT_SELECTORS) {
      document.querySelectorAll(selector).forEach((el) => candidates.push(el));
    }

    if (candidates.length === 0) {
      return [document.body];
    }

    // Deduplicate: if A contains B, keep only the outermost A
    const roots = candidates.filter((a) =>
      !candidates.some((b) => b !== a && b.contains(a))
    );

    // Smart merge: if multiple candidates are same-tag siblings, return their parent
    if (roots.length >= 2) {
      const firstParent = roots[0].parentElement;
      if (
        firstParent &&
        roots.every((r) => r.parentElement === firstParent)
      ) {
        const allSameTag = roots.every((r) => r.tagName === roots[0].tagName);
        if (allSameTag) {
          return [firstParent];
        }
      }
    }

    // Sort by area + center-weighted score (larger and more centered = better)
    roots.sort((a, b) => scoreRoot(b) - scoreRoot(a));
    return roots;
  }

  /**
   * Score a root element by area and visual centrality.
   * Larger area and closer to viewport center = higher score.
   */
  function scoreRoot(el) {
    const rect = el.getBoundingClientRect();
    const area = rect.width * rect.height;
    const centerX = (rect.left + rect.right) / 2;
    const screenCenterX = window.innerWidth / 2;
    const centerDist = Math.abs(centerX - screenCenterX);
    // penalize elements far from center; minimum area threshold of 100
    return Math.max(0, area - centerDist * 10);
  }

  /**
   * WebTranslate shared utilities
   * Hashing, validation, prompt building, response parsing, token calculation
   */

  /**
   * Lightweight djb2 hash (faster than SHA-256; collision probability is
   * negligible for caches up to ~500 entries).
   * Returns a 14-char hex string (12 chars from hash + 2 random).
   * @param {string} str
   * @returns {string}
   */
  function djb2Hash(str) {
    // Dual djb2 to produce 16 hex chars, then trim to 12 + 2 random = 14
    let h1 = 5381;
    let h2 = 52711;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = ((h1 << 5) + h1) + c;
      h2 = ((h2 << 5) + h2) + c;
    }
    const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
    const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
    const combined = hex1 + hex2; // 16 chars
    return combined.slice(0, 14);
  }

  /**
   * Debounce a function.
   * @param {Function} fn
   * @param {number} delay ms
   * @returns {Function}
   */
  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // ==================== Content Filtering Helpers ====================

  /**
   * Check if text is a pure URL.
   * @param {string} text
   * @returns {boolean}
   */
  function isPureUrl(text) {
    return /^https?:\/\/\S+$/.test(text.trim());
  }

  /**
   * Check if text is a short number or timestamp (skip translation).
   * @param {string} text
   * @returns {boolean}
   */
  function isShortNumberOrTimestamp(text) {
    const t = text.trim();
    if (/^\d{1,6}$/.test(t)) return true;
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return true;
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(t)) return true;
    return false;
  }

  /**
   * Content Scanner — Text-driven extraction
   * Scans a DOM subtree for translatable text blocks.
   * Rules: semantic tags are extracted directly; any other tag with enough
   * direct text (excluding child elements) is treated as a text block.
   */


  const MIN_TEXT_LENGTH = 3;
  const MIN_DIRECT_TEXT_LENGTH = 15;
  const MAX_TEXT_LENGTH = 5000;
  const LINK_DENSITY_THRESHOLD = 0.5;

  const INTERACTIVE_TAGS = new Set([
    'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA',
  ]);

  /**
   * Scan a root element for translatable text blocks.
   * @param {Element} root
   * @returns {{element: Element, text: string}[]}
   */
  function scanTextBlocks(root) {
    const results = [];

    function walk(el) {
      if (el.nodeType !== Node.ELEMENT_NODE) return;
      if (isExcluded(el)) return;

      // Skip already-translated elements and translation UI cards
      if (el.dataset?.wtDone) return;
      if (el.classList?.contains('wt-inline-block') || el.classList?.contains('wt-pending')) return;

      const tag = el.tagName;

      // Case 1: semantic translatable tag — extract directly
      if (TRANSLATABLE_TAGS.has(tag)) {
        const text = getText(el);
        if (isContentBlock(text, el)) {
          results.push({ element: el, text });
        }
        return;
      }

      // Case 2: contains interactive elements — recurse children only
      if (hasInteractiveDescendant(el)) {
        for (const child of el.children) walk(child);
        return;
      }

      // Case 3: contains semantic descendants — recurse so p/h1/etc are extracted individually
      if (hasTranslatableDescendant(el)) {
        for (const child of el.children) walk(child);
        return;
      }

      // Case 4: any other tag with enough direct text (not from children)
      const text = getText(el);
      const directText = getDirectText(el);
      if (directText.length >= MIN_DIRECT_TEXT_LENGTH && isContentBlock(text, el)) {
        results.push({ element: el, text });
        return;
      }

      // Case 5: recurse into children
      for (const child of el.children) walk(child);
    }

    for (const child of root.children) walk(child);
    return results;
  }

  // ------------------------------------------------------------------
  // Exclusion
  // ------------------------------------------------------------------

  function isExcluded(el) {
    let node = el;
    while (node && node !== document.body) {
      if (EXCLUDED_CONTAINERS.has(node.tagName)) return true;

      const role = node.getAttribute?.('role');
      if (role && EXCLUDED_ROLES.includes(role)) return true;

      const cls = node.className;
      if (typeof cls === 'string') {
        for (const pattern of EXCLUDED_CLASS_PATTERNS) {
          if (pattern.test(cls)) return true;
        }
      }

      node = node.parentElement;
    }
    return false;
  }

  // ------------------------------------------------------------------
  // Block-level filtering
  // ------------------------------------------------------------------

  function isContentBlock(text, el) {
    if (!text || text.length < MIN_TEXT_LENGTH) return false;
    if (text.length > MAX_TEXT_LENGTH) return false;
    if (isPureUrl(text)) return false;
    if (isShortNumberOrTimestamp(text)) return false;
    if (getLinkDensity(el) > LINK_DENSITY_THRESHOLD) return false;
    return true;
  }

  function getLinkDensity(el) {
    const text = el.textContent.trim();
    if (!text) return 0;
    const links = el.querySelectorAll('a');
    let linkTextLen = 0;
    for (const a of links) linkTextLen += a.textContent.length;
    return linkTextLen / text.length;
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  function getText(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function getDirectText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function hasInteractiveDescendant(el) {
    return el.querySelector(Array.from(INTERACTIVE_TAGS).join(',')) !== null;
  }

  function hasTranslatableDescendant(el) {
    return el.querySelector(Array.from(TRANSLATABLE_TAGS).join(',')) !== null;
  }

  /**
   * Extractor — Unified entry for content extraction.
   * Orchestrates content-root-finder + content-scanner.
   */


  const MAX_ID_DEPTH = 6;

  /**
   * Extract paragraphs eligible for translation from the current document.
   * @returns {Element[]}
   */
  function extractParagraphs() {
    const roots = findContentRoots();
    const seen = new Set();
    const results = [];

    for (const root of roots) {
      const blocks = scanTextBlocks(root);
      for (const block of blocks) {
        if (seen.has(block.element)) continue;
        seen.add(block.element);
        results.push(block.element);
      }
    }

    // Debug: log extraction summary
    console.log(
      `[WT] Extracted ${results.length} blocks from ${roots.length} root(s). ` +
      `Tags: ${results.map((e) => e.tagName.toLowerCase()).join(',') || 'none'}`
    );

    return results;
  }

  /**
   * Get clean translatable text from an element.
   * No clone needed — script/style containers are already excluded by the scanner.
   * @param {Element} el
   * @returns {string}
   */
  function getTranslatableText(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Generate a stable paragraph ID based on its DOM path.
   * @param {Element} el
   * @returns {string}
   */
  function generateParagraphId(el) {
    const path = [];
    let node = el;
    let depth = 0;

    while (node && node !== document.body && depth < MAX_ID_DEPTH) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      const index = parent ? Array.from(parent.children).indexOf(node) : 0;
      path.unshift(`${tag}${index}`);
      node = parent;
      depth++;
    }

    return 'wt_' + path.join('_');
  }

  /**
   * Content fingerprint utilities for deduplication
   * L1: DOM marker (data-wt-done="fingerprint")
   * L2: Content fingerprint via djb2 hash
   */


  /**
   * Compute a content fingerprint for a paragraph element.
   * @param {Element} el
   * @returns {string} 14-char hex fingerprint
   */
  function computeFingerprint(el) {
    const text = el.textContent.replace(/\s+/g, ' ').trim();
    return djb2Hash(text);
  }

  /**
   * Mark an element as translated (L1 DOM marker).
   * @param {Element} el
   * @param {string} fingerprint
   */
  function markTranslated(el, fingerprint) {
    if (fingerprint) {
      el.dataset.wtDone = fingerprint.slice(0, 12);
    } else if (!el.dataset.wtDone) {
      el.dataset.wtDone = '1';
    }
  }

  /**
   * BatchCollector - Viewport-first lazy collection with batching rules
   * Rules:
   *   - Max 800 chars per batch
   *   - Max 8 items per batch
   *   - Single item >= 800 chars becomes its own batch
   *   - Debounce 100ms before flushing
   */


  class BatchCollector {
    /**
     * @param {Function} onBatch - callback(batchItems: {id, fingerprint, text, element}[])
     * @param {object} options
     * @param {number} options.maxBatchChars
     * @param {number} options.maxBatchItems
     * @param {number} options.debounceMs
     */
    constructor(onBatch, options = {}) {
      this.onBatch = onBatch;
      this.maxBatchChars = options.maxBatchChars ?? 800;
      this.maxBatchItems = options.maxBatchItems ?? 8;
      this.debounceMs = options.debounceMs ?? 100;

      this.observer = null;
      /** @type {Map<Element, {id:string, fingerprint:string, text:string}>} */
      this.elementMap = new Map();
      /** @type {{id:string, fingerprint:string, text:string, element:Element}[]} */
      this.pending = [];
      this.processed = new Set(); // fingerprints already sent
      this._flush = debounce(() => this._doFlush(), this.debounceMs);
    }

    /**
     * Start observing elements that are already registered in elementMap.
     */
    start() {
      if (this.observer) this.stop();

      this.observer = new IntersectionObserver(
        (entries) => this._handleEntries(entries),
        { rootMargin: '0px 0px 200px 0px', threshold: 0 }
      );

      for (const el of this.elementMap.keys()) {
        if (!el.dataset.wtDone) {
          this.observer.observe(el);
        }
      }
    }

    /**
     * Stop observing and clear pending queue.
     */
    stop() {
      this.observer?.disconnect();
      this.observer = null;
      this.pending = [];
      this.processed.clear();
    }

    /**
     * Register a new element with its metadata.
     * @param {Element} el
     * @param {{id:string, fingerprint:string, text:string}} info
     */
    observeElement(el, info) {
      if (!this.observer) return;
      if (el.dataset?.wtDone) return; // already translated
      this.elementMap.set(el, info);
      this.observer.observe(el);
    }

    // ------------------------------------------------------------------
    // Internal
    // ------------------------------------------------------------------

    _handleEntries(entries) {
      // Only process elements that are actually intersecting AND not
      // yet translated.  Keep them observed so they continue to fire
      // on subsequent scroll events — the wtDone guard prevents
      // duplicate processing.
      const needs = entries
        .filter((e) => e.isIntersecting && !e.target.dataset.wtDone)
        .map((e) => e.target);

      if (needs.length) {
        for (const el of needs) {
          const info = this.elementMap.get(el);
          if (info) {
            this.pending.push({ ...info, element: el });
          }
        }
        this._flush();
      }
    }

    _doFlush() {
      if (!this.pending.length) return;

      // Sort by document order for stable batching
      this.pending.sort((a, b) => {
        const pos = a.element.compareDocumentPosition(b.element);
        return (pos & Node.DOCUMENT_POSITION_PRECEDING) ? 1 : -1;
      });

      const batches = this._groupIntoBatches(this.pending);
      this.pending = [];

      for (const batch of batches) {
        for (const item of batch) {
          this.processed.add(item.fingerprint);
        }
        this.onBatch(batch);
      }
    }

    /**
     * Group pending items into batches respecting size limits.
     * @param {{id, fingerprint, text, element:Element}[]} items
     * @returns {{id, fingerprint, text, element:Element}[][]}
     */
    _groupIntoBatches(items) {
      const batches = [];
      let current = [];
      let currentChars = 0;

      for (const item of items) {
        // Skip if already processed (L2 dedup)
        if (this.processed.has(item.fingerprint)) continue;
        this.processed.add(item.fingerprint); // mark immediately to dedup within batch

        const textLen = item.text.length;

        // Oversized item: flush current batch, then solo batch
        if (textLen >= this.maxBatchChars) {
          if (current.length) {
            batches.push(current);
            current = [];
            currentChars = 0;
          }
          batches.push([item]);
          continue;
        }

        // Would exceed limits: flush current, start new
        if (
          current.length >= this.maxBatchItems ||
          currentChars + textLen > this.maxBatchChars
        ) {
          batches.push(current);
          current = [];
          currentChars = 0;
        }

        current.push(item);
        currentChars += textLen;
      }

      if (current.length) batches.push(current);
      return batches;
    }
  }

  /**
   * ObserverManager - Manages IntersectionObserver + MutationObserver lifecycle
   * For SPA dynamic content: watches DOM mutations and auto-registers new
   * translatable elements into the BatchCollector.
   */


  class ObserverManager {
    /**
     * @param {BatchCollector} batchCollector
     * @param {Function} onNewElements - optional callback for newly added elements
     */
    constructor(batchCollector, onNewElements) {
      this.batchCollector = batchCollector;
      this.onNewElements = onNewElements;
      this.mutationObserver = null;
      this._handleMutations = debounce((els) => this._registerElements(els), 500);
    }

    /**
     * Start MutationObserver on the content root.
     * @param {Element} root
     */
    start(root) {
      if (this.mutationObserver) this.stop();

      this.mutationObserver = new MutationObserver((mutations) => {
        const added = [];
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              added.push(node);
            }
          }
        }
        if (added.length) this._handleMutations(added);
      });

      this.mutationObserver.observe(root, {
        childList: true,
        subtree: true,
      });
    }

    /**
     * Stop MutationObserver.
     */
    stop() {
      this.mutationObserver?.disconnect();
      this.mutationObserver = null;
    }

    // ------------------------------------------------------------------

    _registerElements(addedNodes) {
      const newElements = [];
      for (const node of addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        const blocks = scanTextBlocks(node);
        for (const block of blocks) {
          const el = block.element;
          if (!el.dataset.wtDone && !el.dataset.wtObservable) {
            el.dataset.wtObservable = 'true';
            newElements.push(el);
          }
        }
      }

      if (newElements.length) {
        for (const el of newElements) {
          this.batchCollector.observeElement(el);
        }
        this.onNewElements?.(newElements);
      }
    }
  }

  /**
   * StateManager - Translation state machine
   * States: IDLE → SCANNING → TRANSLATING ↔ PAUSED → ERROR → IDLE
   * All transitions are guarded; invalid transitions are rejected.
   */


  const VALID_TRANSITIONS = {
    [State.IDLE]: [State.SCANNING],
    [State.SCANNING]: [State.TRANSLATING, State.IDLE, State.ERROR],
    [State.TRANSLATING]: [State.PAUSED, State.IDLE, State.ERROR],
    [State.PAUSED]: [State.TRANSLATING, State.IDLE, State.ERROR],
    [State.ERROR]: [State.IDLE, State.SCANNING],
  };

  class StateManager {
    constructor() {
      this._state = State.IDLE;
      this._listeners = [];
      this._history = []; // for debugging
    }

    /** @returns {string} current state */
    get() {
      return this._state;
    }

    /**
     * Attempt to transition to a new state.
     * @param {string} to
     * @returns {boolean} true if transition succeeded
     */
    transition(to) {
      const from = this._state;
      const allowed = VALID_TRANSITIONS[from] ?? [];
      if (!allowed.includes(to)) {
        console.warn(`[WT] Invalid state transition: ${from} -> ${to}`);
        return false;
      }
      this._state = to;
      this._history.push({ from, to, at: Date.now() });
      this._notify(to, from);
      return true;
    }

    /**
     * Register a state change listener.
     * @param {(newState: string, oldState: string) => void} fn
     */
    onChange(fn) {
      this._listeners.push(fn);
    }

    /**
     * Remove a state change listener.
     * @param {(newState: string, oldState: string) => void} fn
     */
    offChange(fn) {
      this._listeners = this._listeners.filter((l) => l !== fn);
    }

    _notify(to, from) {
      for (const fn of this._listeners) {
        try {
          fn(to, from);
        } catch (err) {
          console.error('[WT] State listener error:', err);
        }
      }
    }

    /** Debug helper */
    getHistory() {
      return [...this._history];
    }
  }

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

  class CacheManager {
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

  /**
   * ConcurrencyController - Limits the number of in-flight translation batches.
   * Default concurrency: 3 batches at a time.
   * Uses a promise-based queue; new requests wait until a slot frees up.
   */

  class ConcurrencyController {
    /**
     * @param {number} limit max concurrent batches (1-10)
     */
    constructor(limit = 3) {
      this.limit = Math.max(1, Math.min(10, limit));
      this.active = 0;
      /** @type {Array<{fn: () => Promise<any>, resolve: Function, reject: Function}>} */
      this.queue = [];
    }

    /**
     * Execute a function when a slot becomes available.
     * @template T
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    async run(fn) {
      if (this.active < this.limit) {
        return this._execute(fn);
      }
      return new Promise((resolve, reject) => {
        this.queue.push({ fn, resolve, reject });
      });
    }

    /**
     * Cancel all queued (not yet started) tasks.
     * Active tasks continue; queued tasks are rejected.
     */
    cancelQueued() {
      while (this.queue.length) {
        const { reject } = this.queue.shift();
        reject(new Error('Queue cancelled'));
      }
    }

    /**
     * Get current queue depth.
     * @returns {number}
     */
    pendingCount() {
      return this.queue.length;
    }

    // ------------------------------------------------------------------

    async _execute(fn) {
      this.active++;
      try {
        const result = await fn();
        return result;
      } finally {
        this.active--;
        this._drain();
      }
    }

    _drain() {
      if (this.active >= this.limit) return;
      const next = this.queue.shift();
      if (!next) return;
      this._execute(next.fn).then(next.resolve).catch(next.reject);
    }
  }

  /**
   * CircuitBreaker - Pauses translation after consecutive failures.
   * Threshold: 5 consecutive batch failures → trigger PAUSED state.
   * Reset: successful batch or manual resume resets the counter.
   */

  class CircuitBreaker {
    /**
     * @param {object} options
     * @param {number} options.threshold default 5
     * @param {Function} options.onOpen called when breaker trips
     */
    constructor(options = {}) {
      this.threshold = options.threshold ?? 5;
      this.onOpen = options.onOpen ?? (() => {});
      this._failures = 0;
      this._isOpen = false;
    }

    /**
     * Record a successful batch.
     */
    recordSuccess() {
      this._failures = 0;
      this._isOpen = false;
    }

    /**
     * Record a failed batch.
     * @returns {boolean} true if breaker has just tripped
     */
    recordFailure() {
      if (this._isOpen) return false;
      this._failures++;
      if (this._failures >= this.threshold) {
        this._isOpen = true;
        this.onOpen();
        return true;
      }
      return false;
    }

    /**
     * Check if breaker is currently open (tripped).
     * @returns {boolean}
     */
    isOpen() {
      return this._isOpen;
    }

    /**
     * Manual reset (e.g. user clicks resume).
     */
    reset() {
      this._failures = 0;
      this._isOpen = false;
    }
  }

  /**
   * Lightweight i18n module for WebTranslate Chrome Extension.
   *
   * Loads locale JSON files from src/shared/locales/.
   * Detects the user's language from chrome.storage.local (preferred)
   * or navigator.language.  String keys use a simple dotted-path
   * notation (e.g. "settings.title").
   *
   * Usage:
   *   import { i18n } from '../shared/i18n.js';
   *   await i18n.init();
   *   const label = i18n.t('popup.saveBtn');  // "Save Settings"
   *   const fmt   = i18n.tf('panel.translatedCount', { count: 5 });
   *
   * Locale files are plain JSON keyed by dotted path.
   */

  const DEFAULT_LOCALE = 'en';
  const STORAGE_KEY = 'wt_language';

  /** Built-in English fallback – always available even when fetch fails. */
  const HARDCODED_EN_FALLBACK = {
    'locale.name': 'English',

    'popup.title': 'WebTranslate Settings',
    'popup.apiUrl.label': 'API URL',
    'popup.apiUrl.hint': 'Supports OpenAI-compatible APIs, DeepSeek, Tongyi Qianwen, etc.',
    'popup.apiUrl.error': 'Invalid URL format',
    'popup.apiKey.label': 'API Key',
    'popup.apiKey.toggle_show': 'Show',
    'popup.apiKey.toggle_hide': 'Hide',
    'popup.apiKey.error': 'Cannot be empty; at least 8 characters',
    'popup.model.label': 'Model Name',
    'popup.model.error': 'Cannot be empty',
    'popup.adapter.label': 'Adapter',
    'popup.defaultMode.label': 'Default Mode',
    'popup.defaultMode.inline': 'Inline Mode',
    'popup.defaultMode.panel': 'Panel Mode',
    'popup.language.label': 'Language',
    'popup.concurrency.label': 'Concurrency',
    'popup.maxBatchChars.label': 'Max Chars per Batch',
    'popup.testBtn': 'Test Connection',
    'popup.saveBtn': 'Save Settings',
    'popup.exportBtn': 'Export Config',
    'popup.importBtn': 'Import Config',
    'popup.footer': 'API Key is stored only in your local browser and is never uploaded to third-party servers.',
    'popup.test_connecting': 'Testing...',
    'popup.test_fix_errors': 'Please fix form errors before testing',
    'popup.test_success': 'Connection successful',
    'popup.test_auth_fail': 'Invalid API Key or insufficient balance',
    'popup.test_request_fail': 'Request failed: {message}',
    'popup.save_success': 'Settings saved',
    'popup.save_http_warning': 'You are using HTTP which may expose data. Continue?',
    'popup.import_fail_validation': 'Import failed: {errors}',
    'popup.import_fail_parse': 'Import failed: {message}',
    'popup.import_success': 'Config imported',

    'panel.title': 'WebTranslate',
    'panel.connected': 'Connected',
    'panel.disconnected': 'Disconnected',
    'panel.waiting': 'Waiting for translation...',
    'panel.empty_hint': 'Click the translate button on the page to see translations here',
    'panel.copy': 'Copy',
    'panel.scroll_to': 'Locate',
    'panel.translated_count': 'Translated {count} paragraph(s)',

    'fab.translate_inline': 'Inline Translate',
    'fab.translate_panel': 'Panel Translate',
    'fab.translate': 'Translate',
    'fab.switch_to_inline': 'Switch to Inline',
    'fab.switch_to_panel': 'Switch to Panel',
    'fab.retranslate': 'Retranslate',
    'fab.clear': 'Clear',
    'fab.download': 'Download Page',
    'fab.settings': 'Settings',
    'fab.stop': 'Stop',

    'inline.badge': 'Translation',
    'inline.toggle_fold': 'Collapse',
    'inline.toggle_unfold': 'Expand',
    'inline.translating': 'Translating...',

    'toast.api_not_configured': 'API not configured',
    'toast.config_hint': 'Set your API URL, Key and Model — translation starts automatically once saved.',
    'toast.open_settings': 'Open Settings',
    'toast.dismiss': 'Dismiss',
    'toast.panel_unavailable': 'Panel mode unavailable',
    'toast.panel_fallback': 'Switched to inline mode.',
  };

  /** @type {{locale:string, messages:Record<string,string>, ready:boolean}} */
  const _state = {
    locale: DEFAULT_LOCALE,
    messages: {},
    ready: false,
  };

  /**
   * Load (or reload) messages for the given locale.
   * Falls back to 'en' if the requested locale bundle is missing.
   * @param {string} [locale] – optional; otherwise reads from storage / navigator
   */
  async function init$1(locale) {
    const target = locale || (await _resolveLocale());
    _state.locale = target;
    _state.messages = {};
    _state.ready = false;

    // Always pre-seed with the hardcoded English fallback
    _state.messages = { ...HARDCODED_EN_FALLBACK };

    try {
      const url = chrome.runtime.getURL(`src/shared/locales/${target}.json`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Override built-in fallback with fetched translations
      const fetched = await res.json();
      Object.assign(_state.messages, fetched);
    } catch {
      // Fetch failed – hardcoded English fallback already loaded above.
      // If a different locale was requested (e.g. zh-CN) and fetch failed,
      // keep the English fallback so the UI is at least readable.
      if (target !== DEFAULT_LOCALE) {
        _state.locale = target; // keep the user's locale choice even though we show English
      }
    }

    _state.ready = true;
  }

  /**
   * Look up a dotted-path key.
   * Returns the key itself when no translation is found anywhere.
   * @param {string} key  e.g. "popup.saveBtn"
   * @returns {string}
   */
  function t(key) {
    // Messages are always pre-seeded with HARDCODED_EN_FALLBACK;
    // _state.ready only gates DOM-tree scanning (applyI18nElements).
    return _state.messages[key] ?? key;
  }

  // -------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------

  async function _resolveLocale() {
    // 1) User preference from storage
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      if (stored[STORAGE_KEY]) return stored[STORAGE_KEY];
    } catch { /* ignore */ }

    // 2) Browser language
    const nav = navigator.language;
    if (nav) {
      if (nav.startsWith('zh')) return 'zh-CN';
      if (nav.startsWith('ja')) return 'ja';
    }

    return DEFAULT_LOCALE;
  }

  /**
   * InlineRenderer — Material 3 translation blocks.
   *
   * Colour palette:
   *   Primary:     #6750a4   Badges, accents, links
   *   Surface:     #ffffff   Card background
   *   Text:        #1d1b20   Body text
   *   Muted:       #79747e   Secondary labels
   *   Border:      #e7e0ec   Outlines
   */


  // Persisted across instances
  let _stylesInjected = false;

  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const css = `
.wt-inline-block{font-family:'Segoe UI Variable','Segoe UI',system-ui,-apple-system,sans-serif;
  position:relative;margin:4px 0;border-radius:6px;border:1px solid #e7e0ec;
  background:#fff;color:#1d1b20;font-size:13px;line-height:1.45;
  box-shadow:0 1px 2px rgba(0,0,0,.04);
  padding:6px 10px;word-break:break-word;
  animation:wt-fade-in .2s ease;}
@keyframes wt-fade-in{from{opacity:0;transform:translateY(2px)}to{opacity:1;transform:translateY(0)}}
.wt-inline-badge{display:inline-flex;align-items:center;margin-right:3px;vertical-align:middle;}
.wt-inline-fold{position:absolute;top:4px;right:6px;background:transparent;border:none;
  padding:0;font-size:12px;line-height:1;cursor:pointer;color:#6750a4;opacity:0.35;
  transition:opacity .15s;z-index:1;}
.wt-inline-block:hover .wt-inline-fold{opacity:0.7;}
.wt-inline-fold:hover{opacity:1;}
.wt-inline-fold:focus-visible{outline:2px solid #6750a4;outline-offset:1px;}
.wt-inline-body{font-size:13px;line-height:1.45;color:#1d1b20;}
.wt-pending{font-family:'Segoe UI Variable','Segoe UI',system-ui,-apple-system,sans-serif;
  margin:2px 0;padding:4px 8px;color:#79747e;font-size:11px;display:flex;align-items:center;gap:6px;
  animation:wt-fade-in .2s ease;}
.wt-spinner{display:inline-block;width:12px;height:12px;border:2px solid #e7e0ec;
  border-top-color:#6750a4;border-radius:50%;animation:wt-spin .7s linear infinite;}
@keyframes wt-spin{to{transform:rotate(360deg)}}
`;
    const st = document.createElement('style');
    st.id = 'wt-inline-styles';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  class InlineRenderer {

    render(originalEl, translation, paragraphId) {
      injectStyles();
      markTranslated(originalEl, paragraphId);
      this.removePending(originalEl);

      // Remove any adjacent wt-inline-block / wt-pending (duplicate guard)
      let sib = originalEl.nextElementSibling;
      while (sib && (sib.classList.contains('wt-inline-block') || sib.classList.contains('wt-pending'))) {
        const n = sib.nextElementSibling; sib.remove(); sib = n;
      }

      const card = document.createElement('div');
      card.className = 'wt-inline-block';
      card.dataset.wtId = paragraphId;

      card.innerHTML = `
      <button class="wt-inline-fold">⌄</button>
      <div class="wt-inline-body">${escapeHtml(translation)}</div>`;

      card.querySelector('.wt-inline-fold').addEventListener('click', () => {
        const body = card.querySelector('.wt-inline-body');
        const btn = card.querySelector('.wt-inline-fold');
        const f = body.style.display === 'none';
        body.style.display = f ? '' : 'none';
        btn.textContent = f ? '⌄' : '⌃';
      });

      originalEl.insertAdjacentElement('afterend', card);
      return card;
    }

    showPending(originalEl, paragraphId) {
      injectStyles();
      if (originalEl.nextElementSibling?.classList?.contains('wt-pending')) return;
      const el = document.createElement('div');
      el.className = 'wt-pending';
      el.dataset.wtId = paragraphId;
      el.innerHTML = `<span class="wt-spinner"></span> ${t('inline.translating')}`;
      originalEl.insertAdjacentElement('afterend', el);
    }

    removePending(originalEl) {
      const n = originalEl.nextElementSibling;
      if (n?.classList?.contains('wt-pending')) n.remove();
    }

    clearAll() {
      document.querySelectorAll('.wt-inline-block, .wt-pending').forEach(e => e.remove());
      // Remove wtDone markers so elements can be re-processed on next translation
      document.querySelectorAll('[data-wt-done]').forEach(el => { delete el.dataset.wtDone; });
    }

    update(paragraphId, newTranslation) {
      const el = document.querySelector(`.wt-inline-block[data-wt-id="${paragraphId}"]`);
      if (!el) return;
      const body = el.querySelector('.wt-inline-body');
      if (body) body.innerHTML = escapeHtml(newTranslation);
    }
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /**
   * PanelRenderer - Pushes translation results to the Chrome Side Panel
   * via chrome.runtime.connect long-lived Port.
   *
   * chrome.sidePanel.open() is only available in the Service Worker context,
   * NOT in content scripts.  We delegate the open call via SW message.
   */

  const PORT_CS_NAME = 'wt-panel-cs';

  class PanelRenderer {
    constructor(tabId) {
      this.tabId = tabId;
      this.port = null;
      this._connected = false;
    }

    /**
     * Open the side panel (via SW) and establish a Port connection.
     * @returns {Promise<boolean>} true if panel opened successfully
     */
    async open() {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL', tabId: this.tabId });
        if (!res || !res.ok) {
          console.warn('[WT] SW failed to open side panel:', res?.error || 'unknown');
          return false;
        }
      } catch (err) {
        console.warn('[WT] OPEN_SIDE_PANEL message failed:', err.message);
        return false;
      }

      this._connect();
      return true;
    }

    /**
     * Send a batch of translated items to the panel.
     * @param {{id:string, original:string, translation:string}[]} items
     */
    renderBatch(items) {
      this._post({ type: 'BATCH_RESULT', items });
    }

    /**
     * Send the full slot list to the panel so it can render placeholders
     * for every paragraph BEFORE any translations arrive.  The panel
     * creates empty slots ordered by sortOrder; subsequent BATCH_RESULT
     * messages fill them in-place, guaranteeing correct visual order.
     * @param {{id:string, original:string, sortOrder:number}[]} items
     */
    initSlots(items) {
      this._post({ type: 'INIT_SLOTS', items });
    }

    /**
     * Append new slots for paragraphs discovered AFTER the initial extraction
     * (progressive-loading / infinite-scroll pages).
     * @param {{id:string, original:string, sortOrder:number}[]} items
     */
    appendSlots(items) {
      this._post({ type: 'APPEND_SLOTS', items });
    }

    /**
     * Mark one or more slots as errored so the panel can show an error icon.
     * @param {string[]} itemIds
     */
    markSlotErrors(itemIds) {
      this._post({ type: 'SLOT_ERROR', itemIds });
    }

    /**
     * Close the Port connection.
     */
    dispose() {
      this.port?.disconnect();
      this.port = null;
      this._connected = false;
    }

    // ------------------------------------------------------------------

    _connect() {
      if (this.port) return;
      try {
        this.port = chrome.runtime.connect({ name: PORT_CS_NAME });
        this._connected = true;
        this.port.onDisconnect.addListener(() => {
          this._connected = false;
          this.port = null;
        });
      } catch (err) {
        console.warn('[WT] Port connection failed:', err.message);
        this._connected = false;
      }
    }

    _post(msg) {
      if (!this._connected) this._connect();
      if (!this.port) return;
      try { this.port.postMessage(msg); } catch { /* panel may have closed */ }
    }
  }

  /**
   * FabComponent — Material 3 floating action button.
   *
   * Design language:
   *   White surface, subtle shadows, purple primary (#6750a4)
   *   Pill-shaped buttons (20px radius), 12px card corners
   *   Compact radial menu with clean labels & SVG line icons
   *   Context-aware dynamic menu — items change based on translation state
   *
   * Lifecycle: IDLE → TRANSLATING → PAUSED
   *   IDLE:         [Translate] [Panel]   Download, Settings
   *   TRANSLATING:  [Stop]       [Switch] Download, Settings
   *   PAUSED:       [Translate]  [Retranslate] [Clear] Download, Settings
   */

  const SIZE = 44;
  const STYLE_ID = 'wt-fab-css';

  // Single <style> injected once
  const CSS = `
#wt-fab-backdrop{position:fixed;inset:0;z-index:2147483645;pointer-events:none;
  background:transparent;transition:background .2s;}
#wt-fab-backdrop.open{pointer-events:auto;background:rgba(0,0,0,.15);}

#wt-fab{position:fixed;z-index:2147483647;width:${SIZE}px;height:${SIZE}px;
  border-radius:50%;cursor:pointer;user-select:none;touch-action:none;
  display:flex;align-items:center;justify-content:center;
  font-family:'Segoe UI Variable','Segoe UI',system-ui,-apple-system,sans-serif;
  background:#fff;
  box-shadow:0 1px 3px rgba(0,0,0,.12),0 4px 12px rgba(0,0,0,.08);
  transition:transform .2s,box-shadow .2s;}
#wt-fab:hover{transform:scale(1.08);box-shadow:0 2px 6px rgba(0,0,0,.14),0 6px 18px rgba(0,0,0,.1);}

/* ---- IDLE ---- */
#wt-fab.wt-idle .wt-fab-t{fill:#6750a4;}
#wt-fab.wt-idle .wt-fab-ring{stroke:#cac4d0;fill:none;}
#wt-fab.wt-idle .wt-fab-bracket{stroke:#cac4d0;fill:none;}

/* ---- ACTIVE (TRANSLATING) ---- */
#wt-fab.wt-active{background:#eaddff;}
#wt-fab.wt-active .wt-fab-t{fill:#6750a4;}
#wt-fab.wt-active .wt-fab-ring{stroke:#6750a4;fill:none;}
#wt-fab.wt-active .wt-fab-bracket{stroke:#6750a4;fill:none;}

/* ---- PAUSED ---- */
#wt-fab.wt-paused{background:#fef7e0;}
#wt-fab.wt-paused .wt-fab-t{fill:#795600;}
#wt-fab.wt-paused .wt-fab-ring{stroke:#795600;fill:none;}
#wt-fab.wt-paused .wt-fab-bracket{stroke:#795600;fill:none;}

/* ---- ERROR ---- */
#wt-fab.wt-error{background:#f9dedc;}
#wt-fab.wt-error .wt-fab-t{fill:#b3261e;}
#wt-fab.wt-error .wt-fab-ring{stroke:#b3261e;fill:none;}
#wt-fab.wt-error .wt-fab-bracket{stroke:#b3261e;fill:none;}

/* Pulse animation — draws attention when paused */
#wt-fab.wt-pulse{animation:wt-pulse .6s ease;}
@keyframes wt-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}

/* ---- Mode badge ---- */
#wt-fab .wt-mode-badge{position:absolute;top:-2px;right:-2px;
  width:18px;height:18px;border-radius:50%;
  font-size:9px;font-weight:700;color:#fff;
  display:none;align-items:center;justify-content:center;
  box-shadow:0 1px 3px rgba(0,0,0,.2);}
#wt-fab.wt-idle .wt-mode-badge{background:#6750a4;}
#wt-fab.wt-active .wt-mode-badge{background:#6750a4;}
#wt-fab.wt-paused .wt-mode-badge{background:#795600;}
#wt-fab.wt-error .wt-mode-badge{background:#b3261e;}

/* ---- Menu items ---- */
.wt-fab-menu-item{position:absolute;display:flex;align-items:center;gap:8px;
  white-space:nowrap;cursor:pointer;pointer-events:auto;
  font-family:'Segoe UI Variable','Segoe UI',system-ui,-apple-system,sans-serif;
  font-size:13px;color:#1d1b20;transition:opacity .2s,transform .25s cubic-bezier(.2,0,0,1);}
.wt-fab-menu-item .wt-mi-dot{width:36px;height:36px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  background:#fff;flex-shrink:0;border:1px solid #e7e0ec;
  box-shadow:0 1px 3px rgba(0,0,0,.08);
  transition:background .15s,transform .15s;}
.wt-fab-menu-item:hover .wt-mi-dot{background:#eaddff;transform:scale(1.08);}
.wt-fab-menu-item .wt-mi-label{background:#fff;padding:5px 12px;border-radius:16px;
  border:1px solid #e7e0ec;font-weight:500;font-size:12px;color:#1d1b20;
  box-shadow:0 1px 3px rgba(0,0,0,.06);}

/* Primary action (main button — larger, neutral idle, purple on hover) */
.wt-fab-menu-item.wt-primary .wt-mi-dot{width:42px;height:42px;
  background:#fff;border:2px solid #cac4d0;}
.wt-fab-menu-item.wt-primary .wt-mi-label{font-weight:600;color:#1d1b20;}
.wt-fab-menu-item.wt-primary:hover .wt-mi-dot{background:#eaddff;border-color:#6750a4;}
.wt-fab-menu-item.wt-primary:hover .wt-mi-dot svg{stroke:#6750a4;}
.wt-fab-menu-item.wt-primary:hover .wt-mi-label{background:#eaddff;color:#6750a4;}
.wt-fab-menu-item.wt-primary.wt-stop .wt-mi-dot{background:#f9dedc;border-color:#b3261e;}
.wt-fab-menu-item.wt-primary.wt-stop .wt-mi-label{color:#b3261e;font-weight:600;}
.wt-fab-menu-item.wt-primary.wt-stop:hover .wt-mi-dot{background:#b3261e;border-color:#b3261e;}
.wt-fab-menu-item.wt-primary.wt-stop:hover .wt-mi-dot svg{stroke:#fff;}
.wt-fab-menu-item.wt-primary.wt-stop:hover .wt-mi-label{background:#b3261e;color:#fff;}

.wt-fab-menu-item.wt-active-mode .wt-mi-dot{background:#eaddff;border-color:#6750a4;}

/* Focus-visible */
#wt-fab:focus-visible{outline:2px solid #6750a4;outline-offset:3px;}
`;

  // Logo-matching SVG: white "T" + reticle ring + four corner brackets
  const SVG_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
  <path class="wt-fab-bracket" d="M2 7V2h5" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path class="wt-fab-bracket" d="M17 2h5v5" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path class="wt-fab-bracket" d="M2 17v5h5" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path class="wt-fab-bracket" d="M17 22h5v-5" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  <circle class="wt-fab-ring" cx="12" cy="12" r="6.5" stroke-width="1.5"/>
  <path class="wt-fab-t" d="M8.5 8.5h7v1.4h-2.8v5.6h-1.4V9.9H8.5z"/>
</svg>`;

  // SVG line icons for radial menu
  const MENU_ICONS = {
    translate: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#49454f" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/>
    <path d="M2 5h12"/><path d="M7 2h1"/>
    <path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/>
  </svg>`,
    panel: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#49454f" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <line x1="9" y1="3" x2="9" y2="21"/>
  </svg>`,
    download: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#49454f" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>`,
    settings: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#49454f" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
    <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
    <line x1="1" y1="14" x2="7" y2="14"/>
    <line x1="9" y1="8" x2="15" y2="8"/>
    <line x1="17" y1="16" x2="23" y2="16"/>
  </svg>`,
    stop: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b3261e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>`,
    retranslate: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#49454f" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="23 4 23 10 17 10"/>
    <polyline points="1 20 1 14 7 14"/>
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
  </svg>`,
    clear: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#49454f" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
  </svg>`,
  };

  /**
   * Build the menu item list based on current state and mode.
   * @param {string} state - 'IDLE' | 'TRANSLATING' | 'PAUSED' | 'ERROR'
   * @param {string} mode - 'inline' | 'panel'
   * @returns {{icon:string, i18nKey:string, cls:string, primary:boolean}[]}
   */
  function getMenuItems(state, mode) {
    switch (state) {
      case 'IDLE': {
        const otherMode = mode === 'panel' ? 'inline' : 'panel';
        const otherLabel = mode === 'panel' ? 'fab.translate_inline' : 'fab.translate_panel';
        return [
          { icon: MENU_ICONS.translate, i18nKey: 'fab.translate', cls: 'wt-translate', primary: true },
          { icon: MENU_ICONS.panel, i18nKey: otherLabel, cls: `wt-switch-${otherMode}`, primary: false },
          { icon: MENU_ICONS.download, i18nKey: 'fab.download', cls: 'wt-download', primary: false },
          { icon: MENU_ICONS.settings, i18nKey: 'fab.settings', cls: 'wt-settings', primary: false },
        ];
      }
      case 'TRANSLATING':
      case 'SCANNING': {
        const otherMode = mode === 'panel' ? 'inline' : 'panel';
        const switchLabel = mode === 'panel' ? 'fab.switch_to_inline' : 'fab.switch_to_panel';
        const switchIcon = mode === 'panel' ? MENU_ICONS.translate : MENU_ICONS.panel;
        return [
          { icon: MENU_ICONS.stop, i18nKey: 'fab.stop', cls: 'wt-stop', primary: true },
          { icon: switchIcon, i18nKey: switchLabel, cls: `wt-switch-${otherMode}`, primary: false },
          { icon: MENU_ICONS.download, i18nKey: 'fab.download', cls: 'wt-download', primary: false },
          { icon: MENU_ICONS.settings, i18nKey: 'fab.settings', cls: 'wt-settings', primary: false },
        ];
      }
      case 'PAUSED': {
        return [
          { icon: MENU_ICONS.translate, i18nKey: 'fab.translate', cls: 'wt-translate', primary: true },
          { icon: MENU_ICONS.retranslate, i18nKey: 'fab.retranslate', cls: 'wt-retranslate', primary: false },
          { icon: MENU_ICONS.clear, i18nKey: 'fab.clear', cls: 'wt-clear', primary: false },
          { icon: MENU_ICONS.download, i18nKey: 'fab.download', cls: 'wt-download', primary: false },
          { icon: MENU_ICONS.settings, i18nKey: 'fab.settings', cls: 'wt-settings', primary: false },
        ];
      }
      case 'ERROR':
      default: {
        return [
          { icon: MENU_ICONS.translate, i18nKey: 'fab.translate', cls: 'wt-translate', primary: true },
          { icon: MENU_ICONS.clear, i18nKey: 'fab.clear', cls: 'wt-clear', primary: false },
          { icon: MENU_ICONS.download, i18nKey: 'fab.download', cls: 'wt-download', primary: false },
          { icon: MENU_ICONS.settings, i18nKey: 'fab.settings', cls: 'wt-settings', primary: false },
        ];
      }
    }
  }

  class FabComponent {
    constructor(opts = {}) {
      this.onTranslate   = opts.onTranslate   ?? (() => {});
      this.onPanel        = opts.onPanel        ?? (() => {});
      this.onDownload     = opts.onDownload     ?? (() => {});
      this.onSettings     = opts.onSettings     ?? (() => {});
      this.onStop         = opts.onStop         ?? (() => {});
      this.onSwitchMode   = opts.onSwitchMode   ?? (() => {});
      this.onRetranslate  = opts.onRetranslate  ?? (() => {});
      this.onClear        = opts.onClear        ?? (() => {});

      this.el = null; this.menuEl = null; this._badgeEl = null;
      this._open = false; this._dragging = false; this._longTimer = null;
      this._pos = { x: 0, y: 0 }; this._offset = { x: 0, y: 0 }; this._start = { x: 0, y: 0 };
      this._boundMove = this._onMove.bind(this); this._boundUp = this._onUp.bind(this);
      this._labelEls = []; this._menuItems = null;
      this._currentState = 'IDLE'; this._currentMode = 'inline';
    }

    mount() {
      this._pos = { x: innerWidth - SIZE - 24, y: innerHeight - SIZE - 32 };
      this._injectStyles();
      this._createFab();
      this._createMenu('IDLE', 'inline');
      document.body.appendChild(this.el);
      document.body.appendChild(this.menuEl);
      this._loadPosition();
      this._listenLangChange();
    }
    dispose() { this.el?.remove(); this.menuEl?.remove(); document.getElementById(STYLE_ID)?.remove(); document.removeEventListener('mousemove', this._boundMove); document.removeEventListener('mouseup', this._boundUp); if (this._storageListener && chrome.storage?.onChanged) chrome.storage.onChanged.removeListener(this._storageListener); }

    /** Re-read i18n labels and update menu text. Call after i18n.init() or language change. */
    updateLabels(t) {
      this._labelEls.forEach((el, i) => {
        const key = el.dataset?.wtI18nKey;
        if (!key) return;
        const text = t(key);
        if (text && text !== key) el.textContent = text;
      });
    }

    highlightMode(mode) {
      this.menuEl?.querySelectorAll('.wt-fab-menu-item').forEach(e => e.classList.remove('wt-active-mode'));
      if (!mode) return;
      const sel = mode === 'panel' ? '.wt-switch-panel' : '.wt-switch-inline';
      this.menuEl?.querySelector(sel)?.classList.add('wt-active-mode');
    }

    setState(s) {
      this.el?.classList.remove('wt-idle', 'wt-active', 'wt-paused', 'wt-error');
      this.el?.classList.add('wt-' + s);
    }

    /** Brief scale pulse to draw user attention, then clean up. */
    pulse() {
      if (!this.el) return;
      this.el.classList.add('wt-pulse');
      this.el.addEventListener('animationend', () => {
        this.el.classList.remove('wt-pulse');
      }, { once: true });
    }

    /** Open the menu, then auto-close after `duration` ms. */
    autoExpand(duration) {
      if (!this._open) this._openMenu();
      clearTimeout(this._autoExpandTimer);
      this._autoExpandTimer = setTimeout(() => {
        if (this._open) this._close();
      }, duration);
    }

    /**
     * Update the badge on the FAB showing current mode ('I' or 'P').
     * @param {string} mode - 'inline' | 'panel'
     */
    setModeBadge(mode) {
      if (!this._badgeEl) return;
      if (mode === 'panel') {
        this._badgeEl.textContent = 'P';
        this._badgeEl.style.display = 'flex';
      } else if (mode === 'inline') {
        this._badgeEl.textContent = 'I';
        this._badgeEl.style.display = 'flex';
      } else {
        this._badgeEl.style.display = 'none';
      }
    }

    /**
     * Rebuild the menu for a new state / mode. The FAB must already be mounted.
     * @param {string} state
     * @param {string} mode
     */
    updateMenu(state, mode) {
      this._currentState = state;
      this._currentMode = mode;

      // Remove old menu items from the menu container (where they actually live)
      if (this._menuContainer) {
        const oldItems = this._menuContainer.querySelectorAll('.wt-fab-menu-item');
        oldItems.forEach(el => el.remove());
      }
      this._labelEls = [];

      // Build new items — append to _menuContainer, NOT to menuEl (backdrop)
      const items = getMenuItems(state, mode);
      if (!this._menuContainer) return;

      const activators = this._buildActivators(items);

      items.forEach((it, i) => {
        const d = document.createElement('div');
        d.className = `wt-fab-menu-item ${it.cls}`;
        if (it.primary) d.classList.add('wt-primary');
        d.innerHTML = `<span class="wt-mi-dot">${it.icon}</span><span class="wt-mi-label" data-wt-i18n-key="${it.i18nKey}">${it.i18nKey}</span>`;
        d.style.opacity = this._open ? '1' : '0';
        d.style.transform = this._open ? 'scale(1)' : 'scale(0.3)';
        d.addEventListener('click', e => { e.stopPropagation(); this._close(); activators[i](); });
        this._menuContainer.appendChild(d);
        this._labelEls.push(d.querySelector('.wt-mi-label'));
      });

      this._menuItems = this._menuContainer.querySelectorAll('.wt-fab-menu-item');

      // Re-position if open
      if (this._open) {
        this._positionMenuItems();
      }
    }

    _buildActivators(items) {
      return items.map(it => {
        switch (it.cls) {
          case 'wt-translate': return this.onTranslate;
          case 'wt-switch-inline': return this.onSwitchMode;
          case 'wt-switch-panel': return this.onSwitchMode;
          case 'wt-stop': return this.onStop;
          case 'wt-retranslate': return this.onRetranslate;
          case 'wt-clear': return this.onClear;
          case 'wt-download': return this.onDownload;
          case 'wt-settings': return this.onSettings;
          default: return () => {};
        }
      });
    }

    // ---- internal ------------------------------------------------------------

    _injectStyles() {
      if (document.getElementById(STYLE_ID)) return;
      const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
    }

    _createFab() {
      const btn = document.createElement('div');
      btn.id = 'wt-fab'; btn.className = 'wt-idle'; btn.tabIndex = 0;
      btn.innerHTML = SVG_ICON;
      btn.title = 'WebTranslate';
      // Mode badge
      const badge = document.createElement('span');
      badge.className = 'wt-mode-badge';
      badge.textContent = 'I';
      btn.appendChild(badge);
      this._badgeEl = badge;
      btn.addEventListener('mousedown', e => this._onDown(e));
      btn.addEventListener('touchstart', e => this._onTouch(e), { passive: false });
      btn.addEventListener('click', e => { if (!this._dragging) { e.stopPropagation(); this._toggle(); } });
      btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggle(); } });
      this.el = btn;
    }

    _createMenu(state, mode) {
      const wrap = document.createElement('div'); wrap.id = 'wt-fab-backdrop';
      const menu = document.createElement('div');
      menu.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;';
      wrap.appendChild(menu);
      wrap.addEventListener('click', () => this._close());
      this.menuEl = wrap; this._menuContainer = menu;
      // Build initial items
      const items = getMenuItems(state, mode);
      const activators = this._buildActivators(items);
      items.forEach((it, i) => {
        const d = document.createElement('div');
        d.className = `wt-fab-menu-item ${it.cls}`;
        if (it.primary) d.classList.add('wt-primary');
        d.innerHTML = `<span class="wt-mi-dot">${it.icon}</span><span class="wt-mi-label" data-wt-i18n-key="${it.i18nKey}">${it.i18nKey}</span>`;
        d.style.opacity = '0'; d.style.transform = 'scale(0.3)';
        d.addEventListener('click', e => { e.stopPropagation(); this._close(); activators[i](); });
        this._menuContainer.appendChild(d);
        this._labelEls.push(d.querySelector('.wt-mi-label'));
      });
      this._menuItems = this._menuContainer.querySelectorAll('.wt-fab-menu-item');
    }

    _positionMenuItems() {
      if (!this._menuItems?.length) return;
      const r = this.el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const N = this._menuItems.length;
      // Dynamic radius: primary buttons get more spacing
      const R = N >= 5 ? 155 : 140;

      this._menuItems.forEach((el, i) => {
        const a = Math.PI + (i - (N - 1) / 2) * (Math.PI / (N + 2));
        el.style.left = (cx + Math.cos(a) * R - 18) + 'px';
        el.style.top  = (cy + Math.sin(a) * R - 18) + 'px';
        el.style.opacity = '1'; el.style.transform = 'scale(1)';
      });
    }

    _toggle() { this._open ? this._close() : this._openMenu(); }
    _openMenu() {
      this._open = true;
      this._positionMenuItems();
      this.menuEl.classList.add('open');
    }
    _close() {
      this._open = false; this.menuEl.classList.remove('open');
      if (this._menuItems) {
        this._menuItems.forEach(e => { e.style.opacity = '0'; e.style.transform = 'scale(0.3)'; });
      }
    }

    _onDown(e) { if (e.button) return; this._startDrag(e.clientX, e.clientY); document.addEventListener('mousemove', this._boundMove); document.addEventListener('mouseup', this._boundUp); }
    _onTouch(e) { if (e.touches.length !== 1) return; e.preventDefault(); this._startDrag(e.touches[0].clientX, e.touches[0].clientY); document.addEventListener('touchend', this._boundUp, { once: true }); }
    _startDrag(cx, cy) { this._dragging = false; this._start = { x: cx, y: cy }; this._offset = { x: cx - this.el.offsetLeft, y: cy - this.el.offsetTop }; this._longTimer = setTimeout(() => { this._dragging = true; }, 180); }
    _onMove(e) { if (!this._dragging) { if (Math.hypot(e.clientX - this._start.x, e.clientY - this._start.y) < 5) return; this._dragging = true; } e.preventDefault(); this._setPos(e.clientX - this._offset.x, e.clientY - this._offset.y); }
    _onUp() { clearTimeout(this._longTimer); document.removeEventListener('mousemove', this._boundMove); document.removeEventListener('mouseup', this._boundUp); if (this._dragging) this._savePosition(); }
    _setPos(x, y) { x = Math.max(0, Math.min(x, innerWidth - SIZE)); y = Math.max(0, Math.min(y, innerHeight - SIZE)); this._pos = { x, y }; this.el.style.left = x + 'px'; this.el.style.top = y + 'px'; }
    async _savePosition() { try { await chrome.storage.local.set({ wt_fab_pos: this._pos }); } catch {} }
    async _loadPosition() { try { const d = await chrome.storage.local.get('wt_fab_pos'); if (d.wt_fab_pos) this._setPos(d.wt_fab_pos.x, d.wt_fab_pos.y); } catch {} }

    /** Listen for language changes in storage and update labels. */
    _listenLangChange() {
      if (!chrome.storage?.onChanged) return;
      this._storageListener = (changes, area) => {
        if (area !== 'local' || !changes.wt_language) return;
        window.dispatchEvent(new CustomEvent('wt-language-changed', { detail: changes.wt_language.newValue }));
      };
      chrome.storage.onChanged.addListener(this._storageListener);
    }
  }

  function extend(destination) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];
      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) destination[key] = source[key];
      }
    }
    return destination;
  }
  function repeat(character, count) {
    return Array(count + 1).join(character);
  }
  function trimLeadingNewlines(string) {
    return string.replace(/^\n*/, '');
  }
  function trimTrailingNewlines(string) {
    // avoid match-at-end regexp bottleneck, see #370
    var indexEnd = string.length;
    while (indexEnd > 0 && string[indexEnd - 1] === '\n') indexEnd--;
    return string.substring(0, indexEnd);
  }
  function trimNewlines(string) {
    return trimTrailingNewlines(trimLeadingNewlines(string));
  }
  var blockElements = ['ADDRESS', 'ARTICLE', 'ASIDE', 'AUDIO', 'BLOCKQUOTE', 'BODY', 'CANVAS', 'CENTER', 'DD', 'DIR', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'FRAMESET', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HGROUP', 'HR', 'HTML', 'ISINDEX', 'LI', 'MAIN', 'MENU', 'NAV', 'NOFRAMES', 'NOSCRIPT', 'OL', 'OUTPUT', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL'];
  function isBlock(node) {
    return is(node, blockElements);
  }
  var voidElements = ['AREA', 'BASE', 'BR', 'COL', 'COMMAND', 'EMBED', 'HR', 'IMG', 'INPUT', 'KEYGEN', 'LINK', 'META', 'PARAM', 'SOURCE', 'TRACK', 'WBR'];
  function isVoid(node) {
    return is(node, voidElements);
  }
  function hasVoid(node) {
    return has(node, voidElements);
  }
  var meaningfulWhenBlankElements = ['A', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TH', 'TD', 'IFRAME', 'SCRIPT', 'AUDIO', 'VIDEO'];
  function isMeaningfulWhenBlank(node) {
    return is(node, meaningfulWhenBlankElements);
  }
  function hasMeaningfulWhenBlank(node) {
    return has(node, meaningfulWhenBlankElements);
  }
  function is(node, tagNames) {
    return tagNames.indexOf(node.nodeName) >= 0;
  }
  function has(node, tagNames) {
    return node.getElementsByTagName && tagNames.some(function (tagName) {
      return node.getElementsByTagName(tagName).length;
    });
  }
  var markdownEscapes = [[/\\/g, '\\\\'], [/\*/g, '\\*'], [/^-/g, '\\-'], [/^\+ /g, '\\+ '], [/^(=+)/g, '\\$1'], [/^(#{1,6}) /g, '\\$1 '], [/`/g, '\\`'], [/^~~~/g, '\\~~~'], [/\[/g, '\\['], [/\]/g, '\\]'], [/^>/g, '\\>'], [/_/g, '\\_'], [/^(\d+)\. /g, '$1\\. ']];
  function escapeMarkdown(string) {
    return markdownEscapes.reduce(function (accumulator, escape) {
      return accumulator.replace(escape[0], escape[1]);
    }, string);
  }

  var rules = {};
  rules.paragraph = {
    filter: 'p',
    replacement: function (content) {
      return '\n\n' + content + '\n\n';
    }
  };
  rules.lineBreak = {
    filter: 'br',
    replacement: function (content, node, options) {
      return options.br + '\n';
    }
  };
  rules.heading = {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: function (content, node, options) {
      var hLevel = Number(node.nodeName.charAt(1));
      if (options.headingStyle === 'setext' && hLevel < 3) {
        var underline = repeat(hLevel === 1 ? '=' : '-', content.length);
        return '\n\n' + content + '\n' + underline + '\n\n';
      } else {
        return '\n\n' + repeat('#', hLevel) + ' ' + content + '\n\n';
      }
    }
  };
  rules.blockquote = {
    filter: 'blockquote',
    replacement: function (content) {
      content = trimNewlines(content).replace(/^/gm, '> ');
      return '\n\n' + content + '\n\n';
    }
  };
  rules.list = {
    filter: ['ul', 'ol'],
    replacement: function (content, node) {
      var parent = node.parentNode;
      if (parent.nodeName === 'LI' && parent.lastElementChild === node) {
        return '\n' + content;
      } else {
        return '\n\n' + content + '\n\n';
      }
    }
  };
  rules.listItem = {
    filter: 'li',
    replacement: function (content, node, options) {
      var prefix = options.bulletListMarker + '   ';
      var parent = node.parentNode;
      if (parent.nodeName === 'OL') {
        var start = parent.getAttribute('start');
        var index = Array.prototype.indexOf.call(parent.children, node);
        prefix = (start ? Number(start) + index : index + 1) + '.  ';
      }
      var isParagraph = /\n$/.test(content);
      content = trimNewlines(content) + (isParagraph ? '\n' : '');
      content = content.replace(/\n/gm, '\n' + ' '.repeat(prefix.length)); // indent
      return prefix + content + (node.nextSibling ? '\n' : '');
    }
  };
  rules.indentedCodeBlock = {
    filter: function (node, options) {
      return options.codeBlockStyle === 'indented' && node.nodeName === 'PRE' && node.firstChild && node.firstChild.nodeName === 'CODE';
    },
    replacement: function (content, node, options) {
      return '\n\n    ' + node.firstChild.textContent.replace(/\n/g, '\n    ') + '\n\n';
    }
  };
  rules.fencedCodeBlock = {
    filter: function (node, options) {
      return options.codeBlockStyle === 'fenced' && node.nodeName === 'PRE' && node.firstChild && node.firstChild.nodeName === 'CODE';
    },
    replacement: function (content, node, options) {
      var className = node.firstChild.getAttribute('class') || '';
      var language = (className.match(/language-(\S+)/) || [null, ''])[1];
      var code = node.firstChild.textContent;
      var fenceChar = options.fence.charAt(0);
      var fenceSize = 3;
      var fenceInCodeRegex = new RegExp('^' + fenceChar + '{3,}', 'gm');
      var match;
      while (match = fenceInCodeRegex.exec(code)) {
        if (match[0].length >= fenceSize) {
          fenceSize = match[0].length + 1;
        }
      }
      var fence = repeat(fenceChar, fenceSize);
      return '\n\n' + fence + language + '\n' + code.replace(/\n$/, '') + '\n' + fence + '\n\n';
    }
  };
  rules.horizontalRule = {
    filter: 'hr',
    replacement: function (content, node, options) {
      return '\n\n' + options.hr + '\n\n';
    }
  };
  rules.inlineLink = {
    filter: function (node, options) {
      return options.linkStyle === 'inlined' && node.nodeName === 'A' && node.getAttribute('href');
    },
    replacement: function (content, node) {
      var href = escapeLinkDestination(node.getAttribute('href'));
      var title = escapeLinkTitle(cleanAttribute(node.getAttribute('title')));
      var titlePart = title ? ' "' + title + '"' : '';
      return '[' + content + '](' + href + titlePart + ')';
    }
  };
  rules.referenceLink = {
    filter: function (node, options) {
      return options.linkStyle === 'referenced' && node.nodeName === 'A' && node.getAttribute('href');
    },
    replacement: function (content, node, options) {
      var href = escapeLinkDestination(node.getAttribute('href'));
      var title = cleanAttribute(node.getAttribute('title'));
      if (title) title = ' "' + escapeLinkTitle(title) + '"';
      var replacement;
      var reference;
      switch (options.linkReferenceStyle) {
        case 'collapsed':
          replacement = '[' + content + '][]';
          reference = '[' + content + ']: ' + href + title;
          break;
        case 'shortcut':
          replacement = '[' + content + ']';
          reference = '[' + content + ']: ' + href + title;
          break;
        default:
          var id = this.references.length + 1;
          replacement = '[' + content + '][' + id + ']';
          reference = '[' + id + ']: ' + href + title;
      }
      this.references.push(reference);
      return replacement;
    },
    references: [],
    append: function (options) {
      var references = '';
      if (this.references.length) {
        references = '\n\n' + this.references.join('\n') + '\n\n';
        this.references = []; // Reset references
      }
      return references;
    }
  };
  rules.emphasis = {
    filter: ['em', 'i'],
    replacement: function (content, node, options) {
      if (!content.trim()) return '';
      return options.emDelimiter + content + options.emDelimiter;
    }
  };
  rules.strong = {
    filter: ['strong', 'b'],
    replacement: function (content, node, options) {
      if (!content.trim()) return '';
      return options.strongDelimiter + content + options.strongDelimiter;
    }
  };
  rules.code = {
    filter: function (node) {
      var hasSiblings = node.previousSibling || node.nextSibling;
      var isCodeBlock = node.parentNode.nodeName === 'PRE' && !hasSiblings;
      return node.nodeName === 'CODE' && !isCodeBlock;
    },
    replacement: function (content) {
      if (!content) return '';
      content = content.replace(/\r?\n|\r/g, ' ');
      var extraSpace = /^`|^ .*?[^ ].* $|`$/.test(content) ? ' ' : '';
      var delimiter = '`';
      var matches = content.match(/`+/gm) || [];
      while (matches.indexOf(delimiter) !== -1) delimiter = delimiter + '`';
      return delimiter + extraSpace + content + extraSpace + delimiter;
    }
  };
  rules.image = {
    filter: 'img',
    replacement: function (content, node) {
      var alt = escapeMarkdown(cleanAttribute(node.getAttribute('alt')));
      var src = escapeLinkDestination(node.getAttribute('src') || '');
      var title = cleanAttribute(node.getAttribute('title'));
      var titlePart = title ? ' "' + escapeLinkTitle(title) + '"' : '';
      return src ? '![' + alt + ']' + '(' + src + titlePart + ')' : '';
    }
  };
  function cleanAttribute(attribute) {
    return attribute ? attribute.replace(/(\n+\s*)+/g, '\n') : '';
  }
  function escapeLinkDestination(destination) {
    var escaped = destination.replace(/([<>()])/g, '\\$1');
    return escaped.indexOf(' ') >= 0 ? '<' + escaped + '>' : escaped;
  }
  function escapeLinkTitle(title) {
    return title.replace(/"/g, '\\"');
  }

  /**
   * Manages a collection of rules used to convert HTML to Markdown
   */

  function Rules(options) {
    this.options = options;
    this._keep = [];
    this._remove = [];
    this.blankRule = {
      replacement: options.blankReplacement
    };
    this.keepReplacement = options.keepReplacement;
    this.defaultRule = {
      replacement: options.defaultReplacement
    };
    this.array = [];
    for (var key in options.rules) this.array.push(options.rules[key]);
  }
  Rules.prototype = {
    add: function (key, rule) {
      this.array.unshift(rule);
    },
    keep: function (filter) {
      this._keep.unshift({
        filter: filter,
        replacement: this.keepReplacement
      });
    },
    remove: function (filter) {
      this._remove.unshift({
        filter: filter,
        replacement: function () {
          return '';
        }
      });
    },
    forNode: function (node) {
      if (node.isBlank) return this.blankRule;
      var rule;
      if (rule = findRule(this.array, node, this.options)) return rule;
      if (rule = findRule(this._keep, node, this.options)) return rule;
      if (rule = findRule(this._remove, node, this.options)) return rule;
      return this.defaultRule;
    },
    forEach: function (fn) {
      for (var i = 0; i < this.array.length; i++) fn(this.array[i], i);
    }
  };
  function findRule(rules, node, options) {
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (filterValue(rule, node, options)) return rule;
    }
    return undefined;
  }
  function filterValue(rule, node, options) {
    var filter = rule.filter;
    if (typeof filter === 'string') {
      if (filter === node.nodeName.toLowerCase()) return true;
    } else if (Array.isArray(filter)) {
      if (filter.indexOf(node.nodeName.toLowerCase()) > -1) return true;
    } else if (typeof filter === 'function') {
      if (filter.call(rule, node, options)) return true;
    } else {
      throw new TypeError('`filter` needs to be a string, array, or function');
    }
  }

  /**
   * The collapseWhitespace function is adapted from collapse-whitespace
   * by Luc Thevenard.
   *
   * The MIT License (MIT)
   *
   * Copyright (c) 2014 Luc Thevenard <lucthevenard@gmail.com>
   *
   * Permission is hereby granted, free of charge, to any person obtaining a copy
   * of this software and associated documentation files (the "Software"), to deal
   * in the Software without restriction, including without limitation the rights
   * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   * copies of the Software, and to permit persons to whom the Software is
   * furnished to do so, subject to the following conditions:
   *
   * The above copyright notice and this permission notice shall be included in
   * all copies or substantial portions of the Software.
   *
   * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
   * THE SOFTWARE.
   */

  /**
   * collapseWhitespace(options) removes extraneous whitespace from an the given element.
   *
   * @param {Object} options
   */
  function collapseWhitespace(options) {
    var element = options.element;
    var isBlock = options.isBlock;
    var isVoid = options.isVoid;
    var isPre = options.isPre || function (node) {
      return node.nodeName === 'PRE';
    };
    if (!element.firstChild || isPre(element)) return;
    var prevText = null;
    var keepLeadingWs = false;
    var prev = null;
    var node = next(prev, element, isPre);
    while (node !== element) {
      if (node.nodeType === 3 || node.nodeType === 4) {
        // Node.TEXT_NODE or Node.CDATA_SECTION_NODE
        var text = node.data.replace(/[ \r\n\t]+/g, ' ');
        if ((!prevText || / $/.test(prevText.data)) && !keepLeadingWs && text[0] === ' ') {
          text = text.substr(1);
        }

        // `text` might be empty at this point.
        if (!text) {
          node = remove(node);
          continue;
        }
        node.data = text;
        prevText = node;
      } else if (node.nodeType === 1) {
        // Node.ELEMENT_NODE
        if (isBlock(node) || node.nodeName === 'BR') {
          if (prevText) {
            prevText.data = prevText.data.replace(/ $/, '');
          }
          prevText = null;
          keepLeadingWs = false;
        } else if (isVoid(node) || isPre(node)) {
          // Avoid trimming space around non-block, non-BR void elements and inline PRE.
          prevText = null;
          keepLeadingWs = true;
        } else if (prevText) {
          // Drop protection if set previously.
          keepLeadingWs = false;
        }
      } else {
        node = remove(node);
        continue;
      }
      var nextNode = next(prev, node, isPre);
      prev = node;
      node = nextNode;
    }
    if (prevText) {
      prevText.data = prevText.data.replace(/ $/, '');
      if (!prevText.data) {
        remove(prevText);
      }
    }
  }

  /**
   * remove(node) removes the given node from the DOM and returns the
   * next node in the sequence.
   *
   * @param {Node} node
   * @return {Node} node
   */
  function remove(node) {
    var next = node.nextSibling || node.parentNode;
    node.parentNode.removeChild(node);
    return next;
  }

  /**
   * next(prev, current, isPre) returns the next node in the sequence, given the
   * current and previous nodes.
   *
   * @param {Node} prev
   * @param {Node} current
   * @param {Function} isPre
   * @return {Node}
   */
  function next(prev, current, isPre) {
    if (prev && prev.parentNode === current || isPre(current)) {
      return current.nextSibling || current.parentNode;
    }
    return current.firstChild || current.nextSibling || current.parentNode;
  }

  /*
   * Set up window for Node.js
   */

  var root = typeof window !== 'undefined' ? window : {};

  /*
   * Parsing HTML strings
   */

  function canParseHTMLNatively() {
    var Parser = root.DOMParser;
    var canParse = false;

    // Adapted from https://gist.github.com/1129031
    // Firefox/Opera/IE throw errors on unsupported types
    try {
      // WebKit returns null on unsupported types
      if (new Parser().parseFromString('', 'text/html')) {
        canParse = true;
      }
    } catch (e) {}
    return canParse;
  }
  function createHTMLParser() {
    var Parser = function () {};
    {
      if (shouldUseActiveX()) {
        Parser.prototype.parseFromString = function (string) {
          var doc = new window.ActiveXObject('htmlfile');
          doc.designMode = 'on'; // disable on-page scripts
          doc.open();
          doc.write(string);
          doc.close();
          return doc;
        };
      } else {
        Parser.prototype.parseFromString = function (string) {
          var doc = document.implementation.createHTMLDocument('');
          doc.open();
          doc.write(string);
          doc.close();
          return doc;
        };
      }
    }
    return Parser;
  }
  function shouldUseActiveX() {
    var useActiveX = false;
    try {
      document.implementation.createHTMLDocument('').open();
    } catch (e) {
      if (root.ActiveXObject) useActiveX = true;
    }
    return useActiveX;
  }
  var HTMLParser = canParseHTMLNatively() ? root.DOMParser : createHTMLParser();

  function RootNode(input, options) {
    var root;
    if (typeof input === 'string') {
      var doc = htmlParser().parseFromString(
      // DOM parsers arrange elements in the <head> and <body>.
      // Wrapping in a custom element ensures elements are reliably arranged in
      // a single element.
      '<x-turndown id="turndown-root">' + input + '</x-turndown>', 'text/html');
      root = doc.getElementById('turndown-root');
    } else {
      root = input.cloneNode(true);
    }
    collapseWhitespace({
      element: root,
      isBlock: isBlock,
      isVoid: isVoid,
      isPre: options.preformattedCode ? isPreOrCode : null
    });
    return root;
  }
  var _htmlParser;
  function htmlParser() {
    _htmlParser = _htmlParser || new HTMLParser();
    return _htmlParser;
  }
  function isPreOrCode(node) {
    return node.nodeName === 'PRE' || node.nodeName === 'CODE';
  }

  function Node$1(node, options) {
    node.isBlock = isBlock(node);
    node.isCode = node.nodeName === 'CODE' || node.parentNode.isCode;
    node.isBlank = isBlank(node);
    node.flankingWhitespace = flankingWhitespace(node, options);
    return node;
  }
  function isBlank(node) {
    return !isVoid(node) && !isMeaningfulWhenBlank(node) && /^\s*$/i.test(node.textContent) && !hasVoid(node) && !hasMeaningfulWhenBlank(node);
  }
  function flankingWhitespace(node, options) {
    if (node.isBlock || options.preformattedCode && node.isCode) {
      return {
        leading: '',
        trailing: ''
      };
    }
    var edges = edgeWhitespace(node.textContent);

    // abandon leading ASCII WS if left-flanked by ASCII WS
    if (edges.leadingAscii && isFlankedByWhitespace('left', node, options)) {
      edges.leading = edges.leadingNonAscii;
    }

    // abandon trailing ASCII WS if right-flanked by ASCII WS
    if (edges.trailingAscii && isFlankedByWhitespace('right', node, options)) {
      edges.trailing = edges.trailingNonAscii;
    }
    return {
      leading: edges.leading,
      trailing: edges.trailing
    };
  }
  function edgeWhitespace(string) {
    var m = string.match(/^(([ \t\r\n]*)(\s*))(?:(?=\S)[\s\S]*\S)?((\s*?)([ \t\r\n]*))$/);
    return {
      leading: m[1],
      // whole string for whitespace-only strings
      leadingAscii: m[2],
      leadingNonAscii: m[3],
      trailing: m[4],
      // empty for whitespace-only strings
      trailingNonAscii: m[5],
      trailingAscii: m[6]
    };
  }
  function isFlankedByWhitespace(side, node, options) {
    var sibling;
    var regExp;
    var isFlanked;
    if (side === 'left') {
      sibling = node.previousSibling;
      regExp = / $/;
    } else {
      sibling = node.nextSibling;
      regExp = /^ /;
    }
    if (sibling) {
      if (sibling.nodeType === 3) {
        isFlanked = regExp.test(sibling.nodeValue);
      } else if (options.preformattedCode && sibling.nodeName === 'CODE') {
        isFlanked = false;
      } else if (sibling.nodeType === 1 && !isBlock(sibling)) {
        isFlanked = regExp.test(sibling.textContent);
      }
    }
    return isFlanked;
  }

  var reduce = Array.prototype.reduce;
  function TurndownService(options) {
    if (!(this instanceof TurndownService)) return new TurndownService(options);
    var defaults = {
      rules: rules,
      headingStyle: 'setext',
      hr: '* * *',
      bulletListMarker: '*',
      codeBlockStyle: 'indented',
      fence: '```',
      emDelimiter: '_',
      strongDelimiter: '**',
      linkStyle: 'inlined',
      linkReferenceStyle: 'full',
      br: '  ',
      preformattedCode: false,
      blankReplacement: function (content, node) {
        return node.isBlock ? '\n\n' : '';
      },
      keepReplacement: function (content, node) {
        return node.isBlock ? '\n\n' + node.outerHTML + '\n\n' : node.outerHTML;
      },
      defaultReplacement: function (content, node) {
        return node.isBlock ? '\n\n' + content + '\n\n' : content;
      }
    };
    this.options = extend({}, defaults, options);
    this.rules = new Rules(this.options);
  }
  TurndownService.prototype = {
    /**
     * The entry point for converting a string or DOM node to Markdown
     * @public
     * @param {String|HTMLElement} input The string or DOM node to convert
     * @returns A Markdown representation of the input
     * @type String
     */

    turndown: function (input) {
      if (!canConvert(input)) {
        throw new TypeError(input + ' is not a string, or an element/document/fragment node.');
      }
      if (input === '') return '';
      var output = process.call(this, new RootNode(input, this.options));
      return postProcess.call(this, output);
    },
    /**
     * Add one or more plugins
     * @public
     * @param {Function|Array} plugin The plugin or array of plugins to add
     * @returns The Turndown instance for chaining
     * @type Object
     */

    use: function (plugin) {
      if (Array.isArray(plugin)) {
        for (var i = 0; i < plugin.length; i++) this.use(plugin[i]);
      } else if (typeof plugin === 'function') {
        plugin(this);
      } else {
        throw new TypeError('plugin must be a Function or an Array of Functions');
      }
      return this;
    },
    /**
     * Adds a rule
     * @public
     * @param {String} key The unique key of the rule
     * @param {Object} rule The rule
     * @returns The Turndown instance for chaining
     * @type Object
     */

    addRule: function (key, rule) {
      this.rules.add(key, rule);
      return this;
    },
    /**
     * Keep a node (as HTML) that matches the filter
     * @public
     * @param {String|Array|Function} filter The unique key of the rule
     * @returns The Turndown instance for chaining
     * @type Object
     */

    keep: function (filter) {
      this.rules.keep(filter);
      return this;
    },
    /**
     * Remove a node that matches the filter
     * @public
     * @param {String|Array|Function} filter The unique key of the rule
     * @returns The Turndown instance for chaining
     * @type Object
     */

    remove: function (filter) {
      this.rules.remove(filter);
      return this;
    },
    /**
     * Escapes Markdown syntax
     * @public
     * @param {String} string The string to escape
     * @returns A string with Markdown syntax escaped
     * @type String
     */

    escape: function (string) {
      return escapeMarkdown(string);
    }
  };

  /**
   * Reduces a DOM node down to its Markdown string equivalent
   * @private
   * @param {HTMLElement} parentNode The node to convert
   * @returns A Markdown representation of the node
   * @type String
   */

  function process(parentNode) {
    var self = this;
    return reduce.call(parentNode.childNodes, function (output, node) {
      node = new Node$1(node, self.options);
      var replacement = '';
      if (node.nodeType === 3) {
        replacement = node.isCode ? node.nodeValue : self.escape(node.nodeValue);
      } else if (node.nodeType === 1) {
        replacement = replacementForNode.call(self, node);
      }
      return join(output, replacement);
    }, '');
  }

  /**
   * Appends strings as each rule requires and trims the output
   * @private
   * @param {String} output The conversion output
   * @returns A trimmed version of the ouput
   * @type String
   */

  function postProcess(output) {
    var self = this;
    this.rules.forEach(function (rule) {
      if (typeof rule.append === 'function') {
        output = join(output, rule.append(self.options));
      }
    });
    return output.replace(/^[\t\r\n]+/, '').replace(/[\t\r\n\s]+$/, '');
  }

  /**
   * Converts an element node to its Markdown equivalent
   * @private
   * @param {HTMLElement} node The node to convert
   * @returns A Markdown representation of the node
   * @type String
   */

  function replacementForNode(node) {
    var rule = this.rules.forNode(node);
    var content = process.call(this, node);
    var whitespace = node.flankingWhitespace;
    if (whitespace.leading || whitespace.trailing) content = content.trim();
    return whitespace.leading + rule.replacement(content, node, this.options) + whitespace.trailing;
  }

  /**
   * Joins replacement to the current output with appropriate number of new lines
   * @private
   * @param {String} output The current conversion output
   * @param {String} replacement The string to append to the output
   * @returns Joined output
   * @type String
   */

  function join(output, replacement) {
    var s1 = trimTrailingNewlines(output);
    var s2 = trimLeadingNewlines(replacement);
    var nls = Math.max(output.length - s1.length, replacement.length - s2.length);
    var separator = '\n\n'.substring(0, nls);
    return s1 + separator + s2;
  }

  /**
   * Determines whether an input can be converted
   * @private
   * @param {String|HTMLElement} input Describe this parameter
   * @returns Describe what it returns
   * @type String|Object|Array|Boolean|Number
   */

  function canConvert(input) {
    return input != null && (typeof input === 'string' || input.nodeType && (input.nodeType === 1 || input.nodeType === 9 || input.nodeType === 11));
  }

  /**
   * DownloadTrigger - Generates Markdown from page content and collects image URLs,
   * then sends the payload to the Service Worker for ZIP packaging.
   */


  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  /**
   * Generate Markdown from the current page content.
   * Prefer translated content where available.
   * @returns {string}
   */
  function generateMarkdown() {
    const root = document.querySelector('article, main, .content, .post, .entry-content, [role="main"]')
      || document.body;

    // Clone to avoid mutating live DOM
    const clone = root.cloneNode(true);

    // Replace inline translations with their text for cleaner Markdown
    clone.querySelectorAll('.wt-inline-block').forEach((block) => {
      const body = block.querySelector('.wt-inline-body');
      if (body) {
        const span = document.createElement('span');
        span.textContent = ` [${body.textContent}] `;
        block.replaceWith(span);
      } else {
        block.remove();
      }
    });

    return turndown.turndown(clone.innerHTML);
  }

  /**
   * Collect all image URLs inside the content area.
   * @returns {string[]}
   */
  function collectImageUrls() {
    const root = document.querySelector('article, main, .content, .post, .entry-content, [role="main"]')
      || document.body;

    const images = root.querySelectorAll('img');
    const urls = [];

    for (const img of images) {
      const src = img.src;
      if (src && !src.startsWith('data:')) {
        urls.push(src);
      }
    }

    return [...new Set(urls)]; // deduplicate
  }

  /**
   * Trigger a page download via Service Worker.
   * @param {string} pageTitle
   * @param {string} markdown
   * @param {string[]} imageUrls
   * @returns {Promise<{downloadId: string}>}
   */
  async function triggerDownload(pageTitle, markdown, imageUrls) {
    const downloadId = `dl_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    await chrome.runtime.sendMessage({
      type: 'DOWNLOAD',
      tabId: 0, // SW will infer from sender if needed
      downloadId,
      pageTitle: sanitizeFilename(pageTitle),
      markdown,
      imageUrls,
    });

    return { downloadId };
  }

  /**
   * Sanitize a string for use as a filename.
   * @param {string} name
   * @returns {string}
   */
  function sanitizeFilename(name) {
    return name
      .replace(/[\\/:*?"<>>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  /**
   * Content Script entry for WebTranslate
   * Lifecycle:
   *   1. Detect tabId
   *   2. Initialize StateManager, BatchCollector, CacheManager, Renderers
   *   3. Inject FAB (Floating Action Button)
   *   4. Listen for SW messages and user interactions
   */


  // ------------------------------------------------------------------
  // Global instances
  // ------------------------------------------------------------------

  let TAB_ID = -1;
  let stateManager;
  let batchCollector;
  let observerManager;
  let cacheManager;
  let concurrencyController;
  let circuitBreaker;
  let fabComponent;
  let inlineRenderer;
  let panelRenderer;
  let currentMode = 'inline'; // 'inline' | 'panel'

  async function init() {
    // --- Phase 1: Mount FAB immediately (synchronous, before any await) ---
    // This ensures the user sees the button even if async steps hang.
    fabComponent = new FabComponent({
      onTranslate: () => {
        const st = stateManager?.get();
        if (st === State.TRANSLATING || st === State.SCANNING) return;
        if (st === State.PAUSED) startTranslation(currentMode);
        else startTranslation(currentMode || 'inline');
      },
      onPanel: () => {
        const st = stateManager?.get();
        // Panel mode re-open: if already translating in panel mode, re-init slots
        // so the panel (which may have been closed-and-reopened) gets fresh slot data.
        if ((st === State.TRANSLATING || st === State.SCANNING) && currentMode === 'panel') {
          panelRenderer?.open().then(opened => {
            if (!opened) return;
            reinitPanelSlots();
          }).catch(() => {});
          return;
        }
        if (st === State.TRANSLATING || st === State.SCANNING) return;
        startTranslation('panel');
      },
      onSwitchMode: () => {
        const to = currentMode === 'panel' ? 'inline' : 'panel';
        switchMode(to);
      },
      onDownload: () => handleDownload(),
      onSettings: () => {
        try { chrome.action?.openPopup?.(); } catch (e) {}
        try { chrome.runtime.sendMessage({ type: MSG.OPEN_PANEL }); } catch {}
      },
      onStop: () => stopTranslation(),
      onRetranslate: () => retranslate(currentMode),
      onClear: () => clearTranslations(),
    });
    fabComponent.mount(); // creates FAB immediately; loads saved position in background

    // --- Phase 2: Async setup (non-blocking for FAB visibility) ---
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_TAB_ID' });
      TAB_ID = res?.tabId ?? -1;
    } catch {
      TAB_ID = -1;
    }

    // Init i18n in background; use English fallback until ready
    init$1().then(() => {
      fabComponent?.updateLabels(t);
    }).catch(() => {});

    // Re-apply FAB labels when language changes
    window.addEventListener('wt-language-changed', async (e) => {
      try {
        await init$1(e.detail);
        fabComponent?.updateLabels(t);
      } catch {}
    });

    stateManager = new StateManager();
    stateManager.onChange((to, from) => {
      updateFabState(to);
      if (to === State.PAUSED && from === State.TRANSLATING) {
        concurrencyController.cancelQueued();
      }
    });

    cacheManager = new CacheManager();
    await cacheManager.load();

    batchCollector = new BatchCollector(
      (batch) => onBatchReady(batch),
      { maxBatchChars: 800, maxBatchItems: 8, debounceMs: 100 }
    );

    observerManager = new ObserverManager(batchCollector);

    concurrencyController = new ConcurrencyController(3);

    circuitBreaker = new CircuitBreaker({
      threshold: 5,
      onOpen: () => {
        console.warn('[WT] Circuit breaker tripped after 5 consecutive failures');
        stateManager.transition(State.PAUSED);
      },
    });

    inlineRenderer = new InlineRenderer();
    panelRenderer = new PanelRenderer(TAB_ID);

    // Listen for SW messages
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === MSG.TRANSLATE_BATCH_RESULT) {
        handleBatchResult(msg);
      }
      if (msg.type === MSG.DOWNLOAD_PROGRESS) {
        updateDownloadProgress(msg);
      }
    });

    // Watch for API config changes — auto-start translation when user
    // saves API settings after a failed attempt.
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !window._wt_pendingTranslate) return;
        if (!changes.apiUrl?.newValue && !changes.apiKey?.newValue && !changes.model?.newValue) return;
        // Check all three are now configured
        chrome.storage.local.get(['apiUrl', 'apiKey', 'model']).then(cfg => {
          if (cfg.apiUrl && cfg.apiKey && cfg.model && window._wt_pendingTranslate) {
            const mode = window._wt_pendingTranslate;
            delete window._wt_pendingTranslate;
            startTranslation(mode);
          }
        }).catch(() => {});
      });
    } catch {}

    console.log(`[WebTranslate] Content script initialized (tab=${TAB_ID})`);
  }

  function updateFabState(to, from) {
    if (!fabComponent) return;
    // Map state-machine states to FAB visual states + rebuild menu context
    switch (to) {
      case State.TRANSLATING:
      case State.SCANNING:
        fabComponent.setState('active');
        fabComponent.setModeBadge(currentMode);
        fabComponent.updateMenu('TRANSLATING', currentMode);
        fabComponent.updateLabels(t);
        break;
      case State.PAUSED:
        fabComponent.setState('paused');
        fabComponent.setModeBadge(null);
        fabComponent.updateMenu('PAUSED', currentMode);
        fabComponent.updateLabels(t);
        // Auto-expand menu so user discovers Clear/Retranslate
        fabComponent.pulse();
        setTimeout(() => fabComponent.autoExpand(3000), 400);
        break;
      case State.ERROR:
        fabComponent.setState('error');
        fabComponent.setModeBadge(null);
        fabComponent.updateMenu('ERROR', currentMode);
        fabComponent.updateLabels(t);
        break;
      default:
        fabComponent.setState('idle');
        fabComponent.setModeBadge(currentMode);
        fabComponent.updateMenu('IDLE', currentMode);
        fabComponent.updateLabels(t);
        break;
    }
  }

  async function handleDownload() {
    fabComponent?.setState('active');
    try {
      const title = document.title || 'page';
      const markdown = generateMarkdown();
      const imageUrls = collectImageUrls();
      await triggerDownload(title, markdown, imageUrls);
    } catch (err) {
      console.error('[WT] Download failed:', err);
      fabComponent?.setState('error');
      setTimeout(() => updateFabState(stateManager.get()), 2000);
    }
  }

  function updateDownloadProgress(msg) {
    if (msg.stage === 'done') {
      setTimeout(() => updateFabState(stateManager.get()), 2000);
    }
  }

  // ------------------------------------------------------------------
  // Batch lifecycle
  // ------------------------------------------------------------------

  // Map of pending batch items (batchId → items array), used when SW
  // pushes results via tabs.sendMessage instead of sendResponse.
  const _pendingBatches = new Map();
  // Set of fingerprints currently awaiting API results — prevents
  // duplicate submissions on rapid scroll.
  const _pendingFingerprints = new Set();
  // Callback for sequential top-down batch processing (set by startTranslation)
  let _onBatchDone = null;

  function onBatchReady(batch) {
    if (stateManager.get() === State.PAUSED) return;

    // Check cache first (L2 dedup)
    const uncached = [];
    for (const item of batch) {
      const cached = cacheManager.get(item.fingerprint);
      if (cached) {
        if (currentMode === 'inline') {
          inlineRenderer.render(item.element, cached, item.id);
        } else {
          panelRenderer.renderBatch([{
            id: item.id, original: item.text, translation: cached,
          }]);
        }
      } else {
        uncached.push(item);
      }
    }

    if (!uncached.length) return;

    // Show spinners for items being sent to API
    if (currentMode === 'inline') {
      for (const it of uncached) inlineRenderer.showPending(it.element, it.id);
    }

    concurrencyController.run(async () => {
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      // Track pending fingerprints to prevent double-submission on fast scroll
      for (const it of uncached) _pendingFingerprints.add(it.fingerprint);
      _pendingBatches.set(batchId, uncached);

      try {
        await chrome.runtime.sendMessage({
          type: MSG.TRANSLATE_BATCH,
          tabId: TAB_ID,
          batchId,
          items: uncached.map((it) => ({
            id: it.id, fingerprint: it.fingerprint, text: it.text, sortOrder: it.sortOrder,
          })),
        });
      } catch (err) {
        console.error('[WT] Batch failed:', err.message);
        circuitBreaker.recordFailure();
        for (const it of uncached) _pendingFingerprints.delete(it.fingerprint);
        _pendingBatches.delete(batchId);
      }
    });
  }

  function handleBatchResult(msg) {
    const { batchId, results, error } = msg;
    const items = _pendingBatches.get(batchId);
    _pendingBatches.delete(batchId);

    // Clean up pending fingerprints
    if (items) for (const it of items) _pendingFingerprints.delete(it.fingerprint);

    if (error || !results) {
      console.error('[WT] Batch result error:', error);
      circuitBreaker?.recordFailure();
      // In Panel mode, mark the corresponding slots as errored so the user
      // sees which paragraphs failed instead of waiting forever.
      if (currentMode === 'panel' && items) {
        panelRenderer.markSlotErrors(items.map(it => it.id));
      }
      return;
    }

    circuitBreaker?.recordSuccess();
    for (const r of results) {
      const original = items?.find((u) => u.id === r.id);
      if (!original) continue;
      cacheManager.set(original.fingerprint, r.translation);
      if (currentMode === 'inline') {
        inlineRenderer.render(original.element, r.translation, original.id);
      } else {
        // Panel mode: send result directly with sortOrder.
        // The panel has pre-created slots from INIT_SLOTS — it fills
        // the matching slot in-place, preserving paragraph order.
        panelRenderer.renderBatch([{
          id: original.id, original: original.text, translation: r.translation,
          sortOrder: original.sortOrder ?? 0,
        }]);
      }
    }
    // Trigger sequential batch processor
    if (_onBatchDone) { const cb = _onBatchDone; _onBatchDone = null; try { cb(); } catch {} }
  }

  // ------------------------------------------------------------------
  // Translation start / stop
  // ------------------------------------------------------------------

  /** Stop translation, clean up all observers & timers, transition to PAUSED. */
  function stopTranslation() {
    batchCollector?.stop();
    observerManager?.stop();
    concurrencyController?.cancelQueued();
    if (window._wtDisposeScroll) { window._wtDisposeScroll.forEach(fn => fn()); window._wtDisposeScroll = []; }
    _pendingFingerprints.clear();
    _pendingBatches.clear();
    _onBatchDone = null;
    chrome.runtime.sendMessage({ type: MSG.STOP_ALL, tabId: TAB_ID || 0 });
    chrome.storage.session.set({ wt_active: false }).catch(() => {});
    // Transition to PAUSED instead of IDLE — keeps translated DOM visible,
    // allows user to Clear, Retranslate, or Resume.
    stateManager?.transition(State.PAUSED);
    fabComponent?.highlightMode(null);
    fabComponent?.setState('paused');
    panelRenderer?.dispose();
  }

  /** Clear all inline translation blocks from DOM, keep cache, go IDLE. */
  function clearTranslations() {
    inlineRenderer?.clearAll(); // also clears wtDone markers
    stateManager?.transition(State.IDLE);
    fabComponent?.setState('idle');
  }

  /** Clear DOM + cache, then restart translation with fresh API calls. */
  function retranslate(mode) {
    inlineRenderer?.clearAll();
    cacheManager?.clear();
    // Clear pending state
    _pendingFingerprints.clear();
    _pendingBatches.clear();
    _onBatchDone = null;
    stateManager?.transition(State.IDLE);
    startTranslation(mode);
  }

  /** Switch from Inline to Panel or vice versa without stopping translation. */
  function switchMode(to) {
    // Clear DOM from the departing mode
    if (currentMode === 'inline' && to === 'panel') {
      inlineRenderer?.clearAll();
    }
    if (currentMode === 'panel' && to === 'inline') {
      panelRenderer?.dispose();
    }

    // Stop active pipeline without flashing IDLE state on FAB.
    // startTranslation() handles the SCANNING→TRANSLATING transition itself
    // and returns early if another batch is already in flight.
    batchCollector?.stop();
    observerManager?.stop();
    concurrencyController?.cancelQueued();
    if (window._wtDisposeScroll) { window._wtDisposeScroll.forEach(fn => fn()); window._wtDisposeScroll = []; }
    _pendingFingerprints.clear();
    _pendingBatches.clear();
    _onBatchDone = null;
    chrome.runtime.sendMessage({ type: MSG.STOP_ALL, tabId: TAB_ID || 0 });

    // Set mode BEFORE startTranslation so it picks up the correct mode
    currentMode = to;
    startTranslation(to);
  }

  async function startTranslation(mode = currentMode) {
    currentMode = mode;

    // Persist active state so translation auto-starts on next visit
    // Use session storage — scoped to this tab/window, won't auto-start in new tabs.
    chrome.storage.session.set({ wt_active: true, wt_autoMode: mode }).catch(() => {});
    fabComponent?.highlightMode(mode);
    // Set active state immediately (belt-and-suspenders)
    fabComponent?.setState('active');

    // If already translating, stop first then restart
    if (stateManager.get() !== State.IDLE) {
      batchCollector?.stop();
      observerManager?.stop();
      concurrencyController?.cancelQueued();
      if (window._wtDisposeScroll) { window._wtDisposeScroll.forEach(fn => fn()); window._wtDisposeScroll = []; }
      chrome.runtime.sendMessage({ type: MSG.STOP_ALL, tabId: TAB_ID || 0 });
      stateManager.transition(State.IDLE);
    }

    if (!stateManager.transition(State.SCANNING)) return;

    // Pre-check: warn if API is not configured
    const config = await chrome.storage.local.get(['apiUrl', 'apiKey', 'model']);
    if (!config.apiUrl || !config.apiKey || !config.model) {
      showConfigToast();
      stateManager.transition(State.IDLE);
      return;
    }

    const paragraphs = extractParagraphs();
    if (!paragraphs.length) {
      console.warn('[WT] No translatable content found');
      stateManager.transition(State.IDLE);
      return;
    }

    // For panel mode, open the side panel first.
    // If the panel cannot be opened (sidePanel permission not granted, or
    // API not available), fall back to inline mode and let the user know.
    if (currentMode === 'panel') {
      const opened = await panelRenderer.open();
      if (!opened) {
        currentMode = 'inline';
        fabComponent?.setModeBadge('inline');
        fabComponent?.updateMenu('IDLE', 'inline');
        fabComponent?.updateLabels(t);
        showPanelUnavailableToast();
      }
    }

    // Build items sorted top-down by DOM position.  Assign a sortOrder
    // so the panel can reconstruct correct paragraph order regardless of
    // concurrent batch completion timing.
    const items = paragraphs.map((el) => {
      const id = generateParagraphId(el);
      const fingerprint = computeFingerprint(el);
      const text = getTranslatableText(el);
      return { id, fingerprint, text, element: el };
    }).sort((a, b) => {
      const pos = a.element.compareDocumentPosition(b.element);
      return (pos & Node.DOCUMENT_POSITION_PRECEDING) ? 1 : -1;
    });
    items.forEach((it, i) => { it.sortOrder = i; });

    batchCollector.start();
    observerManager.start(document.body);

    for (const item of items) {
      batchCollector.observeElement(item.element, {
        id: item.id, fingerprint: item.fingerprint, text: item.text, sortOrder: item.sortOrder,
      });
    }

    // Panel mode: send all slots (with empty translations) so the panel
    // renders placeholders immediately.  Subsequent BATCH_RESULT messages
    // fill individual slots by sortOrder — order is guaranteed by DOM position.
    if (currentMode === 'panel') {
      panelRenderer.initSlots(items.map(it => ({
        id: it.id, original: it.text, sortOrder: it.sortOrder,
      })));
    }

    // Translate top-down, one batch at a time, showing progress bar
    let _totalDone = 0;
    const _total = items.length;

    // Fixed progress bar (top of page, survives SPA DOM recycling)
    const _progressBar = document.createElement('div');
    _progressBar.className = 'wt-progress';
    _progressBar.innerHTML = '<div class="wt-progress-inner"></div><span class="wt-progress-label"></span>';
    Object.assign(_progressBar.style, {
      position:'fixed',top:'0',left:'0',right:'0',height:'4px',zIndex:'2147483646',
      background:'#e5e7eb',pointerEvents:'none',
    });
    const _progressFill = _progressBar.firstChild;
    Object.assign(_progressFill.style, {
      height:'100%',width:'0%',background:'linear-gradient(90deg,#6366f1,#818cf8)',
      transition:'width .35s ease',
    });
    const _progressLabel = _progressBar.lastChild;
    Object.assign(_progressLabel.style, {
      position:'fixed',top:'8px',left:'50%',transform:'translateX(-50%)',
      fontSize:'12px',fontWeight:'600',color:'#6366f1',
      fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif',
    });
    document.body.appendChild(_progressBar);

    const _updateProgress = () => {
      const pct = Math.round((_totalDone / _total) * 100);
      _progressFill.style.width = pct + '%';
      _progressLabel.textContent = pct >= 100 ? '' : `${_totalDone} / ${_total}`;
      if (pct >= 100) {
        setTimeout(() => { _progressBar.remove(); }, 600);
      }
    };

    // Sequential batch processor: sends 8 items at a time, waits for result
    const _processNextBatch = () => {
      if (stateManager.get() !== State.TRANSLATING) return;
      const batch = [];
      for (const it of items) {
        if (it.element.dataset.wtDone || _pendingFingerprints.has(it.fingerprint)) continue;
        const cached = cacheManager?.get(it.fingerprint);
        if (cached) {
          markTranslated(it.element, it.fingerprint);
          if (currentMode === 'inline') {
            inlineRenderer.render(it.element, cached, it.id);
          } else {
            panelRenderer.renderBatch([{ id: it.id, original: it.text, translation: cached }]);
          }
          _totalDone++;
          continue;
        }
        batch.push(it);
        if (batch.length >= 8) break;
      }
      if (!batch.length) { _updateProgress(); _onBatchDone = null; return; }
      _onBatchDone = () => { _updateProgress(); setTimeout(() => _processNextBatch(), 80); };
      onBatchReady(batch);
    };

    // Scroll-driven scanner: re-render cached, submit new batches.
    // In Panel mode this handles progressive-loading pages: new paragraphs
    // get appended as slots, cached ones fill existing slots.
    const _flushVisible = () => {
      if (stateManager.get() !== State.TRANSLATING) return;
      const fresh = extractParagraphs();
      const needs = [];
      const newSlots = [];

      for (const el of fresh) {
        const id = generateParagraphId(el);
        const fp = computeFingerprint(el);
        const rect = el.getBoundingClientRect();
        if (rect.top >= window.innerHeight + 400 || rect.bottom <= -400) continue;
        if (_pendingFingerprints.has(fp)) continue;

        const cached = cacheManager?.get(fp);
        if (cached) {
          if (currentMode === 'inline') {
            const next = el.nextElementSibling;
            if (next?.classList?.contains('wt-inline-block')) continue;
            markTranslated(el, fp);
            inlineRenderer.render(el, cached, id);
          } else {
            // Panel mode: fill cached translation into the matching slot
            panelRenderer.renderBatch([{ id, original: getTranslatableText(el), translation: cached }]);
          }
        } else if (!el.dataset.wtDone) {
          const item = { id, fingerprint: fp, text: getTranslatableText(el), element: el };
          needs.push(item);
          // Collect truly new paragraphs for slot appending
          if (currentMode === 'panel') {
            newSlots.push({ id, original: item.text, sortOrder: items.length + newSlots.length });
          }
        }
      }

      // Panel mode: append slots for newly discovered paragraphs
      if (currentMode === 'panel' && newSlots.length) {
        panelRenderer.appendSlots(newSlots);
      }
      if (needs.length) onBatchReady(needs);
    };

    let _scrollTicking = false;
    const _scrollCheck = () => { _scrollTicking = false; _flushVisible(); };
    const _onScroll = () => {
      if (!_scrollTicking) { _scrollTicking = true; requestAnimationFrame(_scrollCheck); }
    };
    // Start top-down sequential translation
    console.log(`[WT] Extracted ${_total} paragraphs`);
    setTimeout(() => _processNextBatch(), 100);
    window.addEventListener('scroll', _onScroll, { passive: true });
    // Periodic recovery: scan for untranslated visible paragraphs every 3 s.
    // Recovers from missed IntersectionObserver events on fast scroll / SPA.
    const _recoveryTimer = setInterval(() => { _flushVisible(); }, 3000);

    // Clean up scroll listener + recovery timer when translation stops
    const _disposeScroll = () => {
      window.removeEventListener('scroll', _onScroll);
      clearInterval(_recoveryTimer);
    };
    if (!window._wtDisposeScroll) window._wtDisposeScroll = [];
    window._wtDisposeScroll.push(_disposeScroll);

    setTimeout(() => stateManager.transition(State.TRANSLATING), 100);
  }

  // ------------------------------------------------------------------
  // Panel reopen: rebuild slots without restarting translation
  // ------------------------------------------------------------------

  /** Re-extract paragraphs and init panel slots + fill cached results.
   *  Used when the panel is closed and reopened while translation is running. */
  function reinitPanelSlots() {
    const paragraphs = extractParagraphs();
    if (!paragraphs.length) return;

    const items = paragraphs.map((el) => {
      const id = generateParagraphId(el);
      const fp = computeFingerprint(el);
      const text = getTranslatableText(el);
      return { id, fingerprint: fp, text, element: el };
    }).sort((a, b) => {
      const pos = a.element.compareDocumentPosition(b.element);
      return (pos & Node.DOCUMENT_POSITION_PRECEDING) ? 1 : -1;
    });
    items.forEach((it, i) => { it.sortOrder = i; });

    // Re-init slots on the panel
    panelRenderer.initSlots(items.map(it => ({
      id: it.id, original: it.text, sortOrder: it.sortOrder,
    })));

    // Fill cached results immediately
    const cachedBatch = [];
    for (const it of items) {
      const cached = cacheManager?.get(it.fingerprint);
      if (cached) {
        cachedBatch.push({ id: it.id, original: it.text, translation: cached });
      }
    }
    if (cachedBatch.length) {
      panelRenderer.renderBatch(cachedBatch);
    }
  }

  // ------------------------------------------------------------------
  // Resilience: offline detection, SPA routing, graceful shutdown
  // ------------------------------------------------------------------

  function setupResilience() {
    // Offline detection
    window.addEventListener('online', () => {
      console.log('[WT] Network restored');
      if (stateManager.get() === State.PAUSED) {
        stateManager.transition(State.TRANSLATING);
      }
    });

    window.addEventListener('offline', () => {
      console.warn('[WT] Network offline - pausing translation');
      if (stateManager.get() === State.TRANSLATING) {
        stateManager.transition(State.PAUSED);
      }
    });

    // SPA route change detection.
    // When the URL changes without a full page reload (pushState / replaceState /
    // popstate), any active translation refers to the previous page's content.
    // We stop translation to avoid feeding stale DOM into the panel.
    if (window.history) {
      const _onRouteChange = () => {
        if (stateManager.get() !== State.IDLE) {
          console.log('[WT] SPA route change detected — stopping translation');
          clearTranslations();
          stopTranslation();
          chrome.runtime.sendMessage({ type: MSG.STOP_ALL, tabId: TAB_ID }).catch(() => {});
        }
      };

      // Override pushState / replaceState
      const _origPush = window.history.pushState;
      const _origReplace = window.history.replaceState;
      const _wrap = (orig) => function (...args) {
        const result = orig.apply(this, args);
        try { _onRouteChange(); } catch {}
        return result;
      };
      try { window.history.pushState = _wrap(_origPush); } catch {}
      try { window.history.replaceState = _wrap(_origReplace); } catch {}
      window.addEventListener('popstate', _onRouteChange);
    }

    // Graceful stop on page unload
    window.addEventListener('beforeunload', () => {
      batchCollector?.stop();
      observerManager?.stop();
      cacheManager?.dispose();
      fabComponent?.dispose();
      concurrencyController?.cancelQueued();
      panelRenderer?.dispose();
      chrome.runtime.sendMessage({ type: MSG.STOP_ALL, tabId: TAB_ID }).catch(() => {});
    });
  }

  // ------------------------------------------------------------------
  // Bootstrap
  // ------------------------------------------------------------------

  if (!document.documentElement.dataset.wtInitialized) {
    document.documentElement.dataset.wtInitialized = 'true';
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { init().then(setupResilience).then(maybeAutoStart); });
    } else {
      init().then(setupResilience).then(maybeAutoStart);
    }
  }

  /** Inform the user that the side panel is unavailable and we fell back to inline. */
  function showPanelUnavailableToast() {
    if (document.getElementById('wt-toast-panel')) return;
    const toast = document.createElement('div');
    toast.id = 'wt-toast-panel';
    toast.className = 'wt-config-toast';
    toast.innerHTML = `
    <span style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:20px;">ℹ️</span>
      <span style="font-weight:600;font-size:14px;color:#1f2937;">${t('toast.panel_unavailable')}</span>
    </span>
    <span style="color:#6b7280;font-size:13px;margin:4px 0 0 30px;">${t('toast.panel_fallback')}</span>`;
    Object.assign(toast.style, {
      position:'fixed',top:'16px',left:'50%',zIndex:'2147483647',
      display:'flex',flexDirection:'column',padding:'16px 20px',
      background:'#fff',color:'#1f2937',
      fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif',
      borderRadius:'14px',boxShadow:'0 12px 40px rgba(0,0,0,.18)',
      maxWidth:'440px',width:'calc(100vw - 32px)',
      animation:'wt-slide-in .35s cubic-bezier(.34,1.56,.64,1)',
      transform:'translateX(-50%)',
    });
    setTimeout(() => {
      if (toast.parentNode) { toast.style.opacity='0'; toast.style.transition='opacity .3s'; setTimeout(()=>toast.remove(),300); }
    }, 5000);
    const styleId = 'wt-toast-kf';
    if (!document.getElementById(styleId)) {
      const s = document.createElement('style'); s.id = styleId;
      s.textContent = '@keyframes wt-slide-in{from{transform:translate(-50%,-100%);opacity:0}to{transform:translate(-50%,0);opacity:1}}';
      document.head.appendChild(s);
    }
    document.body.appendChild(toast);
  }

  /** Show a friendly toast when API is not configured, with a quick link. */
  function showConfigToast() {
    // Mark that user wants translation — will auto-start when API is configured
    window._wt_pendingTranslate = currentMode || 'inline';

    if (!document.getElementById('wt-toast-kf')) {
      const s = document.createElement('style');
      s.id = 'wt-toast-kf';
      s.textContent = '@keyframes wt-slide-in{from{transform:translate(-50%,-100%);opacity:0}to{transform:translate(-50%,0);opacity:1}}';
      document.head.appendChild(s);
    }
    const toast = document.createElement('div');
    toast.className = 'wt-config-toast';
    toast.innerHTML = `
    <span style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:20px;">&#9888;&#65039;</span>
      <span style="font-weight:600;font-size:14px;color:#1f2937;">${t('toast.api_not_configured')}</span>
    </span>
    <span style="color:#6b7280;font-size:13px;margin:4px 0 0 30px;">${t('toast.config_hint')}</span>
    <span style="display:flex;gap:8px;margin-top:10px;margin-left:30px;">
      <button class="wt-toast-btn">${t('toast.open_settings')}</button>
      <button class="wt-toast-close">${t('toast.dismiss')}</button>
    </span>`;
    Object.assign(toast.style, {
      position:'fixed',top:'16px',left:'50%',zIndex:'2147483647',
      display:'flex',flexDirection:'column',padding:'16px 20px',
      background:'#fff',color:'#1f2937',
      fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif',
      borderRadius:'14px',boxShadow:'0 12px 40px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.04)',
      maxWidth:'440px',width:'calc(100vw - 32px)',
      animation:'wt-slide-in .35s cubic-bezier(.34,1.56,.64,1)',
      transform:'translateX(-50%)',
    });
    const btn = toast.querySelector('.wt-toast-btn');
    const close = toast.querySelector('.wt-toast-close');
    Object.assign(btn.style, {
      background:'linear-gradient(135deg,#6366f1,#4f46e5)',color:'#fff',border:'none',
      padding:'8px 18px',borderRadius:'8px',cursor:'pointer',fontSize:'13px',
      fontWeight:'600',whiteSpace:'nowrap',boxShadow:'0 2px 8px rgba(99,102,241,.3)',
    });
    Object.assign(close.style, {
      background:'#f3f4f6',border:'none',padding:'8px 18px',borderRadius:'8px',
      cursor:'pointer',fontSize:'13px',color:'#6b7280',fontWeight:'500',
    });
    btn.addEventListener('click', () => {
      try { chrome.action?.openPopup?.(); } catch {}
      try { chrome.runtime.sendMessage({ type: 'OPEN_PANEL' }); } catch {}
      toast.remove();
    });
    close.addEventListener('click', () => {
      delete window._wt_pendingTranslate;
      toast.remove();
    });
    setTimeout(() => { if (toast.parentNode) { toast.remove(); delete window._wt_pendingTranslate; } }, 15000);
    document.body.appendChild(toast);
  }

  /** Auto-start translation if the user previously enabled it. */
  async function maybeAutoStart() {
    try {
      // Use session storage — scoped to this specific tab, won't bleed to other tabs
      const cfg = await chrome.storage.session.get(['wt_autoMode', 'wt_active']);
      if (cfg.wt_active && cfg.wt_autoMode) {
        console.log('[WT] Auto-starting translation in', cfg.wt_autoMode, 'mode');
        currentMode = cfg.wt_autoMode;
        startTranslation(cfg.wt_autoMode);
      } else {
        // Fallback: check local storage for default mode (legacy)
        const localCfg = await chrome.storage.local.get(['defaultMode']);
        currentMode = localCfg.defaultMode || 'inline';
      }
    } catch {
      // session storage may not be available in some contexts
      try {
        const localCfg = await chrome.storage.local.get(['defaultMode']);
        currentMode = localCfg.defaultMode || 'inline';
      } catch {}
    }
  }

})();
