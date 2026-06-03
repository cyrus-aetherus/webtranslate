/**
 * Unit tests for shared utilities
 * Run with: npm test
 */

import { describe, it, expect } from 'vitest';
import {
  djb2Hash,
  validateApiUrl,
  validateApiKey,
  validateModel,
  validateConcurrency,
  validateMaxBatchChars,
  buildBatchPrompt,
  parseBatchResponse,
  calcMaxTokens,
} from '../../src/shared/utils.js';

describe('djb2Hash', () => {
  it('returns a 14-char hex string', () => {
    const h = djb2Hash('hello world');
    expect(h).toMatch(/^[a-f0-9]{14}$/);
  });

  it('is deterministic for same input (first 12 chars)', () => {
    const a = djb2Hash('same');
    const b = djb2Hash('same');
    expect(a.slice(0, 12)).toBe(b.slice(0, 12));
  });

  it('differs for different inputs', () => {
    const a = djb2Hash('a');
    const b = djb2Hash('b');
    expect(a).not.toBe(b);
  });
});

describe('validateApiUrl', () => {
  it('accepts valid HTTPS URL', () => {
    const r = validateApiUrl('https://api.openai.com/v1');
    expect(r.valid).toBe(true);
    expect(r.isHttp).toBe(false);
  });

  it('accepts HTTP with isHttp flag', () => {
    const r = validateApiUrl('http://localhost:3000/v1');
    expect(r.valid).toBe(true);
    expect(r.isHttp).toBe(true);
  });

  it('rejects empty string', () => {
    expect(validateApiUrl('').valid).toBe(false);
  });

  it('rejects invalid format', () => {
    expect(validateApiUrl('not-a-url').valid).toBe(false);
  });
});

describe('validateApiKey', () => {
  it('accepts key with length >= 8', () => {
    expect(validateApiKey('12345678').valid).toBe(true);
  });

  it('rejects short key', () => {
    expect(validateApiKey('123').valid).toBe(false);
  });

  it('rejects empty key', () => {
    expect(validateApiKey('').valid).toBe(false);
  });
});

describe('validateModel', () => {
  it('accepts normal model name', () => {
    expect(validateModel('gpt-4o').valid).toBe(true);
  });

  it('rejects empty', () => {
    expect(validateModel('').valid).toBe(false);
  });

  it('rejects too long', () => {
    expect(validateModel('x'.repeat(101)).valid).toBe(false);
  });
});

describe('validateConcurrency', () => {
  it('accepts 1-10', () => {
    expect(validateConcurrency(3).valid).toBe(true);
  });

  it('rejects 0', () => {
    expect(validateConcurrency(0).valid).toBe(false);
  });

  it('rejects 11', () => {
    expect(validateConcurrency(11).valid).toBe(false);
  });
});

describe('validateMaxBatchChars', () => {
  it('accepts 500-5000', () => {
    expect(validateMaxBatchChars(800).valid).toBe(true);
  });

  it('rejects 499', () => {
    expect(validateMaxBatchChars(499).valid).toBe(false);
  });

  it('rejects 5001', () => {
    expect(validateMaxBatchChars(5001).valid).toBe(false);
  });
});

describe('buildBatchPrompt', () => {
  it('joins items with SEP markers', () => {
    const items = [
      { id: 'p1', fingerprint: 'abc', text: 'Hello' },
      { id: 'p2', fingerprint: 'def', text: 'World' },
    ];
    const prompt = buildBatchPrompt(items);
    expect(prompt).toContain('───SEP:abc───');
    expect(prompt).toContain('───SEP:def───');
    expect(prompt).toContain('───SEP:END───');
  });
});

describe('parseBatchResponse', () => {
  it('parses matching segments', () => {
    const items = [
      { id: 'p1', fingerprint: 'abc', text: 'Hello' },
      { id: 'p2', fingerprint: 'def', text: 'World' },
    ];
    const raw = '───SEP:abc───\n你好\n───SEP:def───\n世界\n───SEP:END───';
    const results = parseBatchResponse(raw, items);
    expect(results).toHaveLength(2);
    expect(results[0].translation).toBe('你好');
    expect(results[1].translation).toBe('世界');
  });

  it('throws on segment count mismatch', () => {
    const items = [{ id: 'p1', fingerprint: 'abc', text: 'Hello' }];
    const raw = '───SEP:abc───\n你好\n───SEP:extra───\n世界\n───SEP:END───';
    expect(() => parseBatchResponse(raw, items)).toThrow('Segment mismatch');
  });

  it('falls back to original text when fingerprint missing', () => {
    const items = [{ id: 'p1', fingerprint: 'abc', text: 'Hello' }];
    const raw = '───SEP:abc───\n你好\n───SEP:END───';
    const results = parseBatchResponse(raw, items);
    expect(results[0].translation).toBe('你好');
  });
});

describe('calcMaxTokens', () => {
  it('returns max(256, chars * 3)', () => {
    expect(calcMaxTokens(10)).toBe(256);
    expect(calcMaxTokens(200)).toBe(600);
  });
});
