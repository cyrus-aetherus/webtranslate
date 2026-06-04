/**
 * Content Script entry for WebTranslate
 * Lifecycle:
 *   1. Detect tabId
 *   2. Initialize StateManager, BatchCollector, CacheManager, Renderers
 *   3. Inject FAB (Floating Action Button)
 *   4. Listen for SW messages and user interactions
 */

import { MSG, State } from '../shared/constants.js';
import { extractParagraphs, getTranslatableText, generateParagraphId } from './extractor/index.js';
import { computeFingerprint, markTranslated } from './fingerprint.js';
import { BatchCollector } from './batch-collector.js';
import { ObserverManager } from './observer-manager.js';
import { StateManager } from './state-manager.js';
import { CacheManager } from './cache-manager.js';
import { ConcurrencyController } from './concurrency-controller.js';
import { CircuitBreaker } from './circuit-breaker.js';
import { InlineRenderer } from './renderers/inline-renderer.js';
import { PanelRenderer } from './renderers/panel-renderer.js';
import { init as initI18n, t } from '../shared/i18n.js';
import { FabComponent } from './components/fab.js';
import { generateMarkdown, collectImageUrls, triggerDownload } from './download-trigger.js';

// ------------------------------------------------------------------
// Global instances
// ------------------------------------------------------------------

let TAB_ID = -1;
let stateManager;
let batchCollector;
let observerManager;
let cacheManager;
let concurrencyController;
let circuitBreaker;
let fabComponent;
let inlineRenderer;
let panelRenderer;
let currentMode = 'inline'; // 'inline' | 'panel'

async function init() {
  // --- Phase 1: Mount FAB immediately (synchronous, before any await) ---
  // This ensures the user sees the button even if async steps hang.
  fabComponent = new FabComponent({
    onTranslate: () => {
      const st = stateManager?.get();
      if (st === State.TRANSLATING || st === State.SCANNING) return;
      if (st === State.PAUSED) startTranslation(currentMode);
      else startTranslation(currentMode || 'inline');
    },
    onPanel: () => {
      const st = stateManager?.get();
      if (st === State.TRANSLATING || st === State.SCANNING) return;
      startTranslation('panel');
    },
    onSwitchMode: () => {
      const to = currentMode === 'panel' ? 'inline' : 'panel';
      switchMode(to);
    },
    onDownload: () => handleDownload(),
    onSettings: () => {
      try { chrome.action?.openPopup?.(); } catch (e) {}
      try { chrome.runtime.sendMessage({ type: MSG.OPEN_PANEL }); } catch {}
    },
    onStop: () => stopTranslation(),
    onRetranslate: () => retranslate(currentMode),
    onClear: () => clearTranslations(),
  });
  fabComponent.mount(); // creates FAB immediately; loads saved position in background

  // --- Phase 2: Async setup (non-blocking for FAB visibility) ---
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_TAB_ID' });
    TAB_ID = res?.tabId ?? -1;
  } catch {
    TAB_ID = -1;
  }

  // Init i18n in background; use English fallback until ready
  initI18n().then(() => {
    fabComponent?.updateLabels(t);
  }).catch(() => {});

  // Re-apply FAB labels when language changes
  window.addEventListener('wt-language-changed', async (e) => {
    try {
      await initI18n(e.detail);
      fabComponent?.updateLabels(t);
    } catch {}
  });

  stateManager = new StateManager();
  stateManager.onChange((to, from) => {
    updateFabState(to, from);
    if (to === State.PAUSED && from === State.TRANSLATING) {
      concurrencyController.cancelQueued();
    }
  });

  cacheManager = new CacheManager();
  await cacheManager.load();

  batchCollector = new BatchCollector(
    (batch) => onBatchReady(batch),
    { maxBatchChars: 800, maxBatchItems: 8, debounceMs: 100 }
  );

  observerManager = new ObserverManager(batchCollector);

  concurrencyController = new ConcurrencyController(3);

  circuitBreaker = new CircuitBreaker({
    threshold: 5,
    onOpen: () => {
      console.warn('[WT] Circuit breaker tripped after 5 consecutive failures');
      stateManager.transition(State.PAUSED);
    },
  });

  inlineRenderer = new InlineRenderer();
  panelRenderer = new PanelRenderer(TAB_ID);

  // Listen for SW messages
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === MSG.TRANSLATE_BATCH_RESULT) {
      handleBatchResult(msg);
    }
    if (msg.type === MSG.DOWNLOAD_PROGRESS) {
      updateDownloadProgress(msg);
    }
  });

  // Watch for API config changes — auto-start translation when user
  // saves API settings after a failed attempt.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !window._wt_pendingTranslate) return;
      if (!changes.apiUrl?.newValue && !changes.apiKey?.newValue && !changes.model?.newValue) return;
      // Check all three are now configured
      chrome.storage.local.get(['apiUrl', 'apiKey', 'model']).then(cfg => {
        if (cfg.apiUrl && cfg.apiKey && cfg.model && window._wt_pendingTranslate) {
          const mode = window._wt_pendingTranslate;
          delete window._wt_pendingTranslate;
          startTranslation(mode);
        }
      }).catch(() => {});
    });
  } catch {}

  console.log(`[WebTranslate] Content script initialized (tab=${TAB_ID})`);
}

