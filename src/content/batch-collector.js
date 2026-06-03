/**
 * BatchCollector - Viewport-first lazy collection with batching rules
 * Rules:
 *   - Max 800 chars per batch
 *   - Max 8 items per batch
 *   - Single item >= 800 chars becomes its own batch
 *   - Debounce 100ms before flushing
 */

import { debounce } from '../shared/utils.js';

export class BatchCollector {
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
