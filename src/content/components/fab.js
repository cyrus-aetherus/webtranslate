/**
 * FabComponent — Material 3 floating action button.
 *
 * Design language:
 *   White surface, subtle shadows, purple primary (#6750a4)
 *   Pill-shaped buttons (20px radius), 12px card corners
 *   Compact radial menu with clean labels & SVG line icons
 *   Context-aware dynamic menu — items change based on translation state
 *
 * Lifecycle: IDLE → TRANSLATING → PAUSED
 *   IDLE:         [Translate] [Panel]   Download, Settings
 *   TRANSLATING:  [Stop]       [Switch] Download, Settings
 *   PAUSED:       [Translate]  [Retranslate] [Clear] Download, Settings
 */

const SIZE = 44;
const STYLE_ID = 'wt-fab-css';

// Single <style> injected once
const CSS = `
#wt-fab-backdrop{position:fixed;inset:0;z-index:2147483645;pointer-events:none;
  background:transparent;transition:background .2s;}
#wt-fab-backdrop.open{pointer-events:auto;background:rgba(0,0,0,.15);}

#wt-fab{position:fixed;z-index:2147483647;width:${SIZE}px;height:${SIZE}px;
  border-radius:50%;cursor:pointer;user-select:none;touch-action:none;
  display:flex;align-items:center;justify-content:center;
  font-family:'Segoe UI Variable','Segoe UI',system-ui,-apple-system,sans-serif;
  background:#fff;
  box-shadow:0 1px 3px rgba(0,0,0,.12),0 4px 12px rgba(0,0,0,.08);
  transition:transform .2s,box-shadow .2s;}
#wt-fab:hover{transform:scale(1.08);box-shadow:0 2px 6px rgba(0,0,0,.14),0 6px 18px rgba(0,0,0,.1);}

/* ---- IDLE ---- */
#wt-fab.wt-idle .wt-fab-t{fill:#6750a4;}
#wt-fab.wt-idle .wt-fab-ring{stroke:#cac4d0;fill:none;}
#wt-fab.wt-idle .wt-fab-bracket{stroke:#cac4d0;fill:none;}

/* ---- ACTIVE (TRANSLATING) ---- */
#wt-fab.wt-active{background:#eaddff;}
#wt-fab.wt-active .wt-fab-t{fill:#6750a4;}
#wt-fab.wt-active .wt-fab-ring{stroke:#6750a4;fill:none;}
#wt-fab.wt-active .wt-fab-bracket{stroke:#6750a4;fill:none;}

/* ---- PAUSED ---- */
#wt-fab.wt-paused{background:#fef7e0;}
#wt-fab.wt-paused .wt-fab-t{fill:#795600;}
#wt-fab.wt-paused .wt-fab-ring{stroke:#795600;fill:none;}
#wt-fab.wt-paused .wt-fab-bracket{stroke:#795600;fill:none;}

/* ---- ERROR ---- */
#wt-fab.wt-error{background:#f9dedc;}
#wt-fab.wt-error .wt-fab-t{fill:#b3261e;}
#wt-fab.wt-error .wt-fab-ring{stroke:#b3261e;fill:none;}
#wt-fab.wt-error .wt-fab-bracket{stroke:#b3261e;fill:none;}

/* ---- Mode badge ---- */
#wt-fab .wt-mode-badge{position:absolute;top:-2px;right:-2px;
  width:18px;height:18px;border-radius:50%;
  font-size:9px;font-weight:700;color:#fff;
  display:none;align-items:center;justify-content:center;
  box-shadow:0 1px 3px rgba(0,0,0,.2);}
#wt-fab.wt-idle .wt-mode-badge{background:#6750a4;}
#wt-fab.wt-active .wt-mode-badge{background:#6750a4;}
#wt-fab.wt-paused .wt-mode-badge{background:#795600;}
#wt-fab.wt-error .wt-mode-badge{background:#b3261e;}

/* ---- Menu items ---- */
.wt-fab-menu-item{position:absolute;display:flex;align-items:center;gap:8px;
  white-space:nowrap;cursor:pointer;pointer-events:auto;
  font-family:'Segoe UI Variable','Segoe UI',system-ui,-apple-system,sans-serif;
  font-size:13px;color:#1d1b20;transition:opacity .2s,transform .25s cubic-bezier(.2,0,0,1);}
.wt-fab-menu-item .wt-mi-dot{width:36px;height:36px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  background:#fff;flex-shrink:0;border:1px solid #e7e0ec;
  box-shadow:0 1px 3px rgba(0,0,0,.08);
  transition:background .15s,transform .15s;}
.wt-fab-menu-item:hover .wt-mi-dot{background:#eaddff;transform:scale(1.08);}
.wt-fab-menu-item .wt-mi-label{background:#fff;padding:5px 12px;border-radius:16px;
  border:1px solid #e7e0ec;font-weight:500;font-size:12px;color:#1d1b20;
  box-shadow:0 1px 3px rgba(0,0,0,.06);}

/* Primary action (main button — larger, emphasized) */
.wt-fab-menu-item.wt-primary .wt-mi-dot{width:42px;height:42px;
  background:#eaddff;border-color:#6750a4;}
.wt-fab-menu-item.wt-primary .wt-mi-label{font-weight:600;color:#6750a4;}
.wt-fab-menu-item.wt-primary:hover .wt-mi-dot{background:#6750a4;border-color:#6750a4;}
.wt-fab-menu-item.wt-primary:hover .wt-mi-dot svg{stroke:#fff;}
.wt-fab-menu-item.wt-primary:hover .wt-mi-label{background:#6750a4;color:#fff;}
.wt-fab-menu-item.wt-primary.wt-stop .wt-mi-dot{background:#f9dedc;border-color:#b3261e;}
.wt-fab-menu-item.wt-primary.wt-stop .wt-mi-label{color:#b3261e;font-weight:600;}
.wt-fab-menu-item.wt-primary.wt-stop:hover .wt-mi-dot{background:#b3261e;border-color:#b3261e;}
.wt-fab-menu-item.wt-primary.wt-stop:hover .wt-mi-dot svg{stroke:#fff;}
.wt-fab-menu-item.wt-primary.wt-stop:hover .wt-mi-label{background:#b3261e;color:#fff;}

.wt-fab-menu-item.wt-active-mode .wt-mi-dot{background:#eaddff;border-color:#6750a4;}

/* Focus-visible */
#wt-fab:focus-visible{outline:2px solid #6750a4;outline-offset:3px;}
`;

