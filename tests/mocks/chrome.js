/**
 * Unified chrome API mock for Vitest tests.
 */
import { vi } from 'vitest';

export function createChromeMock() {
  const storage = {};
  const listeners = new Set();

  const chromeMock = {
    storage: {
      local: {
        get: vi.fn((keys) => {
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) {
              if (k in storage) out[k] = storage[k];
            }
            return Promise.resolve(out);
          }
          if (typeof keys === 'string') {
            return keys in storage ? Promise.resolve({ [keys]: storage[keys] }) : Promise.resolve({});
          }
          if (typeof keys === 'object' && keys !== null) {
            const out = {};
            for (const [k, v] of Object.entries(keys)) {
              if (k in storage) out[k] = storage[k];
              else out[k] = v;
            }
            return Promise.resolve(out);
          }
          return Promise.resolve({ ...storage });
        }),
        set: vi.fn((items) => {
          Object.assign(storage, items);
          const changes = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { newValue: v, oldValue: storage[k] };
          }
          for (const cb of listeners) cb(changes, 'local');
          return Promise.resolve();
        }),
        remove: vi.fn((keys) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) delete storage[k];
          return Promise.resolve();
        }),
        clear: vi.fn(() => {
          for (const k of Object.keys(storage)) delete storage[k];
          return Promise.resolve();
        }),
        onChanged: {
          addListener: vi.fn((cb) => listeners.add(cb)),
          removeListener: vi.fn((cb) => listeners.delete(cb)),
        },
      },
    },
    runtime: {
      getURL: vi.fn((path) => `chrome-extension://test/${path}`),
      sendMessage: vi.fn(() => Promise.resolve({})),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      connect: vi.fn(() => ({
        postMessage: vi.fn(),
        disconnect: vi.fn(),
        onDisconnect: { addListener: vi.fn() },
      })),
    },
    tabs: {
      sendMessage: vi.fn(() => Promise.resolve()),
    },
    downloads: {
      download: vi.fn(() => Promise.resolve(1)),
    },
    action: {
      openPopup: vi.fn(() => Promise.resolve()),
    },
    sidePanel: {
      open: vi.fn(() => Promise.resolve()),
    },
  };

  return { chromeMock, storage };
}
