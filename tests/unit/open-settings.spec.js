import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MSG } from '../../src/shared/constants.js';
import { openSettingsPage } from '../../src/content/open-settings.js';

describe('openSettingsPage', () => {
  beforeEach(() => {
    global.chrome = {
      runtime: {
        sendMessage: vi.fn(),
      },
    };
  });

  it('asks the service worker to open the settings page', async () => {
    chrome.runtime.sendMessage.mockResolvedValue({ ok: true });

    await expect(openSettingsPage()).resolves.toBe(true);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: MSG.OPEN_SETTINGS,
    });
  });

  it('returns false when the settings page cannot be opened', async () => {
    chrome.runtime.sendMessage.mockRejectedValue(new Error('disconnected'));

    await expect(openSettingsPage()).resolves.toBe(false);
  });
});
