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
 * Open side panel for a given tab (MV3)
 */
async function openSidePanel(tabId) {
  if (chrome.sidePanel) {
    await chrome.sidePanel.open({ tabId });
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
