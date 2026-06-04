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
  'fab.resume': 'Resume',
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
export async function init(locale) {
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
export function t(key) {
  // Messages are always pre-seeded with HARDCODED_EN_FALLBACK;
  // _state.ready only gates DOM-tree scanning (applyI18nElements).
  return _state.messages[key] ?? key;
}

/**
 * Look up a key and replace `{placeholder}` tokens.
 * @param {string} key
 * @param {Record<string,string|number>} vars
 * @returns {string}
 */
export function tf(key, vars) {
  let template = t(key);
  for (const [k, v] of Object.entries(vars)) {
    template = template.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
  }
  return template;
}

/**
 * Return the currently active locale code.
 * @returns {string}
 */
export function currentLocale() {
  return _state.locale;
}

/**
 * Walk the given root element and replace textContent of every
 * descendant that carries a `data-i18n` attribute.
 * Also handles `data-i18n-placeholder` for input placeholders.
 * @param {Document|Element} root
 */
export function applyI18nElements(root) {
  if (!_state.ready) return;

  for (const el of root.querySelectorAll('[data-i18n]')) {
    const key = el.dataset.i18n;
    const text = t(key);
    if (text && text !== key) {
      el.textContent = text;
    }
  }

  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    const key = el.dataset.i18nPlaceholder;
    const text = t(key);
    if (text && text !== key) {
      el.placeholder = text;
    }
  }

  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    const key = el.dataset.i18nTitle;
    const text = t(key);
    if (text && text !== key) {
      el.title = text;
    }
  }
}

/**
 * Persist the language choice and re-init.
 * @param {string} locale  e.g. "en", "zh-CN"
 */
export async function setLocale(locale) {
  await chrome.storage.local.set({ [STORAGE_KEY]: locale });
  await init(locale);
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
