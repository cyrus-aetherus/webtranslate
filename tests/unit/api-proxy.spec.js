/**
 * Unit tests for background/api-proxy.js retry logic
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiProxy } from '../../src/background/api-proxy.js';

describe('ApiProxy retry', () => {
  let proxy;

  beforeEach(() => {
    proxy = new ApiProxy();
    global.fetch = vi.fn();
  });

  it('succeeds on first attempt', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '───SEP:abc───\nHello\n───SEP:END───' } }],
      }),
    });

    const { results } = await proxy.translateBatch(
      [{ id: 'p1', fingerprint: 'abc', text: 'Hi' }],
      { adapter: 'openai', apiUrl: 'https://api.example.com', apiKey: 'sk-test', model: 'gpt-4', sourceLang: 'auto', targetLang: 'zh-CN' },
      'batch1'
    );

    expect(results[0].translation).toBe('Hello');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('uses the Anthropic adapter when selected', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ text: '───SEP:abc───\n你好\n───SEP:END───' }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });

    const { results } = await proxy.translateBatch(
      [{ id: 'p1', fingerprint: 'abc', text: 'Hello' }],
      { adapter: 'anthropic', apiUrl: 'https://api.anthropic.com', apiKey: 'sk-ant-test', model: 'claude-sonnet-4', sourceLang: 'en', targetLang: 'zh-CN' },
      'anthropic-batch'
    );

    expect(results[0].translation).toBe('你好');
    expect(fetch.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
    expect(fetch.mock.calls[0][1].headers['x-api-key']).toBe('sk-ant-test');
  });

  it('retries on 500 then succeeds', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Server Error' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '───SEP:abc───\nHello\n───SEP:END───' } }],
        }),
      });

    const { results } = await proxy.translateBatch(
      [{ id: 'p1', fingerprint: 'abc', text: 'Hi' }],
      { adapter: 'openai', apiUrl: 'https://api.example.com', apiKey: 'sk-test', model: 'gpt-4', sourceLang: 'auto', targetLang: 'zh-CN' },
      'batch2'
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(results[0].translation).toBe('Hello');
  });

  it('does not retry on 401', async () => {
    fetch.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' });

    await expect(
      proxy.translateBatch(
        [{ id: 'p1', fingerprint: 'abc', text: 'Hi' }],
        { adapter: 'openai', apiUrl: 'https://api.example.com', apiKey: 'sk-test', model: 'gpt-4', sourceLang: 'auto', targetLang: 'zh-CN' },
        'batch3'
      )
    ).rejects.toThrow('Auth failed');

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('gives up after 2 retries', async () => {
    fetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'Error' });

    await expect(
      proxy.translateBatch(
        [{ id: 'p1', fingerprint: 'abc', text: 'Hi' }],
        { adapter: 'openai', apiUrl: 'https://api.example.com', apiKey: 'sk-test', model: 'gpt-4', sourceLang: 'auto', targetLang: 'zh-CN' },
        'batch4'
      )
    ).rejects.toThrow('HTTP 500');

    expect(fetch).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
