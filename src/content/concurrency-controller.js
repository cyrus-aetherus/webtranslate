/**
 * ConcurrencyController - Limits the number of in-flight translation batches.
 * Default concurrency: 3 batches at a time.
 * Uses a promise-based queue; new requests wait until a slot frees up.
 */

export class ConcurrencyController {
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
