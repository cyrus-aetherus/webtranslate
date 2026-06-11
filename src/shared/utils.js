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
export function djb2Hash(str) {
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
export function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ==================== Validation Helpers ====================

/**
 * Validate API URL format.
 * @param {string} url
 * @returns {{valid: boolean, message?: string}}
 */
export function validateApiUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, message: 'API URL is required' };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return { valid: false, message: 'API URL must use HTTPS' };
    }
  } catch {
    return { valid: false, message: 'Invalid URL format' };
  }
  return { valid: true };
}

/**
 * Validate API Key.
 * @param {string} key
 * @returns {{valid: boolean, message?: string}}
 */
export function validateApiKey(key) {
  if (!key || typeof key !== 'string' || key.length < 8) {
    return { valid: false, message: 'API Key must be at least 8 characters' };
  }
  return { valid: true };
}

/**
 * Validate model name.
 * @param {string} model
 * @returns {{valid: boolean, message?: string}}
 */
export function validateModel(model) {
  if (!model || typeof model !== 'string' || model.length === 0 || model.length > 100) {
    return { valid: false, message: 'Model name is required (max 100 chars)' };
  }
  return { valid: true };
}

/**
 * Validate concurrency value.
 * @param {number} n
 * @returns {{valid: boolean, message?: string}}
 */
export function validateConcurrency(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 1 || num > 10) {
    return { valid: false, message: 'Concurrency must be an integer between 1 and 10' };
  }
  return { valid: true };
}

/**
 * Validate max batch characters.
 * @param {number} n
 * @returns {{valid: boolean, message?: string}}
 */
export function validateMaxBatchChars(n) {
  const num = Number(n);
  if (!Number.isInteger(num) || num < 500 || num > 5000) {
    return { valid: false, message: 'Max batch chars must be between 500 and 5000' };
  }
  return { valid: true };
}

/**
 * Full config validation.
 * @param {object} config
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateConfig(config) {
  const errors = [];
  const push = (r) => { if (!r.valid) errors.push(r.message); };

  push(validateApiUrl(config.apiUrl));
  push(validateApiKey(config.apiKey));
  push(validateModel(config.model));
  push(validateConcurrency(config.concurrency));
  push(validateMaxBatchChars(config.maxBatchChars));

  return { valid: errors.length === 0, errors };
}

// ==================== Prompt / Response Helpers ====================

/**
 * Build a batch translation prompt with separators.
 * @param {{id:string, fingerprint:string, text:string}[]} items
 * @returns {string}
 */
export function buildBatchPrompt(items) {
  return items
    .map((item) => `───SEP:${item.fingerprint}───\n${escapeSep(item.text)}`)
    .join('\n') + '\n───SEP:END───';
}

/**
 * Parse a batch translation response.
 * @param {string} raw
 * @param {{id:string, fingerprint:string, text:string}[]} items
 * @returns {{id:string, translation:string}[]}
 */
export function parseBatchResponse(raw, items) {
  const normalized = unescapeSep(raw);
  const parts = normalized.split(/───SEP:([a-zA-Z0-9]+)───/);

  // Build map, stopping at the END terminator marker
  const map = {};
  let segmentCount = 0;
  for (let i = 1; i < parts.length - 1; i += 2) {
    if (parts[i] === 'END') break;
    map[parts[i]] = parts[i + 1].trim();
    segmentCount++;
  }

  if (segmentCount !== items.length) {
    throw new Error(`Segment mismatch: expected ${items.length}, got ${segmentCount}`);
  }

  return items.map((item) => ({
    id: item.id,
    translation: map[item.fingerprint] ?? item.text,
  }));
}

function escapeSep(text) {
  return text.replace(/───SEP:/g, '​───SEP​:');
}

function unescapeSep(text) {
  return text.replace(/​───SEP​:/g, '───SEP:');
}

/**
 * Build system prompt for the LLM.
 * @param {string} sourceLang
 * @param {string} targetLang
 * @returns {string}
 */
export function buildSystemPrompt(sourceLang = 'auto', targetLang = 'zh-CN') {
  const src = sourceLang === 'auto' ? 'the detected source language' : sourceLang;
  return `You are a professional translator. Translate the content between each
───SEP:xxx─── marker from ${src} to ${targetLang}.

Rules:
1. Keep each translated section between its original SEP markers.
2. End your response with ───SEP:END───.
3. Do NOT translate: code blocks, URLs, numbers, proper nouns.
4. Output ONLY the translations with separators. No explanations.`;
}

/**
 * Calculate max_tokens: batch total chars × 3, minimum 256.
 * @param {number} totalChars
 * @returns {number}
 */
export function calcMaxTokens(totalChars) {
  return Math.max(256, totalChars * 3);
}

// ==================== Content Filtering Helpers ====================

/**
 * Check if text is a pure URL.
 * @param {string} text
 * @returns {boolean}
 */
export function isPureUrl(text) {
  return /^https?:\/\/\S+$/.test(text.trim());
}

/**
 * Check if text is a short number or timestamp (skip translation).
 * @param {string} text
 * @returns {boolean}
 */
export function isShortNumberOrTimestamp(text) {
  const t = text.trim();
  if (/^\d{1,6}$/.test(t)) return true;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return true;
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(t)) return true;
  return false;
}

/**
 * Exponential backoff delay.
 * @param {number} attempt 0-based
 * @param {number} baseMs
 * @returns {number}
 */
export function exponentialBackoff(attempt, baseMs = 1000) {
  return baseMs * Math.pow(2, attempt);
}
