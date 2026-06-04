/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChromeMock } from '../mocks/chrome.js';
import { CacheManager } from '../../src/content/cache-manager.js';

describe('CacheManager', () => {
  beforeEach(() => {
    const { chromeMock } = createChromeMock();
    vi.stubGlobal('chrome', chromeMock);
  });

  it('stores and retrieves translations', async () => {
    const cm = new CacheManager();
    await cm.load();
    cm.set('fp1', 'translated1');
    expect(cm.get('fp1')).toBe('translated1');
  });

  it('returns null for unknown fingerprint', async () => {
    const cm = new CacheManager();
    await cm.load();
    expect(cm.get('unknown')).toBeNull();
  });

  it('persists to storage on dispose', async () => {
    const cm = new CacheManager();
    await cm.load();
    cm.set('fp1', 'val');
    cm.dispose();
    await new Promise(r => setTimeout(r, 100)); // _persist is async but not awaited in dispose
    expect(chrome.storage.local.set).toHaveBeenCalled();
  });
});
