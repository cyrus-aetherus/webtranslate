/**
 * Side Panel script.
 * Slot model: content.js sends INIT_SLOTS with all paragraphs (empty
 * translations).  We create placeholder divs ordered by sortOrder.
 * Subsequent BATCH_RESULT messages fill individual slots in-place.
 * This guarantees correct paragraph order and gives the user instant
 * feedback that translation has started.
 */

import { init as initI18n, t, tf, applyI18nElements } from '../shared/i18n.js';

let port = null;
const listEl = document.getElementById('list');
const badgeEl = document.getElementById('badge');
let totalSlots = 0;
let filledSlots = 0;

badgeEl.className = 'waiting';

async function bootstrap() {
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
  applyI18nElements(document);
  connect();
}
bootstrap();

function connect() {
  port = chrome.runtime.connect({ name: 'wt-panel-receiver' });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'INIT_SLOTS') initSlots(msg.items);
    if (msg.type === 'BATCH_RESULT') fillSlots(msg.items);
  });

  port.onDisconnect.addListener(() => {
    badgeEl.textContent = t('panel.disconnected');
    badgeEl.className = 'disconnected';
    port = null;
  });

  badgeEl.textContent = t('panel.connected');
  badgeEl.className = 'connected';
}

function initSlots(items) {
  listEl.querySelectorAll('.item, .empty').forEach(el => el.remove());
  totalSlots = items.length;
  filledSlots = 0;

  // Items arrive pre-sorted by sortOrder (0, 1, 2, ...)
  for (const it of items) {
    const div = document.createElement('div');
    div.className = 'item pending';
    div.dataset.id = it.id;
    div.dataset.sortOrder = it.sortOrder;
    div.innerHTML = `
      <div class="orig">${escapeHtml(it.original)}</div>
      <div class="trans"><span class="wt-slot-pending">${t('panel.waiting')}</span></div>
    `;
    listEl.appendChild(div);
  }

  badgeEl.textContent = tf('panel.translated_count', { count: 0 });
  _updateProgress();
}

function fillSlots(items) {
  for (const it of items) {
    const slot = document.querySelector(`.item[data-sort-order="${it.sortOrder}"]`);
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

  badgeEl.textContent = tf('panel.translated_count', { count: filledSlots });
  _updateProgress();
}

function _updateProgress() {
  if (totalSlots === 0) return;
  const pct = Math.round((filledSlots / totalSlots) * 100);
  badgeEl.textContent = tf('panel.translated_count', { count: filledSlots });
  // Visual: set a CSS variable so the panel can show a progress bar
  listEl.style.setProperty('--wt-pct', pct + '%');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
