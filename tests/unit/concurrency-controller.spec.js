/**
 * Unit tests for content/concurrency-controller.js
 */

import { describe, it, expect, vi } from 'vitest';
import { ConcurrencyController } from '../../src/content/concurrency-controller.js';

describe('ConcurrencyController', () => {
  it('runs tasks immediately when under limit', async () => {
    const ctrl = new ConcurrencyController(2);
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await ctrl.run(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalled();
  });

  it('queues tasks when limit reached', async () => {
    const ctrl = new ConcurrencyController(1);
    let resolve1;
    const p1 = new Promise((r) => { resolve1 = r; });

    const fn1 = vi.fn(() => p1);
    const fn2 = vi.fn().mockResolvedValue('second');

    const r1 = ctrl.run(fn1);
    const r2 = ctrl.run(fn2);

    expect(ctrl.pendingCount()).toBe(1);
    resolve1('first');

    expect(await r1).toBe('first');
    expect(await r2).toBe('second');
    expect(fn2).toHaveBeenCalled();
  });

  it('cancelQueued rejects pending tasks', async () => {
    const ctrl = new ConcurrencyController(1);
    let resolve1;
    const p1 = new Promise((r) => { resolve1 = r; });

    const fn1 = vi.fn(() => p1);
    const fn2 = vi.fn().mockResolvedValue('second');

    ctrl.run(fn1);
    const r2 = ctrl.run(fn2);
    ctrl.cancelQueued();

    resolve1('first');
    await expect(r2).rejects.toThrow('Queue cancelled');
  });

  it('defaults limit to 3', () => {
    const ctrl = new ConcurrencyController();
    expect(ctrl.limit).toBe(3);
  });

  it('clamps limit to 1-10', () => {
    expect(new ConcurrencyController(0).limit).toBe(1);
    expect(new ConcurrencyController(15).limit).toBe(10);
  });
});
