/**
 * ConfigStore - Reads / writes user configuration via chrome.storage.local
 * Keys: apiUrl, apiKey, model, adapter, sourceLang, targetLang,
 *       defaultMode, maxBatchChars, maxBatchItems, concurrency, temperature
 */

import { DEFAULT_CONFIG } from '../shared/constants.js';

export class ConfigStore {
  constructor() {
    this._cache = null;
  }

  /**
   * Load full config, merged with defaults
   * @returns {Promise<typeof DEFAULT_CONFIG>}
   */
  async getAll() {
    if (this._cache) return this._cache;
    const stored = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
    this._cache = { ...DEFAULT_CONFIG, ...stored };
    return this._cache;
  }

  /**
   * Update specific keys
   * @param {Partial<typeof DEFAULT_CONFIG>} patch
   */
  async set(patch) {
    await chrome.storage.local.set(patch);
    this._cache = null; // invalidate cache
  }

  /**
   * Reset to factory defaults
   */
  async reset() {
    await chrome.storage.local.clear();
    this._cache = null;
  }

  /**
   * Export config as JSON (API Key excluded for safety)
   */
  async exportJson() {
    const cfg = await this.getAll();
    const safe = { ...cfg };
    delete safe.apiKey;
    return JSON.stringify(safe, null, 2);
  }

  /**
   * Import config from JSON string
   * @param {string} json
   */
  async importJson(json) {
    const parsed = JSON.parse(json);
    delete parsed.apiKey; // never import key
    await this.set(parsed);
  }
}
