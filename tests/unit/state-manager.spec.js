/**
 * Unit tests for content/state-manager.js
 */

import { describe, it, expect, vi } from 'vitest';
import { StateManager } from '../../src/content/state-manager.js';
import { State } from '../../src/shared/constants.js';

describe('StateManager', () => {
  it('starts in IDLE', () => {
    const sm = new StateManager();
    expect(sm.get()).toBe(State.IDLE);
  });

  it('allows IDLE -> SCANNING', () => {
    const sm = new StateManager();
    expect(sm.transition(State.SCANNING)).toBe(true);
    expect(sm.get()).toBe(State.SCANNING);
  });

  it('allows SCANNING -> TRANSLATING', () => {
    const sm = new StateManager();
    sm.transition(State.SCANNING);
    expect(sm.transition(State.TRANSLATING)).toBe(true);
  });

  it('allows TRANSLATING -> PAUSED -> TRANSLATING', () => {
    const sm = new StateManager();
    sm.transition(State.SCANNING);
    sm.transition(State.TRANSLATING);
    expect(sm.transition(State.PAUSED)).toBe(true);
    expect(sm.transition(State.TRANSLATING)).toBe(true);
  });

  it('rejects invalid IDLE -> TRANSLATING', () => {
    const sm = new StateManager();
    expect(sm.transition(State.TRANSLATING)).toBe(false);
    expect(sm.get()).toBe(State.IDLE);
  });

  it('notifies listeners on change', () => {
    const sm = new StateManager();
    const fn = vi.fn();
    sm.onChange(fn);
    sm.transition(State.SCANNING);
    expect(fn).toHaveBeenCalledWith(State.SCANNING, State.IDLE);
  });

  it('does not notify removed listeners', () => {
    const sm = new StateManager();
    const fn = vi.fn();
    sm.onChange(fn);
    sm.offChange(fn);
    sm.transition(State.SCANNING);
    expect(fn).not.toHaveBeenCalled();
  });

  it('tracks history', () => {
    const sm = new StateManager();
    sm.transition(State.SCANNING);
    sm.transition(State.TRANSLATING);
    const hist = sm.getHistory();
    expect(hist.length).toBe(2);
    expect(hist[0].from).toBe(State.IDLE);
    expect(hist[0].to).toBe(State.SCANNING);
  });
});