function updateFabState(to, from) {
  if (!fabComponent) return;
  // Map state-machine states to FAB visual states + rebuild menu context
  switch (to) {
    case State.TRANSLATING:
    case State.SCANNING:
      fabComponent.setState('active');
      fabComponent.setModeBadge(currentMode);
      fabComponent.updateMenu('TRANSLATING', currentMode);
      fabComponent.updateLabels(t);
      break;
    case State.PAUSED:
      fabComponent.setState('paused');
      fabComponent.setModeBadge(null);
      fabComponent.updateMenu('PAUSED', currentMode);
      fabComponent.updateLabels(t);
      // Auto-expand menu so user discovers Clear/Retranslate
      fabComponent.pulse();
      setTimeout(() => fabComponent.autoExpand(3000), 400);
      break;
    case State.ERROR:
      fabComponent.setState('error');
      fabComponent.setModeBadge(null);
      fabComponent.updateMenu('ERROR', currentMode);
      fabComponent.updateLabels(t);
      break;
    default:
      fabComponent.setState('idle');
      fabComponent.setModeBadge(currentMode);
      fabComponent.updateMenu('IDLE', currentMode);
      fabComponent.updateLabels(t);
      break;
  }
}

async function handleDownload() {
  fabComponent?.setState('active');
  try {
    const title = document.title || 'page';
    const markdown = generateMarkdown();
    const imageUrls = collectImageUrls();
    await triggerDownload(title, markdown, imageUrls);
  } catch (err) {
    console.error('[WT] Download failed:', err);
    fabComponent?.setState('error');
    setTimeout(() => updateFabState(stateManager.get()), 2000);
  }
}

function updateDownloadProgress(msg) {
  if (msg.stage === 'done') {
    setTimeout(() => updateFabState(stateManager.get()), 2000);
  }
}

// ------------------------------------------------------------------
// Batch lifecycle
// ------------------------------------------------------------------

// Map of pending batch items (batchId → items array), used when SW
// pushes results via tabs.sendMessage instead of sendResponse.
const _pendingBatches = new Map();
// Set of fingerprints currently awaiting API results — prevents
// duplicate submissions on rapid scroll.
const _pendingFingerprints = new Set();
// Callback for sequential top-down batch processing (set by startTranslation)
let _onBatchDone = null;

