/**
 * Unit tests for content/circuit-breaker.js
 */

import { describe, it, expect, vi } from 'vitest';
import { CircuitBreaker } from '../../src/content/circuit-breaker.js';

describe('CircuitBreaker', () => {
  it('opens after threshold failures', () => {
    const cb = new CircuitBreaker({ threshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    const tripped = cb.recordFailure();
    expect(tripped).toBe(true);
  });

  it('resets on success', () => {
    const cb = new CircuitBreaker({ threshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    const tripped = cb.recordFailure();
    expect(tripped).toBe(false);
  });

  it('calls onOpen when tripped', () => {
    const onOpen = vi.fn();
    const cb = new CircuitBreaker({ threshold: 2, onOpen });
    cb.recordFailure();
    cb.recordFailure();
    expect(onOpen).toHaveBeenCalled();
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
