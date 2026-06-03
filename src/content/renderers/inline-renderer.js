/**
 * InlineRenderer — Material 3 translation blocks.
 *
 * Colour palette:
 *   Primary:     #6750a4   Badges, accents, links
 *   Surface:     #ffffff   Card background
 *   Text:        #1d1b20   Body text
 *   Muted:       #79747e   Secondary labels
 *   Border:      #e7e0ec   Outlines
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
.wt-inline-block{font-family:'Segoe UI Variable','Segoe UI',system-ui,-apple-system,sans-serif;
  margin:10px 0;border-radius:12px;border:1px solid #e7e0ec;
  background:#fff;color:#1d1b20;font-size:14px;line-height:1.65;
  box-shadow:0 1px 3px rgba(0,0,0,.06);
  padding:12px 16px;word-break:break-word;
  animation:wt-fade-in .2s ease;}
@keyframes wt-fade-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
.wt-inline-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;}
.wt-inline-badge{font-size:11px;font-weight:500;color:#6750a4;letter-spacing:.3px;
  display:flex;align-items:center;gap:6px;}
.wt-inline-fold{background:#fff;border:1px solid #cac4d0;border-radius:16px;
  padding:3px 12px;font-size:11px;font-weight:500;cursor:pointer;color:#6750a4;transition:background .15s;}
.wt-inline-fold:hover{background:#eaddff;}
.wt-inline-fold:focus-visible{outline:2px solid #6750a4;outline-offset:1px;}
.wt-inline-body{font-size:14px;line-height:1.65;color:#1d1b20;}
.wt-pending{font-family:'Segoe UI Variable','Segoe UI',system-ui,-apple-system,sans-serif;
  margin:4px 0;padding:6px 12px;color:#79747e;font-size:12px;display:flex;align-items:center;gap:8px;
  animation:wt-fade-in .2s ease;}
.wt-spinner{display:inline-block;width:14px;height:14px;border:2px solid #e7e0ec;
  border-top-color:#6750a4;border-radius:50%;animation:wt-spin .7s linear infinite;}
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
