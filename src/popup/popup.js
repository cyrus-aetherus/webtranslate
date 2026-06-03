/**
 * Popup — Settings + Statistics with left sidebar navigation.
 */
import {
  validateApiUrl, validateApiKey, validateModel,
  validateConcurrency, validateMaxBatchChars, validateConfig,
} from '../shared/utils.js';
import { DEFAULT_CONFIG, estimateCost } from '../shared/constants.js';
import { init as initI18n, t, tf, applyI18nElements, setLocale } from '../shared/i18n.js';

// ---- Nav SVG icons (sci-fi line style, matching FAB) -------------------------
const NAV_ICONS = {
  model: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.5 4.5-3 6l-4 5-4-5c-1.5-1.5-3-3.5-3-6a7 7 0 0 1 7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>`,
  translation: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z"/></svg>`,
  settings: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`,
  stats: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
};
document.querySelectorAll('.nav-item').forEach(btn => {
  const iconEl = btn.querySelector('.nav-icon');
  if (iconEl && NAV_ICONS[btn.dataset.tab]) iconEl.innerHTML = NAV_ICONS[btn.dataset.tab];
});

// ---- Tab switching ---------------------------------------------------------
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'stats') loadStats();
  });
});

// ---- DOM refs --------------------------------------------------------------
const $ = id => document.getElementById(id);
const apiUrlEl = $('apiUrl'), apiKeyEl = $('apiKey'), modelEl = $('model');
const adapterEl = $('adapter'), defaultModeEl = $('defaultMode'), languageEl = $('language');
const sourceLangEl = $('sourceLang'), targetLangEl = $('targetLang');
const concurrencyEl = $('concurrency'), maxBatchCharsEl = $('maxBatchChars');
const testBtn = $('testBtn'), saveModelBtn = $('saveModelBtn'), saveTranslationBtn = $('saveTranslationBtn'), saveSettingsBtn = $('saveSettingsBtn');
const toggleKeyBtn = $('toggleKey');
const testResultEl = $('test-result');
const translationResultEl = $('translation-result');
const settingsResultEl = $('settings-result');
const exportBtn = $('exportBtn'), importBtn = $('importBtn'), importFile = $('importFile');

// ---- Init ------------------------------------------------------------------
async function bootstrap() {
  try {
    const stored = await chrome.storage.local.get('wt_language');
    const loc = stored.wt_language === 'auto' || !stored.wt_language
      ? (navigator.language?.startsWith('zh') ? 'zh-CN' : 'en') : stored.wt_language;
    await initI18n(loc);
  } catch { await initI18n('en'); }
  applyI18nElements(document);
  await loadConfig();
}
bootstrap();

// ---- Config load / save ----------------------------------------------------
async function loadConfig() {
  const s = await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG));
  const c = { ...DEFAULT_CONFIG, ...s };
  apiUrlEl.value = c.apiUrl; apiKeyEl.value = c.apiKey; modelEl.value = c.model;
  adapterEl.value = c.adapter; defaultModeEl.value = c.defaultMode;
  languageEl.value = c.language || 'en'; concurrencyEl.value = c.concurrency;
  maxBatchCharsEl.value = c.maxBatchChars;
  sourceLangEl.value = c.sourceLang || 'auto'; targetLangEl.value = c.targetLang || 'zh-CN';
}

// ---- Validation ------------------------------------------------------------
function checkField(el, validator) {
  const f = el.closest('.field'); const r = validator(el.value);
  f.classList.toggle('invalid', !r.valid); return r.valid;
}
function validateModelFields() {
  return checkField(apiUrlEl, validateApiUrl) && checkField(apiKeyEl, validateApiKey)
    && checkField(modelEl, validateModel);
}
function validateSettingsFields() {
  return checkField(concurrencyEl, validateConcurrency)
    && checkField(maxBatchCharsEl, validateMaxBatchChars);
}
function validateAll() {
  return validateModelFields() && validateSettingsFields();
}

// ---- Test connection -------------------------------------------------------
async function testConnection() {
  if (!validateModelFields()) { showTest(false, t('popup.test_fix_errors')); return; }
  testBtn.disabled = true; showTest(null, t('popup.test_connecting'));
  try {
    const cfg = gatherConfig();
    const url = cfg.apiUrl.replace(/\/$/, '').replace(/\/v1$/, '') + '/v1/chat/completions';
    const res = await fetch(url, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'hello' }], max_tokens: 16 }),
    });
    if (res.ok) showTest(true, t('popup.test_success'));
    else if (res.status === 404) showTest(false, `HTTP 404: ${url}`);
    else if (res.status === 401 || res.status === 403) showTest(false, t('popup.test_auth_fail'));
    else showTest(false, `HTTP ${res.status}`);
  } catch (e) { showTest(false, tf('popup.test_request_fail', { message: e.message })); }
  finally { testBtn.disabled = false; }
}
function showTest(ok, text) { testResultEl.textContent = text; testResultEl.className = ok === true ? 'ok' : ok === false ? 'err' : ''; }

// ---- Gather / Save ---------------------------------------------------------
function gatherConfig() {
  return { apiUrl: apiUrlEl.value.trim(), apiKey: apiKeyEl.value.trim(), model: modelEl.value.trim(),
    adapter: adapterEl.value, defaultMode: defaultModeEl.value, language: languageEl.value,
    concurrency: parseInt(concurrencyEl.value, 10), maxBatchChars: parseInt(maxBatchCharsEl.value, 10),
    sourceLang: sourceLangEl.value, targetLang: targetLangEl.value };
}
async function saveModelConfig() {
  if (!validateModelFields()) return;
  const cfg = gatherConfig();
  if (validateApiUrl(cfg.apiUrl).isHttp && !confirm(t('popup.save_http_warning'))) return;
  await chrome.storage.local.set({ apiUrl: cfg.apiUrl, apiKey: cfg.apiKey, model: cfg.model, adapter: cfg.adapter });
  showTest(true, t('popup.save_success'));
}
async function saveSettingsConfig() {
  if (!validateSettingsFields()) return;
  const cfg = gatherConfig();
  if (cfg.language) { await chrome.storage.local.set({ wt_language: cfg.language }); await setLocale(cfg.language); applyI18nElements(document); }
  await chrome.storage.local.set({ defaultMode: cfg.defaultMode, language: cfg.language, concurrency: cfg.concurrency, maxBatchChars: cfg.maxBatchChars });
  settingsResultEl.textContent = t('popup.save_success');
  settingsResultEl.style.color = 'var(--accent2)';
  setTimeout(() => { settingsResultEl.textContent = ''; }, 2000);
}
async function saveTranslationConfig() {
  await chrome.storage.local.set({ sourceLang: sourceLangEl.value, targetLang: targetLangEl.value });
  translationResultEl.textContent = t('popup.save_success');
  translationResultEl.style.color = 'var(--accent2)';
  setTimeout(() => { translationResultEl.textContent = ''; }, 2000);
}

// ---- Export / Import -------------------------------------------------------
exportBtn.addEventListener('click', async () => {
  const s = { ...await chrome.storage.local.get(Object.keys(DEFAULT_CONFIG)) }; delete s.apiKey;
  const b = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
  const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'webtranslate-config.json'; a.click(); URL.revokeObjectURL(u);
});
importBtn.addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async e => {
  const f = e.target.files?.[0]; if (!f) return;
  try {
    const p = JSON.parse(await f.text()); delete p.apiKey;
    if (!validateConfig(p).valid) { showTest(false, 'Invalid config'); return; }
    await chrome.storage.local.set(p); await loadConfig(); showTest(true, t('popup.import_success'));
  } catch (err) { showTest(false, 'Parse error: ' + err.message); }
  importFile.value = '';
});

// ---- Language --------------------------------------------------------------
languageEl.addEventListener('change', async () => {
  await setLocale(languageEl.value); applyI18nElements(document);
});

// ---- Toggle key ------------------------------------------------------------
toggleKeyBtn.addEventListener('click', () => {
  const p = apiKeyEl.type === 'password'; apiKeyEl.type = p ? 'text' : 'password';
  toggleKeyBtn.textContent = p ? 'Hide' : 'Show';
});

// ---- Default: load stats on open -------------------------------------------
loadStats();

// ---- Blur validation -------------------------------------------------------
apiUrlEl.addEventListener('blur', () => checkField(apiUrlEl, validateApiUrl));
apiKeyEl.addEventListener('blur', () => checkField(apiKeyEl, validateApiKey));
modelEl.addEventListener('blur', () => checkField(modelEl, validateModel));
concurrencyEl.addEventListener('blur', () => checkField(concurrencyEl, validateConcurrency));
maxBatchCharsEl.addEventListener('blur', () => checkField(maxBatchCharsEl, validateMaxBatchChars));
testBtn.addEventListener('click', testConnection);
saveModelBtn.addEventListener('click', saveModelConfig);
saveTranslationBtn.addEventListener('click', saveTranslationConfig);
saveSettingsBtn.addEventListener('click', saveSettingsConfig);

// ---- Statistics ------------------------------------------------------------
function fn(n) { if (!n) return '0'; if (n >= 1e6) return (n/1e6).toFixed(1)+'M'; if (n >= 1e3) return (n/1e3).toFixed(1)+'K'; return String(n); }
async function loadStats() {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_STATS' }); if (!res) return;
    const s = res.alltime || {};
    $('statCalls').textContent = fn(s.calls); $('statSegments').textContent = fn(s.segments);
    $('statIn').textContent = fn(s.promptTokens); $('statOut').textContent = fn(s.completionTokens);
    const cfg = await chrome.storage.local.get('model');
    const cost = estimateCost(cfg.model || '', s.promptTokens || 0, s.completionTokens || 0);
    $('statCost').textContent = cost > 0 ? '$' + cost.toFixed(4) : '-';
  } catch {}
}
$('refreshStats').addEventListener('click', loadStats);
$('clearStats').addEventListener('click', async () => {
  if (!confirm('Clear all usage statistics?')) return;
  await chrome.runtime.sendMessage({ type: 'CLEAR_STATS' });
  $('statCalls').textContent = $('statSegments').textContent = $('statIn').textContent = $('statOut').textContent = $('statCost').textContent = '-';
});
