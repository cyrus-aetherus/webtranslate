/**
 * Side Panel script — slot-model rendering.
 *
 * Content.js sends INIT_SLOTS with all extracted paragraphs (id, original, sortOrder).
 * We build a slotMap<id→element> and render placeholder divs ordered by sortOrder.
 * Subsequent BATCH_RESULT / APPEND_SLOTS / SLOT_ERROR messages update individual
 * slots in-place via slotMap.get(id) — O(1), no re-render, no re-order.
 */

import { init as initI18n, t, tf, applyI18nElements } from '../shared/i18n.js';

let port = null;
const listEl = document.getElementById('list');
const badgeEl = document.getElementById('badge');

/** @type {Map<string, HTMLElement>} id → slot DOM element */
let slotMap = new Map();
let totalSlots = 0;
let filledSlots = 0;
let erroredSlots = 0;

badgeEl.className = 'waiting';

async function bootstrap() {
  await _loadLocale();
  applyI18nElements(document);
  connect();
  // Listen for language changes so the panel stays in sync with popup settings
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.wt_language) {
      _loadLocale().then(() => _refreshAllText());
    }
  });
}
/** Collect current panel DOM state and send it to SW for E2E diagnostics. */
function _pushStateToSW() {
  if (!port) return;
  try {
    port.postMessage({
      type: 'PANEL_STATE',
      state: {
        badge: document.getElementById('badge')?.textContent || '',
        badgeClass: document.getElementById('badge')?.className || '',
        slots: document.querySelectorAll('.item').length,
        pending: document.querySelectorAll('.item.pending').length,
        error: document.querySelectorAll('.item.error').length,
        connected: !!port,
      },
    });
  } catch { /* port may be closed */ }
}

bootstrap();

// E2E diagnostic — also expose on window for CDP fallback
const _diagFn = () => ({
  badge: document.getElementById('badge')?.textContent || '',
  badgeClass: document.getElementById('badge')?.className || '',
  slots: document.querySelectorAll('.item').length,
  pending: document.querySelectorAll('.item.pending').length,
  error: document.querySelectorAll('.item.error').length,
  empty: document.querySelector('.empty')?.textContent || '',
  connected: !!port,
});
globalThis._wtPanelDiag = _diagFn;
self._wtPanelDiag = _diagFn;
window._wtPanelDiag = _diagFn;
// Push initial state after bootstrap completes
setTimeout(_pushStateToSW, 500);

async function _loadLocale() {
  try {
    const stored = await chrome.storage.local.get('wt_language');
    const nav = navigator.language;
    const locale = stored.wt_language === 'auto' || !stored.wt_language
      ? (nav?.startsWith('zh') ? 'zh-CN' : 'en')
      : stored.wt_language;
    await initI18n(locale);
  } catch {
    await initI18n('en');
  }
}

/** Re-render all dynamic text after a language change. */
function _refreshAllText() {
  applyI18nElements(document);
  // Update badge
  _updateBadge();
  // Refresh slot placeholders
  for (const slot of slotMap.values()) {
    if (slot.classList.contains('pending')) {
      const span = slot.querySelector('.wt-slot-pending');
      if (span) span.textContent = t('panel.waiting');
    }
    const copyBtn = slot.querySelector('[data-action="copy"]');
    if (copyBtn) copyBtn.textContent = t('panel.copy');
    const scrollBtn = slot.querySelector('[data-action="scroll"]');
    if (scrollBtn) scrollBtn.textContent = t('panel.scroll_to');
  }
}

function connect() {
  port = chrome.runtime.connect({ name: 'wt-panel-receiver' });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'INIT_SLOTS')    initSlots(msg.items);
    if (msg.type === 'APPEND_SLOTS')  appendSlots(msg.items);
    if (msg.type === 'BATCH_RESULT')  fillSlots(msg.items);
    if (msg.type === 'SLOT_ERROR')    markSlotErrors(msg.itemIds);
    if (msg.type === 'SHOW_PLACEHOLDER') _showPlaceholder();
    if (msg.type === 'SHOW_EMPTY')    _showEmpty();
  });

  port.onDisconnect.addListener(() => {
    // Clear all slots so stale content from a previous SPA page
    // doesn't linger when the user navigates to a new page.
    listEl.querySelectorAll('.item').forEach(el => el.remove());
    slotMap.clear();
    totalSlots = 0; filledSlots = 0; erroredSlots = 0;
    badgeEl.textContent = t('panel.disconnected');
    badgeEl.className = 'disconnected';
    port = null;
  });

  badgeEl.textContent = t('panel.connected');
  badgeEl.className = 'connected';
}

