/**
 * InlineRenderer — Sci-fi dark translation blocks matching the WebTranslate logo.
 *
 * Colour palette:
 *   Primary (cyan):    #22d3ee   Accent border, badges, active states
 *   Text:              #e2e8f0   Body text
 *   Muted:             #94a3b8   Secondary labels
 *   Background:        rgba(15,23,42,.88)  Dark glass card
 *   Border:            rgba(148,163,184,.12) Subtle separators
 */

import { markTranslated } from '../fingerprint.js';
import { t } from '../../shared/i18n.js';
import { logoBadge } from '../../shared/icons.js';

// Persisted across instances
let _stylesInjected = false;

function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const css = `
.wt-inline-block{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  margin:10px 0;border-radius:0 8px 8px 0;border-left:3px solid #22d3ee;
  background:rgba(15,23,42,.94);color:#e2e8f0;font-size:14px;line-height:1.65;
  box-shadow:0 0 16px rgba(34,211,238,.05),0 1px 4px rgba(0,0,0,.3);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  border:1px solid rgba(34,211,238,.08);border-left:3px solid #22d3ee;
  padding:12px 16px;word-break:break-word;
  animation:wt-fade-in .25s ease;}
@keyframes wt-fade-in{from{opacity:0}to{opacity:1}}
.wt-inline-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.wt-inline-badge{font-size:11px;font-weight:600;color:#22d3ee;text-transform:uppercase;letter-spacing:.5px;
  display:flex;align-items:center;gap:6px;}
.wt-inline-fold{background:rgba(15,23,42,.8);border:1px solid rgba(148,163,184,.25);border-radius:6px;
  padding:3px 10px;font-size:11px;cursor:pointer;color:#cbd5e1;transition:all .2s;}
.wt-inline-fold:hover{border-color:#22d3ee;color:#22d3ee;box-shadow:0 0 10px rgba(34,211,238,.1);}
.wt-inline-fold:focus-visible{outline:2px solid #22d3ee;outline-offset:1px;}
.wt-inline-body{font-size:14px;line-height:1.65;color:#e2e8f0;}
.wt-pending{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  margin:4px 0;padding:6px 12px;color:#94a3b8;font-size:12px;display:flex;align-items:center;gap:8px;
  animation:wt-fade-in .2s ease;}
.wt-spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(148,163,184,.2);
  border-top-color:#22d3ee;border-radius:50%;animation:wt-spin .7s linear infinite;}
@keyframes wt-spin{to{transform:rotate(360deg)}}
`;
  const st = document.createElement('style');
  st.id = 'wt-inline-styles';
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
}

export class InlineRenderer {

  render(originalEl, translation, paragraphId) {
    injectStyles();
    markTranslated(originalEl, paragraphId);
    this.removePending(originalEl);

    // Remove any adjacent wt-inline-block / wt-pending (duplicate guard)
    let sib = originalEl.nextElementSibling;
    while (sib && (sib.classList.contains('wt-inline-block') || sib.classList.contains('wt-pending'))) {
      const n = sib.nextElementSibling; sib.remove(); sib = n;
    }

    const card = document.createElement('div');
    card.className = 'wt-inline-block';
    card.dataset.wtId = paragraphId;

    card.innerHTML = `
      <div class="wt-inline-header">
        <span class="wt-inline-badge">${logoBadge(13)} ${t('inline.badge')}</span>
        <button class="wt-inline-fold">${t('inline.toggle_fold')}</button>
      </div>
      <div class="wt-inline-body">${escapeHtml(translation)}</div>`;

    card.querySelector('.wt-inline-fold').addEventListener('click', () => {
      const body = card.querySelector('.wt-inline-body');
      const btn = card.querySelector('.wt-inline-fold');
      const f = body.style.display === 'none';
      body.style.display = f ? '' : 'none';
      btn.textContent = f ? t('inline.toggle_fold') : t('inline.toggle_unfold');
    });

    originalEl.insertAdjacentElement('afterend', card);
    return card;
  }

  showPending(originalEl, paragraphId) {
    injectStyles();
    if (originalEl.nextElementSibling?.classList?.contains('wt-pending')) return;
    const el = document.createElement('div');
    el.className = 'wt-pending';
    el.dataset.wtId = paragraphId;
    el.innerHTML = `<span class="wt-spinner"></span> ${t('inline.translating')}`;
    originalEl.insertAdjacentElement('afterend', el);
  }

  removePending(originalEl) {
    const n = originalEl.nextElementSibling;
    if (n?.classList?.contains('wt-pending')) n.remove();
  }

  clearAll() {
    document.querySelectorAll('.wt-inline-block, .wt-pending').forEach(e => e.remove());
  }

  update(paragraphId, newTranslation) {
    const el = document.querySelector(`.wt-inline-block[data-wt-id="${paragraphId}"]`);
    if (!el) return;
    const body = el.querySelector('.wt-inline-body');
    if (body) body.innerHTML = escapeHtml(newTranslation);
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
