/**
 * ApiProxy - Routes batch translation requests to the appropriate LLM adapter.
 * Features:
 *   - Adapter pattern (OpenAI-compatible, Anthropic)
 *   - Retry with exponential backoff
 *   - Concurrency-friendly (stateless per batch)
 *   - Cancellation via batchId map
 */

import { buildSystemPrompt, calcMaxTokens, parseBatchResponse } from '../shared/utils.js';
import * as openAiAdapter from './adapters/openai.js';
import * as anthropicAdapter from './adapters/anthropic.js';

export class ApiProxy {
  constructor() {
    /** @type {Map<string, AbortController>} */
    this._controllers = new Map();
    /** @type {Set<string>} batchIds intentionally stopped — no retry */
    this._stopped = new Set();
  }

  /**
   * Send a batch translation request with retry logic.
   * Retry policy:
   *   - 2 retries for generic failures, backoff 1s -> 3s
   *   - 429: read Retry-After header or exponential backoff 2s -> 4s -> 8s
   *   - 401/403: no retry (auth failure)
   *   - If stopAll() was called, in-flight requests complete naturally
   *     but retries are suppressed.
   * @param {{id:string, fingerprint:string, text:string}[]} items
   * @param {object} config
   * @param {string} batchId
   * @returns {Promise<{id:string, translation:string}[]>}
   */
  async translateBatch(items, config, batchId) {
    const maxRetries = 2;
    let attempt = 0;

    while (true) {
      const controller = new AbortController();
      this._controllers.set(batchId, controller);

      try {
        const result = await this._doFetch(items, config, controller);
        this._stopped.delete(batchId);
        return result;
      } catch (err) {
        this._controllers.delete(batchId);

        // Intentional stop — suppress retry
        if (this._stopped.has(batchId)) {
          this._stopped.delete(batchId);
          throw err;
        }

        // Non-retryable: auth errors
        if (err.message?.includes('Auth failed')) throw err;

        if (attempt >= maxRetries) throw err;

        const delay = this._computeBackoff(err, attempt);
        await this._sleep(delay);
        attempt++;
      }
    }
  }

  async _doFetch(items, config, controller) {
    const adapter = this._resolveAdapter(config.adapter);
    const promptText = this._buildPrompt(items, config);
    const maxTokens = calcMaxTokens(promptText.length);

    const { url, headers, body } = adapter.buildRequest(
      promptText,
      config,
      maxTokens
    );

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const err = await this._classifyHttpError(response);
      throw err;
    }

    const raw = await response.json();
    const { content, usage } = adapter.parseResponse(raw);
    const results = parseBatchResponse(content, items);
    return { results, usage };
  }

  _computeBackoff(err, attempt) {
    if (err.code === 429) {
      return err.retryAfter ? err.retryAfter * 1000 : 2000 * Math.pow(2, attempt);
    }
    return 1000 * Math.pow(3, attempt); // 1s -> 3s
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Cancel an in-flight batch request
   * @param {string} batchId
   */
  cancelBatch(batchId) {
    const ctrl = this._controllers.get(batchId);
    if (ctrl) {
      ctrl.abort();
      this._controllers.delete(batchId);
    }
  }

  /**
   * Mark all in-flight batches as stopped.  Already-sent requests are
   * allowed to complete (results will be cached); retries are suppressed.
   * Queued batches (not yet in _controllers) are handled by
   * ConcurrencyController.cancelQueued() on the CS side.
   */
  stopAll() {
    for (const id of this._controllers.keys()) {
      this._stopped.add(id);
    }
  }

  /**
   * Cleanup on extension suspend — abort all immediately.
   */
  dispose() {
    for (const [id, ctrl] of this._controllers) {
      ctrl.abort();
      this._stopped.add(id);
    }
    this._controllers.clear();
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  _resolveAdapter(name) {
    switch (name) {
      case 'anthropic':
        return anthropicAdapter;
      case 'openai':
      default:
        return openAiAdapter;
    }
  }

  _buildPrompt(items, config) {
    const sys = buildSystemPrompt(config.sourceLang, config.targetLang);
    const user = items
      .map((it) => `───SEP:${it.fingerprint}───\n${escapeSep(it.text)}`)
      .join('\n') + '\n───SEP:END───';
    return { sys, user };
  }

  async _classifyHttpError(response) {
    const status = response.status;
    if (status === 401 || status === 403) {
      return new Error(`Auth failed (${status}): invalid API key or insufficient balance`);
    }
    if (status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const err = new Error(`Rate limited (429)`);
      err.code = 429;
      err.retryAfter = retryAfter ? parseInt(retryAfter, 10) : null;
      return err;
    }
    const body = await response.text().catch(() => '');
    return new Error(`HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

function escapeSep(text) {
  return text.replace(/───SEP:/g, '​───SEP​:');
}