function onBatchReady(batch) {
  if (stateManager.get() === State.PAUSED) return;

  // Check cache first (L2 dedup)
  const uncached = [];
  for (const item of batch) {
    const cached = cacheManager.get(item.fingerprint);
    if (cached) {
      if (currentMode === 'inline') {
        inlineRenderer.render(item.element, cached, item.id);
      } else {
        panelRenderer.renderBatch([{
          id: item.id, original: item.text, translation: cached,
        }]);
      }
    } else {
      uncached.push(item);
    }
  }

  if (!uncached.length) return;

  // Show spinners for items being sent to API
  if (currentMode === 'inline') {
    for (const it of uncached) inlineRenderer.showPending(it.element, it.id);
  }

  concurrencyController.run(async () => {
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    // Track pending fingerprints to prevent double-submission on fast scroll
    for (const it of uncached) _pendingFingerprints.add(it.fingerprint);
    _pendingBatches.set(batchId, uncached);

    try {
      await chrome.runtime.sendMessage({
        type: MSG.TRANSLATE_BATCH,
        tabId: TAB_ID,
        batchId,
        items: uncached.map((it) => ({
          id: it.id, fingerprint: it.fingerprint, text: it.text,
        })),
      });
    } catch (err) {
      console.error('[WT] Batch failed:', err.message);
      circuitBreaker.recordFailure();
      for (const it of uncached) _pendingFingerprints.delete(it.fingerprint);
      _pendingBatches.delete(batchId);
    }
  });
}

function handleBatchResult(msg) {
  const { batchId, results, error } = msg;
  const items = _pendingBatches.get(batchId);
  _pendingBatches.delete(batchId);

  // Clean up pending fingerprints
  if (items) for (const it of items) _pendingFingerprints.delete(it.fingerprint);

  if (error || !results) {
    console.error('[WT] Batch result error:', error);
    circuitBreaker?.recordFailure();
    return;
  }

  circuitBreaker?.recordSuccess();
  for (const r of results) {
    const original = items?.find((u) => u.id === r.id);
    if (!original) continue;
    cacheManager.set(original.fingerprint, r.translation);
    if (currentMode === 'inline') {
      inlineRenderer.render(original.element, r.translation, original.id);
    } else {
      panelRenderer.renderBatch([{
        id: original.id, original: original.text, translation: r.translation,
      }]);
    }
  }
  // Trigger sequential batch processor
  if (_onBatchDone) { const cb = _onBatchDone; _onBatchDone = null; try { cb(); } catch {} }
}

// ------------------------------------------------------------------
// Translation start / stop
// ------------------------------------------------------------------

/** Stop translation, clean up all observers & timers, transition to PAUSED. */
function stopTranslation() {
  batchCollector?.stop();
  observerManager?.stop();
  concurrencyController?.cancelQueued();
  if (window._wtDisposeScroll) { window._wtDisposeScroll.forEach(fn => fn()); window._wtDisposeScroll = []; }
  _pendingFingerprints.clear();
  _pendingBatches.clear();
  _onBatchDone = null;
  chrome.runtime.sendMessage({ type: MSG.STOP_ALL, tabId: TAB_ID || 0 });
  chrome.storage.session.set({ wt_active: false }).catch(() => {});
  // Transition to PAUSED instead of IDLE — keeps translated DOM visible,
  // allows user to Clear, Retranslate, or Resume.
  stateManager?.transition(State.PAUSED);
  fabComponent?.highlightMode(null);
  fabComponent?.setState('paused');
  panelRenderer?.dispose();
}

/** Clear all inline translation blocks from DOM, keep cache, go IDLE. */
function clearTranslations() {
  inlineRenderer?.clearAll(); // also clears wtDone markers
  stateManager?.transition(State.IDLE);
  fabComponent?.setState('idle');
}

/** Clear DOM + cache, then restart translation with fresh API calls. */
function retranslate(mode) {
  inlineRenderer?.clearAll();
  cacheManager?.clear();
  // Clear pending state
  _pendingFingerprints.clear();
  _pendingBatches.clear();
  _onBatchDone = null;
  stateManager?.transition(State.IDLE);
  startTranslation(mode);
}

