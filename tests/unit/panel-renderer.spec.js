/**
 * Unit tests for content/renderers/panel-renderer.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PanelRenderer } from '../../src/content/renderers/panel-renderer.js';

describe('PanelRenderer', () => {
  let renderer;

  beforeEach(() => {
    global.chrome = {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ ok: true }),
        connect: vi.fn(() => ({
          postMessage: vi.fn(),
          disconnect: vi.fn(),
          onDisconnect: { addListener: vi.fn() },
        })),
      },
    };
    renderer = new PanelRenderer(42);
  });

  it('delegates open to SW via sendMessage', async () => {
    const ok = await renderer.open();
    expect(ok).toBe(true);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'OPEN_SIDE_PANEL', tabId: 42 });
  });

  it('returns false when SW open fails', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'test' });
    const ok = await renderer.open();
    expect(ok).toBe(false);
  });

  it('returns false when sendMessage throws', async () => {
    chrome.runtime.sendMessage.mockRejectedValue(new Error('disconnected'));
    const ok = await renderer.open();
    expect(ok).toBe(false);
  });

  it('connects port on renderBatch', () => {
    renderer.renderBatch([{ id: 'p1', original: 'Hello', translation: '你好' }]);
    expect(chrome.runtime.connect).toHaveBeenCalled();
  });

  it('posts messages through port', () => {
    const postMessage = vi.fn();
    chrome.runtime.connect.mockReturnValue({
      postMessage,
      disconnect: vi.fn(),
      onDisconnect: { addListener: vi.fn() },
    });

    renderer.renderBatch([{ id: 'p1', original: 'Hello', translation: '你好' }]);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'BATCH_RESULT',
      items: [{ id: 'p1', original: 'Hello', translation: '你好' }],
    });
  });

  it('disposes port on cleanup', () => {
    const disconnect = vi.fn();
    chrome.runtime.connect.mockReturnValue({
      postMessage: vi.fn(),
      disconnect,
      onDisconnect: { addListener: vi.fn() },
    });

    renderer.renderBatch([]);
    renderer.dispose();
    expect(disconnect).toHaveBeenCalled();
  });
});
