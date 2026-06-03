/**
 * Unit tests for content/components/wt-translation.js
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chrome.storage.session before importing the module
global.chrome = {
  storage: {
    session: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(),
    },
  },
};

import { WtTranslation } from '../../src/content/components/wt-translation.js';

describe('WtTranslation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('creates shadow DOM', () => {
    const el = document.createElement('wt-translation');
    el.dataset.wtId = 'p1';
    document.body.appendChild(el);

    expect(el.shadowRoot).toBeTruthy();
    expect(el.shadowRoot.querySelector('.wt-block')).toBeTruthy();
    expect(el.shadowRoot.querySelector('.wt-body')).toBeTruthy();
    expect(el.shadowRoot.querySelector('.wt-toggle')).toBeTruthy();
  });

  it('renders translation content', () => {
    const el = document.createElement('wt-translation');
    el.dataset.wtId = 'p2';
    el.setTranslation('Hello world');
    document.body.appendChild(el);

    const body = el.shadowRoot.querySelector('.wt-body');
    expect(body.innerHTML).toBe('Hello world');
  });

  it('has a toggle button', () => {
    const el = document.createElement('wt-translation');
    el.dataset.wtId = 'p3';
    el.setTranslation('Test');
    document.body.appendChild(el);

    const btn = el.shadowRoot.querySelector('.wt-toggle');
    expect(btn).toBeTruthy();
    // i18n not initialized in test env; t() returns the key as fallback
    expect(btn.textContent).toMatch(/Collapse|折叠|inline.toggle_fold/);
  });

  it('toggles fold state', () => {
    const el = document.createElement('wt-translation');
    el.dataset.wtId = 'p4';
    el.setTranslation('Content');
    document.body.appendChild(el);

    const body = el.shadowRoot.querySelector('.wt-body');
    const btn = el.shadowRoot.querySelector('.wt-toggle');
    expect(body.classList.contains('folded')).toBe(false);

    el.toggle();
    expect(body.classList.contains('folded')).toBe(true);
    // i18n not initialized; check for any valid text
    expect(btn.textContent).toMatch(/Expand|展开|inline.toggle_unfold/);

    el.toggle();
    expect(body.classList.contains('folded')).toBe(false);
    expect(btn.textContent).toMatch(/Collapse|折叠|inline.toggle_fold/);
  });

  it('sanitizes dangerous HTML', () => {
    const el = document.createElement('wt-translation');
    el.dataset.wtId = 'p5';
    el.setTranslation('<script>alert(1)</script><b>Safe</b>');
    document.body.appendChild(el);

    const body = el.shadowRoot.querySelector('.wt-body');
    expect(body.innerHTML).not.toContain('<script>');
    expect(body.innerHTML).toContain('<b>Safe</b>');
  });
});