/** Switch from Inline to Panel or vice versa without stopping translation. */
function switchMode(to) {
  // Clear DOM from the departing mode
  if (currentMode === 'inline' && to === 'panel') {
    inlineRenderer?.clearAll();
  }
  if (currentMode === 'panel' && to === 'inline') {
    panelRenderer?.dispose();
  }

  // Stop active pipeline without flashing IDLE state on FAB.
  // startTranslation() handles the SCANNING→TRANSLATING transition itself
  // and returns early if another batch is already in flight.
  batchCollector?.stop();
  observerManager?.stop();
  concurrencyController?.cancelQueued();
  if (window._wtDisposeScroll) { window._wtDisposeScroll.forEach(fn => fn()); window._wtDisposeScroll = []; }
  _pendingFingerprints.clear();
  _pendingBatches.clear();
  _onBatchDone = null;
  chrome.runtime.sendMessage({ type: MSG.STOP_ALL, tabId: TAB_ID || 0 });

  // Set mode BEFORE startTranslation so it picks up the correct mode
  currentMode = to;
  startTranslation(to);
}

async function startTranslation(mode = currentMode) {
  currentMode = mode;

  // Persist active state so translation auto-starts on next visit
  // Use session storage — scoped to this tab/window, won't auto-start in new tabs.
  chrome.storage.session.set({ wt_active: true, wt_autoMode: mode }).catch(() => {});
  fabComponent?.highlightMode(mode);
  // Set active state immediately (belt-and-suspenders)
  fabComponent?.setState('active');

  // If already translating, stop first then restart
  if (stateManager.get() !== State.IDLE) {
    batchCollector?.stop();
    observerManager?.stop();
    concurrencyController?.cancelQueued();
    if (window._wtDisposeScroll) { window._wtDisposeScroll.forEach(fn => fn()); window._wtDisposeScroll = []; }
    chrome.runtime.sendMessage({ type: MSG.STOP_ALL, tabId: TAB_ID || 0 });
    stateManager.transition(State.IDLE);
  }

  if (!stateManager.transition(State.SCANNING)) return;

  // Pre-check: warn if API is not configured
  const config = await chrome.storage.local.get(['apiUrl', 'apiKey', 'model']);
  if (!config.apiUrl || !config.apiKey || !config.model) {
    showConfigToast();
    stateManager.transition(State.IDLE);
    return;
  }

  const paragraphs = extractParagraphs();
  if (!paragraphs.length) {
    console.warn('[WT] No translatable content found');
    stateManager.transition(State.IDLE);
    return;
  }

  // For panel mode, open the side panel first.
  // If the panel cannot be opened (sidePanel permission not granted, or
  // API not available), fall back to inline mode and let the user know.
  if (currentMode === 'panel') {
    const opened = await panelRenderer.open();
    if (!opened) {
      currentMode = 'inline';
      fabComponent?.setModeBadge('inline');
      fabComponent?.updateMenu('IDLE', 'inline');
      fabComponent?.updateLabels(t);
      showPanelUnavailableToast();
    }
  }

  // Build items sorted top-down by DOM position
  const items = paragraphs.map((el) => {
    const id = generateParagraphId(el);
    const fingerprint = computeFingerprint(el);
    const text = getTranslatableText(el);
    return { id, fingerprint, text, element: el };
  }).sort((a, b) => {
    const pos = a.element.compareDocumentPosition(b.element);
    return (pos & Node.DOCUMENT_POSITION_PRECEDING) ? 1 : -1;
  });

  batchCollector.start();
  observerManager.start(document.body);

  for (const item of items) {
    batchCollector.observeElement(item.element, {
      id: item.id, fingerprint: item.fingerprint, text: item.text,
    });
  }

  // Translate top-down, one batch at a time, showing progress bar
  let _totalDone = 0;
  const _total = items.length;

  // Fixed progress bar (top of page, survives SPA DOM recycling)
  const _progressBar = document.createElement('div');
  _progressBar.className = 'wt-progress';
  _progressBar.innerHTML = '<div class="wt-progress-inner"></div><span class="wt-progress-label"></span>';
  Object.assign(_progressBar.style, {
    position:'fixed',top:'0',left:'0',right:'0',height:'4px',zIndex:'2147483646',
    background:'#e5e7eb',pointerEvents:'none',
  });
  const _progressFill = _progressBar.firstChild;
  Object.assign(_progressFill.style, {
    height:'100%',width:'0%',background:'linear-gradient(90deg,#6366f1,#818cf8)',
    transition:'width .35s ease',
  });
  const _progressLabel = _progressBar.lastChild;
  Object.assign(_progressLabel.style, {
    position:'fixed',top:'8px',left:'50%',transform:'translateX(-50%)',
    fontSize:'12px',fontWeight:'600',color:'#6366f1',
    fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif',
  });
  document.body.appendChild(_progressBar);

  const _updateProgress = () => {
    const pct = Math.round((_totalDone / _total) * 100);
    _progressFill.style.width = pct + '%';
    _progressLabel.textContent = pct >= 100 ? '' : `${_totalDone} / ${_total}`;
    if (pct >= 100) {
      setTimeout(() => { _progressBar.remove(); }, 600);
    }
  };

  // Sequential batch processor: sends 8 items at a time, waits for result
  const _processNextBatch = () => {
    if (stateManager.get() !== State.TRANSLATING) return;
    const batch = [];
    for (const it of items) {
      if (it.element.dataset.wtDone || _pendingFingerprints.has(it.fingerprint)) continue;
      const cached = cacheManager?.get(it.fingerprint);
      if (cached) {
        markTranslated(it.element, it.fingerprint);
        if (currentMode === 'inline') {
          inlineRenderer.render(it.element, cached, it.id);
        } else {
          panelRenderer.renderBatch([{ id: it.id, original: it.text, translation: cached }]);
        }
        _totalDone++;
        continue;
      }
      batch.push(it);
      if (batch.length >= 8) break;
    }
    if (!batch.length) { _updateProgress(); _onBatchDone = null; return; }
    _onBatchDone = () => { _updateProgress(); setTimeout(() => _processNextBatch(), 80); };
    onBatchReady(batch);
  };

  // Scroll-driven scanner: re-render cached, submit new batches
  const _flushVisible = () => {
    if (stateManager.get() !== State.TRANSLATING) return;
    const fresh = extractParagraphs();
    const needs = [];
    for (const el of fresh) {
      const fp = computeFingerprint(el);
      const rect = el.getBoundingClientRect();
      if (rect.top >= window.innerHeight + 400 || rect.bottom <= -400) continue;
      if (_pendingFingerprints.has(fp)) continue;
      const cached = cacheManager?.get(fp);
      if (cached) {
        // Skip if already rendered (adjacent block exists)
        const next = el.nextElementSibling;
        if (next?.classList?.contains('wt-inline-block')) continue;
        markTranslated(el, fp);
        if (currentMode === 'inline') {
          inlineRenderer.render(el, cached, generateParagraphId(el));
        }
      } else if (!el.dataset.wtDone) {
        needs.push({ id: generateParagraphId(el), fingerprint: fp, text: getTranslatableText(el), element: el });
      }
    }
    if (needs.length) onBatchReady(needs);
  };

  let _scrollTicking = false;
  const _scrollCheck = () => { _scrollTicking = false; _flushVisible(); };
  const _onScroll = () => {
    if (!_scrollTicking) { _scrollTicking = true; requestAnimationFrame(_scrollCheck); }
  };
  // Start top-down sequential translation
  console.log(`[WT] Extracted ${_total} paragraphs`);
  setTimeout(() => _processNextBatch(), 100);
  window.addEventListener('scroll', _onScroll, { passive: true });
  // Periodic recovery: scan for untranslated visible paragraphs every 3 s.
  // Recovers from missed IntersectionObserver events on fast scroll / SPA.
  const _recoveryTimer = setInterval(() => { _flushVisible(); }, 3000);

  // Clean up scroll listener + recovery timer when translation stops
  const _disposeScroll = () => {
    window.removeEventListener('scroll', _onScroll);
    clearInterval(_recoveryTimer);
  };
  if (!window._wtDisposeScroll) window._wtDisposeScroll = [];
  window._wtDisposeScroll.push(_disposeScroll);

  setTimeout(() => stateManager.transition(State.TRANSLATING), 100);
}

