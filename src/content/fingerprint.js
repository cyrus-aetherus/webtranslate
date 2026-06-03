/**
 * Content fingerprint utilities for deduplication
 * L1: DOM marker (data-wt-done="fingerprint")
 * L2: Content fingerprint via djb2 hash
 */

import { djb2Hash } from '../shared/utils.js';

/**
 * Compute a content fingerprint for a paragraph element.
 * @param {Element} el
 * @returns {string} 14-char hex fingerprint
 */
export function computeFingerprint(el) {
  const text = el.textContent.replace(/\s+/g, ' ').trim();
  return djb2Hash(text);
}

/**
 * Mark an element as translated (L1 DOM marker).
 * @param {Element} el
 * @param {string} fingerprint
 */
export function markTranslated(el, fingerprint) {
  if (fingerprint) {
    el.dataset.wtDone = fingerprint.slice(0, 12);
  } else if (!el.dataset.wtDone) {
    el.dataset.wtDone = '1';
  }
}

/**
 * Check if an element has already been translated.
 * @param {Element} el
 * @returns {boolean}
 */
export function isTranslated(el) {
  return el.dataset.wtDone != null;
}

/**
 * Remove translation markers (used for reset / retry).
 * @param {Element} el
 */
export function clearMark(el) {
  delete el.dataset.wtDone;
}
