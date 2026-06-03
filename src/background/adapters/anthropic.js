/**
 * Anthropic Messages API adapter
 * https://docs.anthropic.com/en/api/messages
 */

/**
 * Build a Messages request for Anthropic Claude.
 * @param {{sys:string, user:string}} prompt
 * @param {object} config
 * @param {number} maxTokens
 * @returns {import('./openai.js').AdapterRequest}
 */
export function buildRequest(prompt, config, maxTokens) {
  const base = config.apiUrl.replace(/\/$/, '');
  const url = `${base}/v1/messages`;

  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      temperature: config.temperature ?? 0.1,
      system: prompt.sys,
      messages: [
        { role: 'user', content: prompt.user },
      ],
      stream: false,
    }),
  };
}

/**
 * Extract translation text from Anthropic Messages response.
 * @param {any} raw
 * @returns {string}
 */
export function parseResponse(raw) {
  const block = raw.content?.[0];
  if (!block) {
    throw new Error('No content blocks in Anthropic response');
  }
  return {
    content: block.text ?? '',
    usage: raw.usage ? {
      promptTokens: raw.usage.input_tokens,
      completionTokens: raw.usage.output_tokens,
    } : null,
  };
}
