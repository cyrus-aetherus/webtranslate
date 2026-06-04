/**
 * Side Panel script.
 * Communicates with Content Script via chrome.runtime.connect Port.
 * Renders a bilingual list (original + translation).
 * All visible strings are driven by the i18n module.
 */

import { init as initI18n, t, tf, applyI18nElements } from '../shared/i18n.js';

let port = null;
const listEl = document.getElementById('list');
const badgeEl = document.getElementById('badge');
let itemCount = 0;

// Set initial waiting state
badgeEl.className = 'waiting';

async function bootstrap() {
  // Resolve locale from storage or navigator.language
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
  // Connect back to SW.  Only one side panel is open at a time,
  // so we use a fixed port name — the SW relays messages from
  // content-script PanelRenderer ports to this receiver.
  port = chrome.runtime.connect({ name: 'wt-panel-receiver' });

  port.onMessage.addListener((msg) => {
    if (msg.type === 'BATCH_RESULT') {
      renderBatch(msg.items);
    }
  });

  port.onDisconnect.addListener(() => {
    badgeEl.textContent = t('panel.disconnected');
    badgeEl.className = 'disconnected';
    port = null;
  });

  badgeEl.textContent = t('panel.connected');
  badgeEl.className = 'connected';
}

function renderBatch(items) {
  // Clear existing items and re-render the entire sorted list.
  // Content script sends the full accumulated list each time, sorted
  // by document order — this guarantees paragraph order is correct
  // regardless of concurrent batch completion order.
  listEl.querySelectorAll('.item').forEach(el => el.remove());

  // Remove empty placeholder if present
  const empty = listEl.querySelector('.empty');
  if (empty) empty.remove();

  itemCount = 0;
  for (const it of items) {
    itemCount++;
    const div = document.createElement('div');
    div.className = 'item';
    div.dataset.id = it.id;
    div.innerHTML = `
      <div class="orig">${escapeHtml(it.original)}</div>
      <div class="trans">${escapeHtml(it.translation)}</div>
      <div class="actions">
        <button data-action="copy">${t('panel.copy')}</button>
        <button data-action="scroll">${t('panel.scroll_to')}</button>
      </div>
    `;

    div.querySelector('[data-action="copy"]').addEventListener('click', () => {
      navigator.clipboard.writeText(it.translation);
    });

    div.querySelector('[data-action="scroll"]').addEventListener('click', () => {
      port?.postMessage({ type: 'SCROLL_TO', paragraphId: it.id });
    });

    listEl.appendChild(div);
  }

  badgeEl.textContent = tf('panel.translated_count', { count: itemCount });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
