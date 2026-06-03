/**
 * Unit tests for content/renderers/panel-renderer.js
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PanelRenderer } from '../../src/content/renderers/panel-renderer.js';

describe('PanelRenderer', () => {
  let renderer;

  beforeEach(() => {
    // Mock chrome.runtime.connect
    global.chrome = {
      runtime: {
        connect: vi.fn(() => ({
          postMessage: vi.fn(),
          disconnect: vi.fn(),
          onDisconnect: { addListener: vi.fn() },
        })),
      },
      sidePanel: {
        open: vi.fn().mockResolvedValue(),
      },
    };
    renderer = new PanelRenderer(42);
  });

  it('opens side panel if available', async () => {
    const ok = await renderer.open();
    expect(ok).toBe(true);
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ tabId: 42 });
  });

  it('falls back when sidePanel is unavailable', async () => {
    delete chrome.sidePanel;
    const ok = await renderer.open();
    expect(ok).toBe(true); // still tries to connect via port
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

    renderer.renderBatch([]); // triggers connect
    renderer.dispose();
    expect(disconnect).toHaveBeenCalled();
  });
});
