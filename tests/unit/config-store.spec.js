import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChromeMock } from '../mocks/chrome.js';
import { ConfigStore } from '../../src/background/config-store.js';

describe('ConfigStore', () => {
  let store;

  beforeEach(() => {
    const { chromeMock } = createChromeMock();
    vi.stubGlobal('chrome', chromeMock);
    store = new ConfigStore();
  });

  it('merges defaults with stored values', async () => {
    await chrome.storage.local.set({ apiUrl: 'https://custom.com', model: 'custom-model' });
    const cfg = await store.getAll();
    expect(cfg.apiUrl).toBe('https://custom.com');
    expect(cfg.model).toBe('custom-model');
    expect(cfg.adapter).toBe('openai'); // default
  });

  it('caches result', async () => {
    await chrome.storage.local.set({ apiUrl: 'https://cached.com' });
    const a = await store.getAll();
    await chrome.storage.local.set({ apiUrl: 'https://new.com' });
    const b = await store.getAll();
    expect(b.apiUrl).toBe('https://cached.com'); // cached
  });

  it('invalidates cache on set', async () => {
    await chrome.storage.local.set({ apiUrl: 'https://old.com' });
    await store.getAll();
    await store.set({ apiUrl: 'https://new.com' });
    const cfg = await store.getAll();
    expect(cfg.apiUrl).toBe('https://new.com');
  });

  it('export strips apiKey', async () => {
    await chrome.storage.local.set({ apiUrl: 'https://x.com', apiKey: 'secret', model: 'm' });
    const json = await store.exportJson();
    const parsed = JSON.parse(json);
    expect(parsed.apiUrl).toBe('https://x.com');
    expect(parsed.apiKey).toBeUndefined();
  });

  it('import strips apiKey', async () => {
    await store.importJson(JSON.stringify({ apiUrl: 'https://y.com', apiKey: 'hacked', model: 'm' }));
    const cfg = await store.getAll();
    expect(cfg.apiUrl).toBe('https://y.com');
    expect(cfg.apiKey).toBe(''); // default, not imported
  });

  it('reset clears storage', async () => {
    await chrome.storage.local.set({ apiUrl: 'https://z.com' });
    await store.reset();
    const cfg = await store.getAll();
    expect(cfg.apiUrl).toBe(''); // default empty
  });
});
