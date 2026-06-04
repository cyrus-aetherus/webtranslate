/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createChromeMock } from '../mocks/chrome.js';
import { init, t, tf, applyI18nElements, setLocale, currentLocale } from '../../src/shared/i18n.js';

describe('i18n', () => {
  beforeEach(() => {
    const { chromeMock } = createChromeMock();
    vi.stubGlobal('chrome', chromeMock);
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url.includes('zh-CN')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ 'popup.saveBtn': '保存设置', 'fab.download': '下载页面' }) });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }));
    document.body.innerHTML = '';
    document.head.innerHTML = '';
  });

  it('initializes with hardcoded English fallback', async () => {
    await init('en');
    expect(t('popup.saveBtn')).toBe('Save Settings');
    expect(t('fab.download')).toBe('Download Page');
  });

  it('returns key itself when translation missing', async () => {
    await init('en');
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('tf replaces placeholders', async () => {
    await init('en');
    const text = tf('popup.test_request_fail', { message: 'timeout' });
    expect(text).toBe('Request failed: timeout');
  });

  it('applies data-i18n to DOM elements', async () => {
    await init('en');
    const btn = document.createElement('button');
    btn.dataset.i18n = 'popup.saveBtn';
    document.body.appendChild(btn);
    applyI18nElements(document);
    expect(btn.textContent).toBe('Save Settings');
  });

  it('applies data-i18n-placeholder', async () => {
    await init('en');
    const input = document.createElement('input');
    input.dataset.i18nPlaceholder = 'popup.apiUrl.label';
    document.body.appendChild(input);
    applyI18nElements(document);
    expect(input.placeholder).toBe('API URL');
  });

  it('applies data-i18n-title', async () => {
    await init('en');
    const span = document.createElement('span');
    span.dataset.i18nTitle = 'popup.title';
    document.body.appendChild(span);
    applyI18nElements(document);
    expect(span.title).toBe('WebTranslate Settings');
  });

  it('setLocale persists and re-inits', async () => {
    await setLocale('zh-CN');
    expect(currentLocale()).toBe('zh-CN');
    expect(t('popup.saveBtn')).toBe('保存设置');
  });

  it('falls back to English for unsupported locale', async () => {
    await init('xx-YY');
    expect(t('popup.saveBtn')).toBe('Save Settings');
  });
});
