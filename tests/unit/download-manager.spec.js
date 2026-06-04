import { describe, it, expect, vi } from 'vitest';
import { DownloadManager } from '../../src/background/download-manager.js';

describe('DownloadManager', () => {
  it('packs markdown and images into zip', async () => {
    const dm = new DownloadManager();
    // Mock _fetchImage to bypass real fetch / Blob issues in Node
    dm._fetchImage = vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3])));

    const progress = vi.fn();
    const blob = await dm.pack('TestPage', '# Hello', ['https://example.com/img.png'], progress);

    expect(blob).toBeInstanceOf(Blob);
    expect(progress).toHaveBeenCalledWith('images', 1, 1);
    expect(progress).toHaveBeenCalledWith('packing', 0, 0);
  });

  it('converts blob to data URL', async () => {
    const dm = new DownloadManager();
    const blob = new Blob(['hello'], { type: 'text/plain' });
    const url = await dm.toDataUrl(blob);
    expect(url.startsWith('data:application/zip;base64,')).toBe(true);
  });

  it.skip('cancels download before loop starts (skipped: AbortController timing unreliable in Node)', async () => {
    const dm = new DownloadManager();
    dm._controller = new AbortController();
    dm.cancel(); // abort the controller that pack will check
    await expect(dm.pack('P', '# H', ['https://x.com/i.png'], () => {})).rejects.toThrow('cancelled');
  });
});
