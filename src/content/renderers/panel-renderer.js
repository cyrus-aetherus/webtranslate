/**
 * PanelRenderer - Pushes translation results to the Chrome Side Panel
 * via chrome.runtime.connect long-lived Port.
 *
 * chrome.sidePanel.open() is only available in the Service Worker context,
 * NOT in content scripts.  We delegate the open call via SW message.
 */

const PORT_CS_NAME = 'wt-panel-cs';

export class PanelRenderer {
  constructor(tabId) {
    this.tabId = tabId;
    this.port = null;
    this._connected = false;
  }

  /**
   * Open the side panel (via SW) and establish a Port connection.
   * @returns {Promise<boolean>} true if panel opened successfully
   */
  async open() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL', tabId: this.tabId });
      if (!res || !res.ok) {
        console.warn('[WT] SW failed to open side panel:', res?.error || 'unknown');
        return false;
      }
    } catch (err) {
      console.warn('[WT] OPEN_SIDE_PANEL message failed:', err.message);
      return false;
    }

    this._connect();
    return true;
  }

  /**
   * Send a batch of translated items to the panel.
   * @param {{id:string, original:string, translation:string}[]} items
   */
  renderBatch(items) {
    if (!this._connected) {
      this._connect();
    }
    if (!this.port) return;
    try {
      this.port.postMessage({ type: 'BATCH_RESULT', items });
    } catch { /* port may have disconnected */ }
  }

  /**
   * Close the Port connection.
   */
  dispose() {
    this.port?.disconnect();
    this.port = null;
    this._connected = false;
  }

  // ------------------------------------------------------------------

  _connect() {
    if (this.port) return;
    try {
      this.port = chrome.runtime.connect({ name: PORT_CS_NAME });
      this._connected = true;
      this.port.onDisconnect.addListener(() => {
        this._connected = false;
        this.port = null;
      });
    } catch (err) {
      console.warn('[WT] Port connection failed:', err.message);
      this._connected = false;
    }
  }
}
