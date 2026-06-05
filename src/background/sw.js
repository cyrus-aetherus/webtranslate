/**
 * Service Worker entry for WebTranslate
 * Responsibilities:
 *   - Proxy API requests to LLM providers (via adapters)
 *   - Manage downloads (images + ZIP packaging)
 *   - Store/load user configuration
 *   - Handle message routing from Content Scripts
 */

import { ConfigStore } from './config-store.js';
import { ApiProxy } from './api-proxy.js';
import { DownloadManager } from './download-manager.js';
import { StatsTracker } from './stats-tracker.js';
import { MSG } from '../shared/constants.js';

const configStore = new ConfigStore();
const apiProxy = new ApiProxy();
const downloadManager = new DownloadManager();
const statsTracker = new StatsTracker();
statsTracker.init();

/**
 * Route incoming messages from Content Scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type } = message;
  const tabId = message.tabId ?? sender.tab?.id;

  switch (type) {
    case 'GET_TAB_ID':
      sendResponse({ tabId: sender.tab?.id ?? -1 });
      return false;

    case MSG.TRANSLATE_BATCH:
      // Push result via tabs.sendMessage to avoid channel timeout
      handleTranslateBatch(message, tabId);
      sendResponse({ ok: true }); // ack immediately
      return false;

    case MSG.CANCEL_BATCH:
      apiProxy.cancelBatch(message.batchId);
      sendResponse({ ok: true });
      return false;

    case MSG.STOP_ALL:
      apiProxy.stopAll();
      sendResponse({ ok: true });
      return false;

    case MSG.DOWNLOAD:
      handleDownload(message, tabId);
      sendResponse({ ok: true, downloadId: message.downloadId });
      return false;

    case MSG.OPEN_PANEL:
      chrome.action?.openPopup().catch(() => {});
      sendResponse({ ok: true });
      return false;

    case 'OPEN_SIDE_PANEL':
      openSidePanel(tabId ?? sender.tab?.id)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.message }));
      return true; // async response

    case 'GET_STATS':
      sendResponse({
        session: statsTracker.getStats('session', tabId),
        alltime: statsTracker.getStats('alltime'),
        daily: statsTracker.getStats('daily'),
      });
      return false;

    case 'CLEAR_STATS':
      statsTracker.clearAll().then(() => sendResponse({ ok: true }));
      return true;

    default:
      sendResponse({ ok: false, error: 'Unknown message type' });
      return false;
  }
});

/**
 * Handle TRANSLATE_BATCH request.
 * Pushes results via chrome.tabs.sendMessage to avoid the 30 s
 * message-channel timeout that affects sendResponse callbacks.
 */
async function handleTranslateBatch(message, tabId) {
  const { batchId, items } = message;
  try {
    const config = await configStore.getAll();
    const { results, usage } = await apiProxy.translateBatch(items, config, batchId);
    // Record stats
    statsTracker.record({
      tabId: String(tabId),
      segmentCount: items.length,
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
    });
    chrome.tabs.sendMessage(tabId, {
      type: MSG.TRANSLATE_BATCH_RESULT,
      batchId,
      results,
    }).catch(() => {});
  } catch (err) {
    statsTracker.record({ tabId: String(tabId), segmentCount: items.length, error: true });
    chrome.tabs.sendMessage(tabId, {
      type: MSG.TRANSLATE_BATCH_RESULT,
      batchId,
      error: err.message,
    }).catch(() => {});
  }
}

/**
 * Handle DOWNLOAD request
 */
async function handleDownload(message, tabId) {
  const { pageTitle, markdown, imageUrls, downloadId } = message;

  const onProgress = (stage, current, total) => {
    chrome.tabs.sendMessage(tabId, {
      type: MSG.DOWNLOAD_PROGRESS,
      downloadId,
      stage,
      current,
      total,
    }).catch(() => {}); // tab may be closed
  };

  try {
    const blob = await downloadManager.pack(pageTitle, markdown, imageUrls, onProgress);
    const url = await downloadManager.toDataUrl(blob);
    await chrome.downloads.download({
      url,
      filename: `${pageTitle}.zip`,
      saveAs: false,
    });
    chrome.tabs.sendMessage(tabId, {
      type: MSG.DOWNLOAD_COMPLETE,
      downloadId,
      success: true,
    }).catch(() => {});
  } catch (err) {
    chrome.tabs.sendMessage(tabId, {
      type: MSG.DOWNLOAD_COMPLETE,
      downloadId,
      success: false,
      error: err.message,
    }).catch(() => {});
  }
}