// ---- INIT_SLOTS ----

function initSlots(items) {
  listEl.querySelectorAll('.item, .empty').forEach(el => el.remove());
  slotMap.clear();
  totalSlots = items.length;
  filledSlots = 0;
  erroredSlots = 0;

  // Items arrive pre-sorted by sortOrder
  for (const it of items) {
    const div = _createSlot(it);
    slotMap.set(it.id, div);
    listEl.appendChild(div);
  }

  _updateBadge();
  _pushStateToSW();
}

// ---- APPEND_SLOTS (incremental — progressive-loading pages) ----

function appendSlots(items) {
  totalSlots += items.length;

  for (const it of items) {
    if (slotMap.has(it.id)) continue;
    const div = _createSlot(it);
    slotMap.set(it.id, div);
    // Insert at the correct sortOrder position
    _insertSorted(div, it.sortOrder);
  }

  _updateBadge();
  _pushStateToSW();
}

// ---- BATCH_RESULT ----

function fillSlots(items) {
  for (const it of items) {
    const slot = slotMap.get(it.id);
    if (!slot || !slot.classList.contains('pending')) continue;

    slot.classList.remove('pending');
    const transEl = slot.querySelector('.trans');
    if (transEl) transEl.textContent = it.translation;

    // Add action buttons now that translation is ready
    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.innerHTML = `
      <button data-action="copy">${t('panel.copy')}</button>
      <button data-action="scroll">${t('panel.scroll_to')}</button>
    `;
    actions.querySelector('[data-action="copy"]').addEventListener('click', () => {
      navigator.clipboard.writeText(it.translation);
    });
    actions.querySelector('[data-action="scroll"]').addEventListener('click', () => {
      port?.postMessage({ type: 'SCROLL_TO', paragraphId: it.id });
    });
    slot.appendChild(actions);

    filledSlots++;
  }

  _updateBadge();
  _pushStateToSW();
}

// ---- SLOT_ERROR ----

function markSlotErrors(itemIds) {
  for (const id of itemIds) {
    const slot = slotMap.get(id);
    if (!slot || !slot.classList.contains('pending')) continue;

    slot.classList.remove('pending');
    slot.classList.add('error');
    const transEl = slot.querySelector('.trans');
    if (transEl) {
      transEl.textContent = '⚠️ ' + t('panel.waiting');
    }

    erroredSlots++;
    filledSlots++;
  }

  _updateBadge();
  _pushStateToSW();
}

// ---- helpers ----

function _createSlot(it) {
  const div = document.createElement('div');
  div.className = 'item pending';
  div.dataset.id = it.id;
  div.dataset.sortOrder = it.sortOrder;
  div.innerHTML = `
    <div class="orig">${escapeHtml(it.original || '')}</div>
    <div class="trans"><span class="wt-slot-pending">${t('panel.waiting')}</span></div>`;
  return div;
}

/** Insert `div` in the correct position based on sortOrder (assumes items are pre-sorted). */
function _insertSorted(div, sortOrder) {
  let after = null;
  for (const child of listEl.children) {
    if (!child.dataset.sortOrder) continue;
    if (parseInt(child.dataset.sortOrder, 10) > sortOrder) break;
    after = child;
  }
  if (after && after.nextSibling) {
    listEl.insertBefore(div, after.nextSibling);
  } else {
    listEl.appendChild(div);
  }
}

function _updateBadge() {
  const done = filledSlots;
  const total = totalSlots;
  badgeEl.textContent = tf('panel.translated_count', { count: done });
  listEl.style.setProperty('--wt-pct', total ? Math.round((done / total) * 100) + '%' : '0%');
}

function _showPlaceholder() {
  listEl.querySelectorAll('.item').forEach(el => el.remove());
  slotMap.clear();
  totalSlots = 0; filledSlots = 0; erroredSlots = 0;
  badgeEl.textContent = t('panel.switch_back');
  badgeEl.className = 'waiting';
  _pushStateToSW();
}

function _showEmpty() {
  listEl.querySelectorAll('.item').forEach(el => el.remove());
  slotMap.clear();
  totalSlots = 0; filledSlots = 0; erroredSlots = 0;
  badgeEl.textContent = t('panel.empty_hint');
  badgeEl.className = 'waiting';
  _pushStateToSW();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
