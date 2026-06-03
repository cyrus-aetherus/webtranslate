/**
 * Integration test: CS -> SW -> Mock API -> SW -> CS full flow
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MockServer } from './mock-server.js';
import { ApiProxy } from '../../src/background/api-proxy.js';

describe('Full API flow', () => {
  let server;
  let proxy;

  beforeAll(async () => {
    server = new MockServer(3457);
    await server.start();
    proxy = new ApiProxy();
  });

  beforeEach(() => {
    server.requestCount = 0;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('translates a batch via mock server', async () => {
    server.setScenario('success');

    const { results } = await proxy.translateBatch(
      [{ id: 'p1', fingerprint: 'abc', text: 'Hello' }],
      {
        adapter: 'openai',
        apiUrl: 'http://localhost:3457',
        apiKey: 'sk-test',
        model: 'gpt-4',
        sourceLang: 'auto',
        targetLang: 'zh-CN',
      },
      'batch1'
    );

    expect(results).toHaveLength(1);
    expect(results[0].translation).toBe('Translated text');
  });

  it('retries on rate limit then succeeds', async () => {
    server.setScenario('rateLimit');

    // First call should fail with 429
    await expect(
      proxy.translateBatch(
        [{ id: 'p1', fingerprint: 'abc', text: 'Hello' }],
        {
          adapter: 'openai',
          apiUrl: 'http://localhost:3457',
          apiKey: 'sk-test',
          model: 'gpt-4',
          sourceLang: 'auto',
          targetLang: 'zh-CN',
        },
        'batch2'
      )
    ).rejects.toThrow('Rate limited');
  });

  it('fails immediately on 401', async () => {
    server.setScenario('authFail');

    await expect(
      proxy.translateBatch(
        [{ id: 'p1', fingerprint: 'abc', text: 'Hello' }],
        {
          adapter: 'openai',
          apiUrl: 'http://localhost:3457',
          apiKey: 'sk-test',
          model: 'gpt-4',
          sourceLang: 'auto',
          targetLang: 'zh-CN',
        },
        'batch3'
      )
    ).rejects.toThrow('Auth failed');

    expect(server.requestCount).toBeLessThanOrEqual(2); // no retries
  });
});
