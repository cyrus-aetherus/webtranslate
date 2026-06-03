/**
 * Unit tests for content/batch-collector.js
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BatchCollector } from '../../src/content/batch-collector.js';

// jsdom does not implement IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor(callback) { this.callback = callback; }
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe('BatchCollector grouping', () => {
  let collector;
  let onBatch;

  beforeEach(() => {
    onBatch = vi.fn();
    collector = new BatchCollector(onBatch, {
      maxBatchChars: 20,
      maxBatchItems: 3,
      debounceMs: 0, // disable debounce for synchronous tests
    });
  });

  it('groups items within char limit', () => {
    const items = [
      { text: 'Short', fingerprint: 'a' },
      { text: 'Also short', fingerprint: 'b' },
    ];
    const batches = collector._groupIntoBatches(items);
    expect(batches.length).toBe(1);
    expect(batches[0].length).toBe(2);
  });

  it('splits when char limit exceeded', () => {
    const items = [
      { text: 'This is a long sentence', fingerprint: 'a' }, // 23 chars
      { text: 'Another long one here', fingerprint: 'b' },   // 21 chars
    ];
    const batches = collector._groupIntoBatches(items);
    expect(batches.length).toBe(2);
    expect(batches[0].length).toBe(1);
    expect(batches[1].length).toBe(1);
  });

  it('splits when item count exceeded', () => {
    const items = [
      { text: 'A', fingerprint: 'a' },
      { text: 'B', fingerprint: 'b' },
      { text: 'C', fingerprint: 'c' },
      { text: 'D', fingerprint: 'd' },
    ];
    const batches = collector._groupIntoBatches(items);
    expect(batches.length).toBe(2);
    expect(batches[0].length).toBe(3);
    expect(batches[1].length).toBe(1);
  });

  it('puts oversized item into solo batch', () => {
    const items = [
      { text: 'Normal', fingerprint: 'a' },
      { text: 'This is extremely long text that exceeds limit', fingerprint: 'b' },
      { text: 'Also normal', fingerprint: 'c' },
    ];
    const batches = collector._groupIntoBatches(items);
    expect(batches.length).toBe(3);
    expect(batches[1].length).toBe(1);
    expect(batches[1][0].fingerprint).toBe('b');
  });

  it('deduplicates by fingerprint', () => {
    const items = [
      { text: 'Same', fingerprint: 'dup' },
      { text: 'Same', fingerprint: 'dup' },
    ];
    const batches = collector._groupIntoBatches(items);
    expect(batches.length).toBe(1);
    expect(batches[0].length).toBe(1);
  });

  it('skips already-processed fingerprints', () => {
    const items = [
      { text: 'First', fingerprint: 'x' },
    ];
    // First call marks as processed
    collector._groupIntoBatches(items);
    const second = collector._groupIntoBatches(items);
    expect(second.length).toBe(0);
  });
});

describe('BatchCollector elementMap', () => {
  it('registers elements with info', () => {
    const collector = new BatchCollector(vi.fn(), { debounceMs: 0 });
    collector.start();

    const el = document.createElement('p');
    el.textContent = 'Hello';
    const info = { id: 'p1', fingerprint: 'abc', text: 'Hello' };

    collector.observeElement(el, info);
    expect(collector.elementMap.get(el)).toEqual(info);
  });
});
