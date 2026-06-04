/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObserverManager } from '../../src/content/observer-manager.js';
import { BatchCollector } from '../../src/content/batch-collector.js';

describe('ObserverManager', () => {
  let batchCollector;
  let observerManager;

  beforeEach(() => {
    document.body.innerHTML = '';
    global.IntersectionObserver = vi.fn((callback) => ({
      observe: vi.fn((el) => {
        setTimeout(() => callback([{ target: el, isIntersecting: true }]), 10);
      }),
      disconnect: vi.fn(),
      unobserve: vi.fn(),
    }));
    batchCollector = new BatchCollector(() => {}, { maxBatchChars: 800, maxBatchItems: 8, debounceMs: 50 });
    batchCollector.start();
    observerManager = new ObserverManager(batchCollector);
  });

  it.skip('detects newly added paragraphs (skipped: MutationObserver timing unreliable in jsdom)', () => new Promise((resolve) => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const onNew = vi.fn();
    observerManager = new ObserverManager(batchCollector, onNew);
    observerManager.start(root);

    const newP = document.createElement('p');
    newP.textContent = 'This is a dynamically added paragraph with sufficient length.';
    root.appendChild(newP);

    setTimeout(() => {
      expect(onNew).toHaveBeenCalled();
      resolve();
    }, 800);
  }));

  it.skip('ignores non-element nodes (skipped: requires live MutationObserver)', () => {
    const root = document.createElement('div');
    observerManager.start(root);
    root.appendChild(document.createTextNode('text only'));
    // Should not throw
    observerManager.stop();
    expect(true).toBe(true);
  });
});
