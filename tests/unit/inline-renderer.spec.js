/**
 * Unit tests for content/renderers/inline-renderer.js
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

global.chrome = {
  storage: { session: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue() } },
};

import { InlineRenderer } from '../../src/content/renderers/inline-renderer.js';

describe('InlineRenderer', () => {
  let renderer;

  beforeEach(() => {
    document.body.innerHTML = '';
    renderer = new InlineRenderer();
  });

  it('inserts translation block after original element', () => {
    const p = document.createElement('p');
    p.textContent = 'Original';
    document.body.appendChild(p);

    const div = renderer.render(p, 'Translated', 'p1');
    expect(p.nextElementSibling).toBe(div);
    expect(div.classList.contains('wt-inline-block')).toBe(true);
  });

  it('removes and replaces duplicate translation blocks', () => {
    const p = document.createElement('p');
    p.textContent = 'Original';
    document.body.appendChild(p);

    const d1 = renderer.render(p, 'T1', 'p1');
    expect(p.nextElementSibling).toBe(d1);
    // Second render removes old block, creates new one
    const d2 = renderer.render(p, 'T2', 'p1');
    expect(d1).not.toBe(d2);
    expect(p.nextElementSibling).toBe(d2);
    // Old block is gone
    expect(document.body.contains(d1)).toBe(false);
  });

  it('marks original element as translated', () => {
    const p = document.createElement('p');
    p.textContent = 'Original';
    document.body.appendChild(p);
    renderer.render(p, 'Translated', 'p2');
    expect(p.dataset.wtDone).toBeTruthy();
  });

  it('clearAll removes all translations', () => {
    const p1 = document.createElement('p');
    const p2 = document.createElement('p');
    document.body.append(p1, p2);
    renderer.render(p1, 'T1', 'id1');
    renderer.render(p2, 'T2', 'id2');
    expect(document.querySelectorAll('.wt-inline-block').length).toBe(2);
    renderer.clearAll();
    expect(document.querySelectorAll('.wt-inline-block').length).toBe(0);
  });

  it('update changes existing translation', () => {
    const p = document.createElement('p');
    document.body.appendChild(p);
    renderer.render(p, 'Old', 'id3');
    renderer.update('id3', 'New');
    const body = document.querySelector('.wt-inline-block[data-wt-id="id3"] .wt-inline-body');
    expect(body.textContent).toBe('New');
  });

  it('toggle button folds/unfolds', () => {
    const p = document.createElement('p');
    document.body.appendChild(p);
    const div = renderer.render(p, 'Content', 'id4');
    const btn = div.querySelector('button');
    const body = div.querySelector('.wt-inline-body');
    expect(body.style.display).toBe('');
    btn.click();
    expect(body.style.display).toBe('none');
    btn.click();
    expect(body.style.display).toBe('');
  });
});
