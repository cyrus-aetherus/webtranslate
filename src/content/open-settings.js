import { MSG } from '../shared/constants.js';

export async function openSettingsPage() {
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG.OPEN_SETTINGS });
    return response?.ok === true;
  } catch (err) {
    console.warn('[WT] Failed to open settings:', err.message);
    return false;
  }
}
