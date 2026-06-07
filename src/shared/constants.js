/**
 * WebTranslate global constants
 * Message protocol enums, state machine states, default configuration, DOM selectors
 */

// ==================== Message Types (CS ↔ SW ↔ Panel) ====================
export const MSG = {
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
export const State = {
  IDLE: 'IDLE',
  SCANNING: 'SCANNING',
  TRANSLATING: 'TRANSLATING',
  PAUSED: 'PAUSED',
  ERROR: 'ERROR',
};

// ==================== Default User Configuration ====================
export const DEFAULT_CONFIG = {
  apiUrl: '',
  apiKey: '',
  model: '',
  adapter: 'openai',        // 'openai' | 'anthropic'
  language: 'auto',          // UI locale: 'auto', 'en', 'zh-CN', 'ja'
  sourceLang: 'auto',        // Source language for translation
  targetLang: 'zh-CN',       // Target language for translation
  defaultMode: 'inline',     // 'inline' | 'panel'
  maxBatchChars: 800,
  maxBatchItems: 8,
  concurrency: 3,
  temperature: 0.1,
};

// ==================== Batch Separator Protocol ====================
export const SEP_PREFIX = '───SEP:';
export const SEP_END = '───SEP:END───';

// ==================== DOM Selectors ====================
export const CONTENT_SELECTORS = [
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

export const TRANSLATABLE_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'LI', 'TD', 'TH', 'BLOCKQUOTE',
  'DD', 'DT', 'FIGCAPTION',
]);

export const EXCLUDED_CONTAINERS = new Set([
  'NAV', 'HEADER', 'FOOTER', 'ASIDE',
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE',
  'PRE',
]);

export const EXCLUDED_ROLES = [
  'complementary', 'navigation', 'banner', 'contentinfo',
];

// CSS class name patterns that indicate non-content areas
export const EXCLUDED_CLASS_PATTERNS = [
  /(^|\s)(ad-|ads-|advertisement|banner|sponsor)/i,
  /(^|\s)(sidebar|side-bar|side_nav)/i,
  /(^|\s)(nav-|navbar|menu-|dropdown|breadcrumbs)/i,
  /(^|\s)(modal|popup|toast|notification|cookie-banner|consent)/i,
];

export const PROTECTED_TAGS = new Set([
  'PRE', 'CODE', 'MATH', 'SVG',
]);

// ==================== Model Pricing ($/1K tokens) ====================
export const MODEL_PRICING = {
  'gpt-4o':         { input: 0.0025,  output: 0.010 },
  'gpt-4o-mini':    { input: 0.00015, output: 0.0006 },
  'gpt-4-turbo':    { input: 0.010,   output: 0.030 },
  'gpt-4':          { input: 0.030,   output: 0.060 },
  'gpt-3.5-turbo':  { input: 0.0005,  output: 0.0015 },
  'deepseek-chat':  { input: 0.00014, output: 0.00028 },
  'deepseek-reasoner': { input: 0.00055, output: 0.00219 },
  'claude-3-opus':  { input: 0.015,   output: 0.075 },
  'claude-3-sonnet': { input: 0.003,  output: 0.015 },
  'claude-3-haiku': { input: 0.00025, output: 0.00125 },
  _default:          { input: 0,       output: 0 },
};

export function estimateCost(model, promptTokens, completionTokens) {
  const p = MODEL_PRICING[model] || MODEL_PRICING._default;
  return (promptTokens * p.input + completionTokens * p.output) / 1000;
}