// ------------------------------------------------------------------
// Resilience: offline detection & graceful shutdown
// ------------------------------------------------------------------

function setupResilience() {
  // Offline detection
  window.addEventListener('online', () => {
    console.log('[WT] Network restored');
    if (stateManager.get() === State.PAUSED) {
      stateManager.transition(State.TRANSLATING);
    }
  });

  window.addEventListener('offline', () => {
    console.warn('[WT] Network offline - pausing translation');
    if (stateManager.get() === State.TRANSLATING) {
      stateManager.transition(State.PAUSED);
    }
  });

  // Graceful stop on page unload
  window.addEventListener('beforeunload', () => {
    batchCollector?.stop();
    observerManager?.stop();
    cacheManager?.dispose();
    fabComponent?.dispose();
    concurrencyController?.cancelQueued();
    panelRenderer?.dispose();
    chrome.runtime.sendMessage({ type: MSG.STOP_ALL, tabId: TAB_ID }).catch(() => {});
  });
}

// ------------------------------------------------------------------
// Bootstrap
// ------------------------------------------------------------------

if (!document.documentElement.dataset.wtInitialized) {
  document.documentElement.dataset.wtInitialized = 'true';
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init().then(setupResilience).then(maybeAutoStart); });
  } else {
    init().then(setupResilience).then(maybeAutoStart);
  }
}

