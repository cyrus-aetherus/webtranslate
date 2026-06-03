/**
 * WtTranslation - Custom element for inline translation rendering
 * Uses Shadow DOM for style isolation from host page.
 * Features:
 *   - Collapsible translation block
 *   - DOMPurify sanitization
 *   - Fold state persisted to chrome.storage.session
 */

import DOMPurify from 'dompurify';
import { t } from '../../shared/i18n.js';
import { logoBadge } from '../../shared/icons.js';

const PURIFY_CONFIG = {
  ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'code', 'pre', 'br', 'span', 'a'],
  ALLOWED_ATTR: ['href', 'class', 'title'],
};

const STORAGE_KEY_PREFIX = 'wt_fold_';

export class WtTranslation extends HTMLElement {
  static get observedAttributes() {
    return ['data-wt-id'];
  }

  constructor() {
    super();
    this._id = '';
    this._folded = false;
    this._shadow = this.attachShadow({ mode: 'open' });
    this._buildDom();
  }

  connectedCallback() {
    this._id = this.dataset.wtId || '';
    this._loadFoldState().catch(() => {});
  }

  /**
   * Set the translation content (sanitized).
   * @param {string} html
   */
  setTranslation(html) {
    const clean = DOMPurify.sanitize(html, PURIFY_CONFIG);
    this._body.innerHTML = clean;
  }

  /**
   * Toggle fold state.
   */
  toggle() {
    this._folded = !this._folded;
    this._body.classList.toggle('folded', this._folded);
    this._toggleBtn.textContent = this._folded ? t('inline.toggle_unfold') : t('inline.toggle_fold');
    this._persistFoldState().catch(() => {});
  }

  // ------------------------------------------------------------------
  // Shadow DOM rendering
  // ------------------------------------------------------------------

  _buildDom() {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        margin: 8px 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        animation: wt-fade-in .25s ease;
      }
      @keyframes wt-fade-in { from { opacity:0 } to { opacity:1 } }
      .wt-block {
        background: rgba(15,23,42,.94);
        border-left: 3px solid #22d3ee;
        border-radius: 0 8px 8px 0;
        padding: 10px 14px;
        color: #e2e8f0;
        font-size: 14px;
        line-height: 1.6;
        box-shadow: 0 0 16px rgba(34,211,238,.05), 0 1px 4px rgba(0,0,0,.3);
        border: 1px solid rgba(34,211,238,.08);
        border-left: 3px solid #22d3ee;
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
      }
      .wt-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
      }
      .wt-badge {
        font-size: 12px;
        font-weight: 600;
        color: #22d3ee;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .wt-badge svg { flex-shrink:0; }
      .wt-toggle {
        background: rgba(15,23,42,.8);
        border: 1px solid rgba(148,163,184,.25);
        border-radius: 4px;
        padding: 2px 8px;
        font-size: 12px;
        cursor: pointer;
        color: #cbd5e1;
        transition: all .2s;
      }
      .wt-toggle:focus-visible {
        outline: 2px solid #22d3ee; outline-offset: 1px;
      }
      .wt-toggle:hover {
        border-color: #22d3ee;
        color: #22d3ee;
        box-shadow: 0 0 10px rgba(34,211,238,.1);
      }
      .wt-body {
        word-break: break-word;
      }
      .wt-body.folded {
        display: none;
      }
      a {
        color: #22d3ee;
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      code {
        background: rgba(34,211,238,.08);
        padding: 2px 4px;
        border-radius: 4px;
        font-family: ui-monospace, SFMono-Regular, monospace;
        font-size: 12px;
        color: #67e8f9;
      }
      pre {
        background: rgba(34,211,238,.06);
        padding: 8px;
        border-radius: 6px;
        overflow-x: auto;
        border: 1px solid rgba(34,211,238,.1);
      }
    `;
    this._shadow.appendChild(style);

    const block = document.createElement('div');
    block.className = 'wt-block';
    block.innerHTML = `
      <div class="wt-header">
        <span class="wt-badge">${logoBadge(14)} <span class="wt-badge-text"></span></span>
        <button class="wt-toggle" type="button"></button>
      </div>
      <div class="wt-body"></div>
    `;
    this._shadow.appendChild(block);

    this._toggleBtn = block.querySelector('.wt-toggle');
    this._body = block.querySelector('.wt-body');
    this._badgeText = block.querySelector('.wt-badge-text');

    // Apply translated labels
    if (this._badgeText) this._badgeText.textContent = t('inline.badge');
    if (this._toggleBtn) this._toggleBtn.textContent = t('inline.toggle_fold');

    this._toggleBtn.addEventListener('click', () => this.toggle());
  }

  // ------------------------------------------------------------------
  // Fold state persistence
  // ------------------------------------------------------------------

  async _loadFoldState() {
    const key = STORAGE_KEY_PREFIX + this._id;
    const data = await chrome.storage.session.get(key);
    if (data[key] != null && data[key]) {
      this._folded = true;
      this._body.classList.add('folded');
      this._toggleBtn.textContent = t('inline.toggle_unfold');
    }
  }

  async _persistFoldState() {
    const key = STORAGE_KEY_PREFIX + this._id;
    await chrome.storage.session.set({ [key]: this._folded });
  }
}

// Register custom element. Use globalThis.customElements explicitly
// because bundled libraries may declare `let window` which shadows
// the browser global within the IIFE scope.
try {
  globalThis.customElements.define('wt-translation', WtTranslation);
} catch (e) {
  console.error('[WebTranslate] Failed to register wt-translation:', e.message);
}
