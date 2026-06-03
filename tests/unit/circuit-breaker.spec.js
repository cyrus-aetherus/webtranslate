/**
 * Unit tests for content/circuit-breaker.js
 */

import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker } from '../../src/content/circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('starts closed', () => {
    const cb = new CircuitBreaker();
    expect(cb.isOpen()).toBe(false);
  });

  it('opens after threshold failures', () => {
    const cb = new CircuitBreaker({ threshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(false);
    const tripped = cb.recordFailure();
    expect(tripped).toBe(true);
    expect(cb.isOpen()).toBe(true);
  });

  it('resets on success', () => {
    const cb = new CircuitBreaker({ threshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    expect(cb.isOpen()).toBe(false);
  });

  it('calls onOpen when tripped', () => {
    const onOpen = vi.fn();
    const cb = new CircuitBreaker({ threshold: 2, onOpen });
    cb.recordFailure();
    cb.recordFailure();
    expect(onOpen).toHaveBeenCalled();
  });

  it('manual reset closes breaker', () => {
    const cb = new CircuitBreaker({ threshold: 1 });
    cb.recordFailure();
    expect(cb.isOpen()).toBe(true);
    cb.reset();
    expect(cb.isOpen()).toBe(false);
  });

  it('does not double-trip', () => {
    const onOpen = vi.fn();
    const cb = new CircuitBreaker({ threshold: 2, onOpen });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