/** Inform the user that the side panel is unavailable and we fell back to inline. */
function showPanelUnavailableToast() {
  if (document.getElementById('wt-toast-panel')) return;
  const toast = document.createElement('div');
  toast.id = 'wt-toast-panel';
  toast.className = 'wt-config-toast';
  toast.innerHTML = `
    <span style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:20px;">ℹ️</span>
      <span style="font-weight:600;font-size:14px;color:#1f2937;">${t('toast.panel_unavailable')}</span>
    </span>
    <span style="color:#6b7280;font-size:13px;margin:4px 0 0 30px;">${t('toast.panel_fallback')}</span>`;
  Object.assign(toast.style, {
    position:'fixed',top:'16px',left:'50%',zIndex:'2147483647',
    display:'flex',flexDirection:'column',padding:'16px 20px',
    background:'#fff',color:'#1f2937',
    fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif',
    borderRadius:'14px',boxShadow:'0 12px 40px rgba(0,0,0,.18)',
    maxWidth:'440px',width:'calc(100vw - 32px)',
    animation:'wt-slide-in .35s cubic-bezier(.34,1.56,.64,1)',
    transform:'translateX(-50%)',
  });
  setTimeout(() => {
    if (toast.parentNode) { toast.style.opacity='0'; toast.style.transition='opacity .3s'; setTimeout(()=>toast.remove(),300); }
  }, 5000);
  const styleId = 'wt-toast-kf';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style'); s.id = styleId;
    s.textContent = '@keyframes wt-slide-in{from{transform:translate(-50%,-100%);opacity:0}to{transform:translate(-50%,0);opacity:1}}';
    document.head.appendChild(s);
  }
  document.body.appendChild(toast);
}

