/**
 * Unit tests for content/components/fab.js
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FabComponent } from '../../src/content/components/fab.js';

describe('FabComponent', () => {
  let fab;
  beforeEach(() => {
    document.body.innerHTML = '';
    global.chrome = { storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue() } } };
    fab = new FabComponent();
  });

  it('mounts FAB element to body', () => { fab.mount(); expect(document.getElementById('wt-fab')).toBeTruthy(); });
  it('mounts backdrop to body', () => { fab.mount(); expect(document.getElementById('wt-fab-backdrop')).toBeTruthy(); });
  it('starts with idle state', () => { fab.mount(); expect(fab.el.classList.contains('wt-idle')).toBe(true); });
  it('setState changes class', () => { fab.mount(); fab.setState('active'); expect(fab.el.classList.contains('wt-active')).toBe(true); fab.setState('idle'); expect(fab.el.classList.contains('wt-idle')).toBe(true); });
  it('menu has 5 items', () => { fab.mount(); expect(fab._menuItems.length).toBe(5); });
  it('calls callback on menu click', () => { const fn = vi.fn(); fab.onTranslateInline = fn; fab.mount(); fab._menuItems[0].click(); expect(fn).toHaveBeenCalled(); });
});
