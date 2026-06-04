/**
 * PanelRenderer - Pushes translation results to the Chrome Side Panel
 * via chrome.runtime.connect long-lived Port.
 */

const PORT_CS_NAME = 'wt-panel-cs';

export class PanelRenderer {
  constructor(tabId) {
    this.tabId = tabId;
    this.port = null;
    this._connected = false;
  }

  /**
   * Open the side panel and establish a Port connection.
   * @returns {Promise<boolean>} true if panel opened successfully
   */
  async open() {
    // Try native sidePanel API (MV3), requires optional sidePanel permission
    if (chrome.sidePanel) {
      try {
        await chrome.sidePanel.open({ tabId: this.tabId });
      } catch (err) {
        console.warn('[WT] sidePanel.open failed:', err.message);
        this._connected = false;
        return false;
      }
    } else {
      // chrome.sidePanel API not available — user hasn't granted permission
      // or browser doesn't support it.  Fall back.
      console.warn('[WT] chrome.sidePanel is not available — panel mode unavailable');
      this._connected = false;
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