// Logo-matching SVG: white "T" + reticle ring + four corner brackets
const SVG_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
  <path class="wt-fab-bracket" d="M2 7V2h5" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path class="wt-fab-bracket" d="M17 2h5v5" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path class="wt-fab-bracket" d="M2 17v5h5" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  <path class="wt-fab-bracket" d="M17 22h5v-5" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  <circle class="wt-fab-ring" cx="12" cy="12" r="6.5" stroke-width="1.5"/>
  <path class="wt-fab-t" d="M8.5 8.5h7v1.4h-2.8v5.6h-1.4V9.9H8.5z"/>
</svg>`;

// SVG line icons for radial menu
const MENU_ICONS = {
  translate: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#49454f" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/>
    <path d="M2 5h12"/><path d="M7 2h1"/>
    <path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/>
  </svg>`,
  panel: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#49454f" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <line x1="9" y1="3" x2="9" y2="21"/>
  </svg>`,
  download: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#49454f" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>`,
  settings: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#49454f" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
    <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
    <line x1="1" y1="14" x2="7" y2="14"/>
    <line x1="9" y1="8" x2="15" y2="8"/>
    <line x1="17" y1="16" x2="23" y2="16"/>
  </svg>`,
  stop: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b3261e" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>`,
  retranslate: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#49454f" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="23 4 23 10 17 10"/>
    <polyline points="1 20 1 14 7 14"/>
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
  </svg>`,
  clear: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#49454f" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
  </svg>`,
};

/**
 * Build the menu item list based on current state and mode.
 * @param {string} state - 'IDLE' | 'TRANSLATING' | 'PAUSED' | 'ERROR'
 * @param {string} mode - 'inline' | 'panel'
 * @returns {{icon:string, i18nKey:string, cls:string, primary:boolean}[]}
 */
