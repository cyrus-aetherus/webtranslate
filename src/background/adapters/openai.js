/**
 * OpenAI-compatible adapter
 * Covers GPT, DeepSeek, Tongyi Qianwen, and any OpenAI-format API.
 */

/**
 * @typedef {Object} AdapterRequest
 * @property {string} url
 * @property {HeadersInit} headers
 * @property {string} body
 */

/**
 * Build a chat completion request for OpenAI-compatible endpoints.
 * @param {{sys:string, user:string}} prompt - system + user messages
 * @param {object} config - user config (apiUrl, apiKey, model, temperature)
 * @param {number} maxTokens
 * @returns {AdapterRequest}
 */
export function buildRequest(prompt, config, maxTokens) {
  const base = config.apiUrl.replace(/\/$/, '').replace(/\/v1$/, '');
  const url = `${base}/v1/chat/completions`;

  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: prompt.sys },
        { role: 'user', content: prompt.user },
      ],
      temperature: config.temperature ?? 0.1,
      max_tokens: maxTokens,
      stream: false,
    }),
  };
}

/**
 * Extract translation text from OpenAI-style response JSON.
 * @param {any} raw
 * @returns {string}
 */
export function parseResponse(raw) {
  const choice = raw.choices?.[0];
  if (!choice) {
    throw new Error('No choices in API response');
  }
  return {
    content: choice.message?.content ?? '',
    usage: raw.usage ? {
      promptTokens: raw.usage.prompt_tokens,
      completionTokens: raw.usage.completion_tokens,
    } : null,
  };
}
