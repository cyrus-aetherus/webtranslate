import { describe, it, expect } from 'vitest';
import { buildRequest as buildOpenAIRequest, parseResponse as parseOpenAIResponse } from '../../src/background/adapters/openai.js';
import { buildRequest as buildAnthropicRequest, parseResponse as parseAnthropicResponse } from '../../src/background/adapters/anthropic.js';

describe('OpenAI Adapter', () => {
  const config = {
    apiUrl: 'https://api.openai.com/',
    apiKey: 'sk-test',
    model: 'gpt-4o',
    temperature: 0.1,
  };
  const prompt = { sys: 'Translate to zh-CN', user: '───SEP:abc───\nHello\n───SEP:END───' };

  it('builds correct URL stripping trailing slash', () => {
    const req = buildOpenAIRequest(prompt, config, 256);
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions');
  });
  it('builds correct URL without double /v1', () => {
    const cfg = { ...config, apiUrl: 'https://api.openai.com/v1' };
    const req = buildOpenAIRequest(prompt, cfg, 256);
    expect(req.url).toBe('https://api.openai.com/v1/chat/completions');
  });
  it('includes Authorization header', () => {
    const req = buildOpenAIRequest(prompt, config, 256);
    expect(req.headers.Authorization).toBe('Bearer sk-test');
  });
  it('sets stream false', () => {
    const req = buildOpenAIRequest(prompt, config, 256);
    const body = JSON.parse(req.body);
    expect(body.stream).toBe(false);
  });
  it('defaults temperature to 0.1', () => {
    const cfg = { ...config, temperature: undefined };
    const req = buildOpenAIRequest(prompt, cfg, 256);
    const body = JSON.parse(req.body);
    expect(body.temperature).toBe(0.1);
  });
  it('parses successful response', () => {
    const raw = {
      choices: [{ message: { content: 'translated' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
    const res = parseOpenAIResponse(raw);
    expect(res.content).toBe('translated');
    expect(res.usage.promptTokens).toBe(10);
    expect(res.usage.completionTokens).toBe(5);
  });
  it('throws on missing choices', () => {
    expect(() => parseOpenAIResponse({})).toThrow('No choices');
  });
  it('handles missing usage gracefully', () => {
    const raw = { choices: [{ message: { content: 'ok' } }] };
    const res = parseOpenAIResponse(raw);
    expect(res.usage).toBeNull();
  });
});

describe('Anthropic Adapter', () => {
  const config = {
    apiUrl: 'https://api.anthropic.com/',
    apiKey: 'sk-ant-test',
    model: 'claude-3-opus',
    temperature: 0.2,
  };
  const prompt = { sys: 'Translate to ja', user: '───SEP:abc───\nHello\n───SEP:END───' };

  it('builds correct URL', () => {
    const req = buildAnthropicRequest(prompt, config, 512);
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
  });
  it('uses x-api-key header', () => {
    const req = buildAnthropicRequest(prompt, config, 512);
    expect(req.headers['x-api-key']).toBe('sk-ant-test');
    expect(req.headers['anthropic-version']).toBe('2023-06-01');
    expect(req.headers.Authorization).toBeUndefined();
  });
  it('places system at top level', () => {
    const req = buildAnthropicRequest(prompt, config, 512);
    const body = JSON.parse(req.body);
    expect(body.system).toBe('Translate to ja');
    expect(body.messages[0].role).toBe('user');
  });
  it('parses successful response', () => {
    const raw = {
      content: [{ text: 'translated' }],
      usage: { input_tokens: 8, output_tokens: 3 },
    };
    const res = parseAnthropicResponse(raw);
    expect(res.content).toBe('translated');
    expect(res.usage.promptTokens).toBe(8);
    expect(res.usage.completionTokens).toBe(3);
  });
  it('throws on missing content blocks', () => {
    expect(() => parseAnthropicResponse({})).toThrow('No content blocks');
  });
});
