/**
 * ObserverManager - Manages IntersectionObserver + MutationObserver lifecycle
 * For SPA dynamic content: watches DOM mutations and auto-registers new
 * translatable elements into the BatchCollector.
 */

import { debounce } from '../shared/utils.js';
import { scanTextBlocks } from './extractor/content-scanner.js';

export class ObserverManager {
  /**
   * @param {BatchCollector} batchCollector
   * @param {Function} onNewElements - optional callback for newly added elements
   */
  constructor(batchCollector, onNewElements) {
    this.batchCollector = batchCollector;
    this.onNewElements = onNewElements;
    this.mutationObserver = null;
    this._handleMutations = debounce((els) => this._registerElements(els), 500);
  }

  /**
   * Start MutationObserver on the content root.
   * @param {Element} root
   */
  start(root) {
    if (this.mutationObserver) this.stop();

    this.mutationObserver = new MutationObserver((mutations) => {
      const added = [];
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            added.push(node);
          }
        }
      }
      if (added.length) this._handleMutations(added);
    });

    this.mutationObserver.observe(root, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Stop MutationObserver.
   */
  stop() {
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
  }

  // ------------------------------------------------------------------

  _registerElements(addedNodes) {
    const newElements = [];
    for (const node of addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;

      const blocks = scanTextBlocks(node);
      for (const block of blocks) {
        const el = block.element;
        if (!el.dataset.wtDone && !el.dataset.wtObservable) {
          el.dataset.wtObservable = 'true';
          newElements.push(el);
        }
      }
    }

    if (newElements.length) {
      for (const el of newElements) {
        this.batchCollector.observeElement(el);
      }
      this.onNewElements?.(newElements);
    }
  }
}