function getMenuItems(state, mode) {
  switch (state) {
    case 'IDLE': {
      const otherMode = mode === 'panel' ? 'inline' : 'panel';
      const otherLabel = mode === 'panel' ? 'fab.translate_inline' : 'fab.translate_panel';
      return [
        { icon: MENU_ICONS.translate, i18nKey: 'fab.translate', cls: 'wt-translate', primary: true },
        { icon: MENU_ICONS.panel, i18nKey: otherLabel, cls: `wt-switch-${otherMode}`, primary: false },
        { icon: MENU_ICONS.download, i18nKey: 'fab.download', cls: 'wt-download', primary: false },
        { icon: MENU_ICONS.settings, i18nKey: 'fab.settings', cls: 'wt-settings', primary: false },
      ];
    }
    case 'TRANSLATING':
    case 'SCANNING': {
      const otherMode = mode === 'panel' ? 'inline' : 'panel';
      const switchLabel = mode === 'panel' ? 'fab.switch_to_inline' : 'fab.switch_to_panel';
      const switchIcon = mode === 'panel' ? MENU_ICONS.translate : MENU_ICONS.panel;
      return [
        { icon: MENU_ICONS.stop, i18nKey: 'fab.stop', cls: 'wt-stop', primary: true },
        { icon: switchIcon, i18nKey: switchLabel, cls: `wt-switch-${otherMode}`, primary: false },
        { icon: MENU_ICONS.download, i18nKey: 'fab.download', cls: 'wt-download', primary: false },
        { icon: MENU_ICONS.settings, i18nKey: 'fab.settings', cls: 'wt-settings', primary: false },
      ];
    }
    case 'PAUSED': {
      return [
        { icon: MENU_ICONS.translate, i18nKey: 'fab.translate', cls: 'wt-translate', primary: true },
        { icon: MENU_ICONS.retranslate, i18nKey: 'fab.retranslate', cls: 'wt-retranslate', primary: false },
        { icon: MENU_ICONS.clear, i18nKey: 'fab.clear', cls: 'wt-clear', primary: false },
        { icon: MENU_ICONS.download, i18nKey: 'fab.download', cls: 'wt-download', primary: false },
        { icon: MENU_ICONS.settings, i18nKey: 'fab.settings', cls: 'wt-settings', primary: false },
      ];
    }
    case 'ERROR':
    default: {
      return [
        { icon: MENU_ICONS.translate, i18nKey: 'fab.translate', cls: 'wt-translate', primary: true },
        { icon: MENU_ICONS.clear, i18nKey: 'fab.clear', cls: 'wt-clear', primary: false },
        { icon: MENU_ICONS.download, i18nKey: 'fab.download', cls: 'wt-download', primary: false },
        { icon: MENU_ICONS.settings, i18nKey: 'fab.settings', cls: 'wt-settings', primary: false },
      ];
    }
  }
}

export class FabComponent {
  constructor(opts = {}) {
    this.onTranslate   = opts.onTranslate   ?? (() => {});
    this.onPanel        = opts.onPanel        ?? (() => {});
    this.onDownload     = opts.onDownload     ?? (() => {});
    this.onSettings     = opts.onSettings     ?? (() => {});
    this.onStop         = opts.onStop         ?? (() => {});
    this.onSwitchMode   = opts.onSwitchMode   ?? (() => {});
    this.onRetranslate  = opts.onRetranslate  ?? (() => {});
    this.onClear        = opts.onClear        ?? (() => {});

    this.el = null; this.menuEl = null; this._badgeEl = null;
    this._open = false; this._dragging = false; this._longTimer = null;
    this._pos = { x: 0, y: 0 }; this._offset = { x: 0, y: 0 }; this._start = { x: 0, y: 0 };
    this._boundMove = this._onMove.bind(this); this._boundUp = this._onUp.bind(this);
    this._labelEls = []; this._menuItems = null;
    this._currentState = 'IDLE'; this._currentMode = 'inline';
  }

  mount() {
    this._pos = { x: innerWidth - SIZE - 24, y: innerHeight - SIZE - 32 };
    this._injectStyles();
    this._createFab();
    this._createMenu('IDLE', 'inline');
    document.body.appendChild(this.el);
    document.body.appendChild(this.menuEl);
    this._loadPosition();
    this._listenLangChange();
  }
  dispose() { this.el?.remove(); this.menuEl?.remove(); document.getElementById(STYLE_ID)?.remove(); document.removeEventListener('mousemove', this._boundMove); document.removeEventListener('mouseup', this._boundUp); if (this._storageListener && chrome.storage?.onChanged) chrome.storage.onChanged.removeListener(this._storageListener); }

