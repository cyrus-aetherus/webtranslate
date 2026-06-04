import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChromeMock } from '../mocks/chrome.js';
import { StatsTracker } from '../../src/background/stats-tracker.js';

describe('StatsTracker', () => {
  let tracker;
  let chromeMock;

  beforeEach(async () => {
    const mock = createChromeMock();
    chromeMock = mock.chromeMock;
    vi.stubGlobal('chrome', chromeMock);
    tracker = new StatsTracker();
    await tracker.init();
  });

  it('initializes with zero defaults when storage empty', async () => {
    await tracker.init();
    const all = tracker.getStats('alltime');
    expect(all.calls).toBe(0);
    expect(all.segments).toBe(0);
  });

  it('records session stats per tab', () => {
    tracker.record({ tabId: '1', segmentCount: 5, promptTokens: 100, completionTokens: 50 });
    tracker.record({ tabId: '1', segmentCount: 3, promptTokens: 60, completionTokens: 30 });
    const s = tracker.getStats('session', '1');
    expect(s.calls).toBe(2);
    expect(s.segments).toBe(8);
    expect(s.promptTokens).toBe(160);
    expect(s.completionTokens).toBe(80);
  });

  it('tracks errors separately from tokens', () => {
    tracker.record({ tabId: '1', segmentCount: 4, error: true });
    const s = tracker.getStats('session', '1');
    expect(s.errors).toBe(1);
    expect(s.promptTokens).toBe(0);
    expect(s.calls).toBe(1);
  });

  it('accumulates all-time stats across tabs', () => {
    tracker.record({ tabId: '1', segmentCount: 2, promptTokens: 10 });
    tracker.record({ tabId: '2', segmentCount: 3, promptTokens: 20 });
    const all = tracker.getStats('alltime');
    expect(all.calls).toBe(2);
    expect(all.segments).toBe(5);
    expect(all.promptTokens).toBe(30);
  });

  it('creates daily record with today date', () => {
    tracker.record({ tabId: '1', segmentCount: 1, promptTokens: 10 });
    const daily = tracker.getStats('daily');
    expect(daily.length).toBe(1);
    expect(daily[0].date).toBe(new Date().toISOString().slice(0, 10));
  });

  it('clears all stats', async () => {
    tracker.record({ tabId: '1', segmentCount: 1 });
    await tracker.clearAll();
    expect(tracker.getStats('alltime').calls).toBe(0);
    expect(tracker.getStats('session', '1').calls).toBe(0);
  });

  it('returns zero defaults for unknown session', () => {
    const s = tracker.getStats('session', '999');
    expect(s.calls).toBe(0);
    expect(s.startedAt).toBe(0);
  });

  it('flushes to storage', async () => {
    tracker.record({ tabId: '1', segmentCount: 1 });
    await tracker.flush();
    expect(chromeMock.storage.local.set).toHaveBeenCalled();
  });
});
