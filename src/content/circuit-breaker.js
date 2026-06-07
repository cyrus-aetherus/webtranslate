/**
 * CircuitBreaker - Pauses translation after consecutive failures.
 * Threshold: 5 consecutive batch failures → trigger PAUSED state.
 * Reset: successful batch or manual resume resets the counter.
 */

export class CircuitBreaker {
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

}