  /** Re-read i18n labels and update menu text. Call after i18n.init() or language change. */
  updateLabels(t) {
    this._labelEls.forEach((el, i) => {
      const key = el.dataset?.wtI18nKey;
      if (!key) return;
      const text = t(key);
      if (text && text !== key) el.textContent = text;
    });
  }

  highlightMode(mode) {
    this.menuEl?.querySelectorAll('.wt-fab-menu-item').forEach(e => e.classList.remove('wt-active-mode'));
    if (!mode) return;
    const sel = mode === 'panel' ? '.wt-switch-panel' : '.wt-switch-inline';
    this.menuEl?.querySelector(sel)?.classList.add('wt-active-mode');
  }

  setState(s) {
    this.el?.classList.remove('wt-idle', 'wt-active', 'wt-paused', 'wt-error');
    this.el?.classList.add('wt-' + s);
  }

  /**
   * Update the badge on the FAB showing current mode ('I' or 'P').
   * @param {string} mode - 'inline' | 'panel'
   */
  setModeBadge(mode) {
    if (!this._badgeEl) return;
    if (mode === 'panel') {
      this._badgeEl.textContent = 'P';
      this._badgeEl.style.display = 'flex';
    } else if (mode === 'inline') {
      this._badgeEl.textContent = 'I';
      this._badgeEl.style.display = 'flex';
    } else {
      this._badgeEl.style.display = 'none';
    }
  }

  /**
   * Rebuild the menu for a new state / mode. The FAB must already be mounted.
   * @param {string} state
   * @param {string} mode
   */
  updateMenu(state, mode) {
    this._currentState = state;
    this._currentMode = mode;

    // Remove old menu items
    if (this._menuEl) {
      const oldItems = this.menuEl.querySelectorAll('.wt-fab-menu-item');
      oldItems.forEach(el => el.remove());
    }
    this._labelEls = [];

    // Build new items
    const items = getMenuItems(state, mode);
    if (!this._menuEl) return;

    const wrap = this.menuEl;
    const activators = this._buildActivators(items);

    items.forEach((it, i) => {
      const d = document.createElement('div');
      d.className = `wt-fab-menu-item ${it.cls}`;
      if (it.primary) d.classList.add('wt-primary');
      d.innerHTML = `<span class="wt-mi-dot">${it.icon}</span><span class="wt-mi-label" data-wt-i18n-key="${it.i18nKey}">${it.i18nKey}</span>`;
      d.style.opacity = this._open ? '1' : '0';
      d.style.transform = this._open ? 'scale(1)' : 'scale(0.3)';
      d.addEventListener('click', e => { e.stopPropagation(); this._close(); activators[i](); });
      wrap.appendChild(d);
      this._labelEls.push(d.querySelector('.wt-mi-label'));
    });

    this._menuItems = wrap.querySelectorAll('.wt-fab-menu-item');

    // Re-position if open
    if (this._open) {
      this._positionMenuItems();
    }
  }

  _buildActivators(items) {
    return items.map(it => {
      switch (it.cls) {
        case 'wt-translate': return this.onTranslate;
        case 'wt-switch-inline': return this.onSwitchMode;
        case 'wt-switch-panel': return this.onSwitchMode;
        case 'wt-stop': return this.onStop;
        case 'wt-retranslate': return this.onRetranslate;
        case 'wt-clear': return this.onClear;
        case 'wt-download': return this.onDownload;
        case 'wt-settings': return this.onSettings;
        default: return () => {};
      }
    });
  }

  // ---- internal ------------------------------------------------------------