/** Show a friendly toast when API is not configured, with a quick link. */
function showConfigToast() {
  // Mark that user wants translation — will auto-start when API is configured
  window._wt_pendingTranslate = currentMode || 'inline';

  if (!document.getElementById('wt-toast-kf')) {
    const s = document.createElement('style');
    s.id = 'wt-toast-kf';
    s.textContent = '@keyframes wt-slide-in{from{transform:translate(-50%,-100%);opacity:0}to{transform:translate(-50%,0);opacity:1}}';
    document.head.appendChild(s);
  }
  const toast = document.createElement('div');
  toast.className = 'wt-config-toast';
  toast.innerHTML = `
    <span style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:20px;">&#9888;&#65039;</span>
      <span style="font-weight:600;font-size:14px;color:#1f2937;">${t('toast.api_not_configured')}</span>
    </span>
    <span style="color:#6b7280;font-size:13px;margin:4px 0 0 30px;">${t('toast.config_hint')}</span>
    <span style="display:flex;gap:8px;margin-top:10px;margin-left:30px;">
      <button class="wt-toast-btn">${t('toast.open_settings')}</button>
      <button class="wt-toast-close">${t('toast.dismiss')}</button>
    </span>`;
  Object.assign(toast.style, {
    position:'fixed',top:'16px',left:'50%',zIndex:'2147483647',
    display:'flex',flexDirection:'column',padding:'16px 20px',
    background:'#fff',color:'#1f2937',
    fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif',
    borderRadius:'14px',boxShadow:'0 12px 40px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.04)',
    maxWidth:'440px',width:'calc(100vw - 32px)',
    animation:'wt-slide-in .35s cubic-bezier(.34,1.56,.64,1)',
    transform:'translateX(-50%)',
  });
  const btn = toast.querySelector('.wt-toast-btn');
  const close = toast.querySelector('.wt-toast-close');
  Object.assign(btn.style, {
    background:'linear-gradient(135deg,#6366f1,#4f46e5)',color:'#fff',border:'none',
    padding:'8px 18px',borderRadius:'8px',cursor:'pointer',fontSize:'13px',
    fontWeight:'600',whiteSpace:'nowrap',boxShadow:'0 2px 8px rgba(99,102,241,.3)',
  });
  Object.assign(close.style, {
    background:'#f3f4f6',border:'none',padding:'8px 18px',borderRadius:'8px',
    cursor:'pointer',fontSize:'13px',color:'#6b7280',fontWeight:'500',
  });
  btn.addEventListener('click', () => {
    try { chrome.action?.openPopup?.(); } catch {}
    try { chrome.runtime.sendMessage({ type: 'OPEN_PANEL' }); } catch {}
    toast.remove();
  });
  close.addEventListener('click', () => {
    delete window._wt_pendingTranslate;
    toast.remove();
  });
  setTimeout(() => { if (toast.parentNode) { toast.remove(); delete window._wt_pendingTranslate; } }, 15000);
  document.body.appendChild(toast);
}

/** Auto-start translation if the user previously enabled it. */
async function maybeAutoStart() {
  try {
    // Use session storage — scoped to this specific tab, won't bleed to other tabs
    const cfg = await chrome.storage.session.get(['wt_autoMode', 'wt_active']);
    if (cfg.wt_active && cfg.wt_autoMode) {
      console.log('[WT] Auto-starting translation in', cfg.wt_autoMode, 'mode');
      currentMode = cfg.wt_autoMode;
      startTranslation(cfg.wt_autoMode);
    } else {
      // Fallback: check local storage for default mode (legacy)
      const localCfg = await chrome.storage.local.get(['defaultMode']);
      currentMode = localCfg.defaultMode || 'inline';
    }
  } catch {
    // session storage may not be available in some contexts
    try {
      const localCfg = await chrome.storage.local.get(['defaultMode']);
      currentMode = localCfg.defaultMode || 'inline';
    } catch {}
  }
}
