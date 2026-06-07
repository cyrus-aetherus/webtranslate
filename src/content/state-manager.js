/**
 * StateManager - Translation state machine
 * States: IDLE → SCANNING → TRANSLATING ↔ PAUSED → ERROR → IDLE
 * All transitions are guarded; invalid transitions are rejected.
 */

import { State } from '../shared/constants.js';

const VALID_TRANSITIONS = {
  // IDLE → PAUSED: page refresh while Panel translation was active.
  // Panel can't auto-restart without a user gesture, so we transition
  // directly to PAUSED to tell the user "click Resume to continue".
  [State.IDLE]: [State.SCANNING, State.PAUSED],
  [State.SCANNING]: [State.TRANSLATING, State.IDLE, State.ERROR],
  [State.TRANSLATING]: [State.PAUSED, State.IDLE, State.ERROR],
  [State.PAUSED]: [State.TRANSLATING, State.IDLE, State.ERROR],
  [State.ERROR]: [State.IDLE, State.SCANNING],
};

export class StateManager {
  constructor() {
    this._state = State.IDLE;
    this._listeners = [];
  }

  /** @returns {string} current state */
  get() {
    return this._state;
  }

  /**
   * Attempt to transition to a new state.
   * @param {string} to
   * @returns {boolean} true if transition succeeded
   */
  transition(to) {
    const from = this._state;
    const allowed = VALID_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      console.warn(`[WT] Invalid state transition: ${from} -> ${to}`);
      return false;
    }
    this._state = to;
    this._notify(to, from);
    return true;
  }

  /**
   * Register a state change listener.
   * @param {(newState: string, oldState: string) => void} fn
   */
  onChange(fn) {
    this._listeners.push(fn);
  }

  _notify(to, from) {
    for (const fn of this._listeners) {
      try {
        fn(to, from);
      } catch (err) {
        console.error('[WT] State listener error:', err);
      }
    }
  }
}