  _injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style'); s.id = STYLE_ID; s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  _createFab() {
    const btn = document.createElement('div');
    btn.id = 'wt-fab'; btn.className = 'wt-idle'; btn.tabIndex = 0;
    btn.innerHTML = SVG_ICON;
    btn.title = 'WebTranslate';
    // Mode badge
    const badge = document.createElement('span');
    badge.className = 'wt-mode-badge';
    badge.textContent = 'I';
    btn.appendChild(badge);
    this._badgeEl = badge;
    btn.addEventListener('mousedown', e => this._onDown(e));
    btn.addEventListener('touchstart', e => this._onTouch(e), { passive: false });
    btn.addEventListener('click', e => { if (!this._dragging) { e.stopPropagation(); this._toggle(); } });
    btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._toggle(); } });
    this.el = btn;
  }

  _createMenu(state, mode) {
    const wrap = document.createElement('div'); wrap.id = 'wt-fab-backdrop';
    const menu = document.createElement('div');
    menu.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;';
    wrap.appendChild(menu);
    wrap.addEventListener('click', () => this._close());
    this.menuEl = wrap; this._menuContainer = menu;
    // Build initial items
    const items = getMenuItems(state, mode);
    const activators = this._buildActivators(items);
    items.forEach((it, i) => {
      const d = document.createElement('div');
      d.className = `wt-fab-menu-item ${it.cls}`;
      if (it.primary) d.classList.add('wt-primary');
      d.innerHTML = `<span class="wt-mi-dot">${it.icon}</span><span class="wt-mi-label" data-wt-i18n-key="${it.i18nKey}">${it.i18nKey}</span>`;
      d.style.opacity = '0'; d.style.transform = 'scale(0.3)';
      d.addEventListener('click', e => { e.stopPropagation(); this._close(); activators[i](); });
      this._menuContainer.appendChild(d);
      this._labelEls.push(d.querySelector('.wt-mi-label'));
    });
    this._menuItems = this._menuContainer.querySelectorAll('.wt-fab-menu-item');
  }

  _positionMenuItems() {
    if (!this._menuItems?.length) return;
    const r = this.el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const N = this._menuItems.length;
    // Dynamic radius: primary buttons get more spacing
    const R = N >= 5 ? 155 : 140;

    this._menuItems.forEach((el, i) => {
      const a = Math.PI + (i - (N - 1) / 2) * (Math.PI / (N + 2));
      el.style.left = (cx + Math.cos(a) * R - 18) + 'px';
      el.style.top  = (cy + Math.sin(a) * R - 18) + 'px';
      el.style.opacity = '1'; el.style.transform = 'scale(1)';
    });
  }

  _toggle() { this._open ? this._close() : this._openMenu(); }
  _openMenu() {
    this._open = true;
    this._positionMenuItems();
    this.menuEl.classList.add('open');
  }
  _close() {
    this._open = false; this.menuEl.classList.remove('open');
    if (this._menuItems) {
      this._menuItems.forEach(e => { e.style.opacity = '0'; e.style.transform = 'scale(0.3)'; });
    }
  }

  _onDown(e) { if (e.button) return; this._startDrag(e.clientX, e.clientY); document.addEventListener('mousemove', this._boundMove); document.addEventListener('mouseup', this._boundUp); }
  _onTouch(e) { if (e.touches.length !== 1) return; e.preventDefault(); this._startDrag(e.touches[0].clientX, e.touches[0].clientY); document.addEventListener('touchend', this._boundUp, { once: true }); }
  _startDrag(cx, cy) { this._dragging = false; this._start = { x: cx, y: cy }; this._offset = { x: cx - this.el.offsetLeft, y: cy - this.el.offsetTop }; this._longTimer = setTimeout(() => { this._dragging = true; }, 180); }
  _onMove(e) { if (!this._dragging) { if (Math.hypot(e.clientX - this._start.x, e.clientY - this._start.y) < 5) return; this._dragging = true; } e.preventDefault(); this._setPos(e.clientX - this._offset.x, e.clientY - this._offset.y); }
  _onUp() { clearTimeout(this._longTimer); document.removeEventListener('mousemove', this._boundMove); document.removeEventListener('mouseup', this._boundUp); if (this._dragging) this._savePosition(); }
  _setPos(x, y) { x = Math.max(0, Math.min(x, innerWidth - SIZE)); y = Math.max(0, Math.min(y, innerHeight - SIZE)); this._pos = { x, y }; this.el.style.left = x + 'px'; this.el.style.top = y + 'px'; }
  async _savePosition() { try { await chrome.storage.local.set({ wt_fab_pos: this._pos }); } catch {} }
  async _loadPosition() { try { const d = await chrome.storage.local.get('wt_fab_pos'); if (d.wt_fab_pos) this._setPos(d.wt_fab_pos.x, d.wt_fab_pos.y); } catch {} }

  /** Listen for language changes in storage and update labels. */
  _listenLangChange() {
    if (!chrome.storage?.onChanged) return;
    this._storageListener = (changes, area) => {
      if (area !== 'local' || !changes.wt_language) return;
      window.dispatchEvent(new CustomEvent('wt-language-changed', { detail: changes.wt_language.newValue }));
    };
    chrome.storage.onChanged.addListener(this._storageListener);
  }
}