/**
 * Open side panel for a given tab (MV3).
 * Called from SW context where chrome.sidePanel is available.
 */
async function openSidePanel(tabId) {
  if (chrome.sidePanel && tabId) {
    _panelTabId = tabId;
    // Persist so tab-switch handling survives SW restarts
    try { await chrome.storage.session.set({ _panelTabId: tabId }); } catch {}
    await chrome.sidePanel.open({ tabId });
  } else {
    throw new Error('chrome.sidePanel not available or no tabId');
  }
}

/**
 * Cleanup on suspend
 */
chrome.runtime.onSuspend?.addListener(() => {
  apiProxy.dispose();
  downloadManager.dispose();
  statsTracker.dispose();
});

/**
 * Panel Port Bridge — routes messages between Content Script and Side Panel.
 *
 * MV3: Content Script ↔ SW ↔ Panel is the only valid Port topology.
 * Only one side panel is open at a time, so a single receiver port covers
 * all tabs.  CS ports use `wt-panel-cs`; the panel uses `wt-panel-receiver`.
 */
let _panelTabId = -1;
let _panelReceiver = null;
/** @type {object[]} buffered messages waiting for panel to connect */
const _panelPending = [];

// MV3: Service Worker auto-terminates after idle; restore _panelTabId
// from session storage so tab-switch handling survives SW restarts.
chrome.storage.session?.get('_panelTabId').then(({ _panelTabId: id }) => {
  if (id) _panelTabId = id;
}).catch(() => {});

(() => {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'wt-panel-receiver') {
      _panelReceiver = port;
      // Flush any messages that arrived before the panel was ready
      for (const msg of _panelPending) {
        try { _panelReceiver.postMessage(msg); } catch { _panelReceiver = null; break; }
      }
      _panelPending.length = 0;
      // Listen for messages FROM the panel (SCROLL_TO, etc.)
      port.onMessage.addListener((msg) => {
        if (msg.type === 'SCROLL_TO' && _panelTabId > 0) {
          chrome.tabs.sendMessage(_panelTabId, msg).catch(() => {});
        }
      });
      port.onDisconnect.addListener(() => {
        _panelReceiver = null;
        const closedTabId = _panelTabId;
        _panelTabId = -1;
        chrome.storage.session?.remove('_panelTabId').catch(() => {});
        // Notify content script so it can transition to PAUSED
        if (closedTabId > 0) {
          chrome.tabs.sendMessage(closedTabId, { type: 'PANEL_CLOSED' }).catch(() => {});
        }
      });
      return;
    }

    if (port.name === 'wt-panel-cs') {
      port.onMessage.addListener((msg) => {
        if (_panelReceiver) {
          try { _panelReceiver.postMessage(msg); } catch { _panelReceiver = null; }
        } else {
          _panelPending.push(msg);
        }
      });
      return;
    }
  });
})();

/**
 * Tab switch management: when the user leaves the translated tab,
 * tell the panel to show a placeholder. When they return, ask the
 * content script to rebuild the panel slots from cache.
 */
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (_panelTabId <= 0) return;

  if (tabId !== _panelTabId) {
    // Switched away — clear panel content so old translations don't linger
    if (_panelReceiver) {
      try { _panelReceiver.postMessage({ type: 'SHOW_PLACEHOLDER' }); } catch {}
    }
  } else {
    // Switched back — rebuild panel with cached translations
    chrome.tabs.sendMessage(_panelTabId, { type: 'REINIT_PANEL_SLOTS' }).catch(() => {});
  }
});
