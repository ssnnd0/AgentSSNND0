export const BACKENDS = {
  anthropic: {
    label: 'Anthropic',
    gateway: 'https://api.anthropic.com',
    path: '/v1/messages',
    stream: '',
    auth: { scheme: 'ApiKey', header: 'x-api-key' },
    models: [
      'claude-sonnet-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
    fallback: 'claude-sonnet-4-20250514',
    wrap: (msgs, sys, model, tok) => ({
      model,
      max_tokens: tok || 4096,
      stream: true,
      system: sys || undefined,
      messages: msgs.map(m => ({ role: m.role, content: m.content })),
    }),
    unwrap: (raw) => {
      if (raw.content && Array.isArray(raw.content)) {
        return raw.content.map(c => c.text || '').join('');
      }
      return raw.content?.[0]?.text || '';
    },
    extractStream: (pkt) => {
      if (pkt.type === 'content_block_delta' && pkt.delta?.text) return pkt.delta.text;
      if (pkt.type === 'content_block_stop') return '';
      return '';
    },
    extraHeaders: () => ({
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }),
    testPayload: () => ({ max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    testExtract: (raw) => raw.content?.[0]?.text ? true : false,
  },

  openrouter: {
    label: 'OpenRouter',
    gateway: 'https://openrouter.ai/api/v1',
    path: '/chat/completions',
    stream: '?stream=true',
    auth: { scheme: 'Bearer', header: 'Authorization' },
    models: [
      'anthropic/claude-sonnet-4-20250514',
      'openai/gpt-4o',
      'google/gemini-2.5-pro-exp-03-25',
      'meta-llama/llama-4-scout-17b',
      'deepseek/deepseek-r1',
      'mistral/mistral-large-2411',
    ],
    fallback: 'openai/gpt-4o',
    wrap: (msgs, sys, model, tok) => ({
      model,
      max_tokens: tok || 4096,
      stream: true,
      messages: sys ? [{ role: 'system', content: sys }, ...msgs] : msgs,
    }),
    unwrap: (raw) => raw.choices?.[0]?.message?.content || '',
    extractStream: (pkt) => pkt.choices?.[0]?.delta?.content || '',
    extraHeaders: () => ({
      'HTTP-Referer': 'https://github.com/ssnnd0/agent',
      'X-Title': 'SSNND0',
    }),
    testPayload: () => ({ max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    testExtract: (raw) => raw.choices?.[0]?.message?.content !== undefined,
  },

  openai: {
    label: 'GPT (OpenAI)',
    gateway: 'https://api.openai.com/v1',
    path: '/chat/completions',
    stream: '?stream=true',
    auth: { scheme: 'Bearer', header: 'Authorization' },
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    fallback: 'gpt-4o',
    wrap: (msgs, sys, model, tok) => ({
      model,
      max_tokens: tok || 4096,
      stream: true,
      messages: sys ? [{ role: 'system', content: sys }, ...msgs] : msgs,
    }),
    unwrap: (raw) => raw.choices?.[0]?.message?.content || '',
    extractStream: (pkt) => pkt.choices?.[0]?.delta?.content || '',
    extraHeaders: () => ({}),
    testPayload: () => ({ max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    testExtract: (raw) => raw.choices?.[0]?.message?.content !== undefined,
  },

  gemini: {
    label: 'Gemini',
    gateway: 'https://generativelanguage.googleapis.com/v1beta',
    path: '/models/{model}:generateContent',
    stream: '?alt=sse',
    auth: { scheme: 'ApiKey', header: 'x-goog-api-key' },
    models: ['gemini-2.5-pro-exp-03-25', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    fallback: 'gemini-2.5-pro-exp-03-25',
    pathTemplate: true,
    wrap: (msgs, sys, model, tok) => {
      const contents = msgs.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
      const body = { contents };
      if (tok) body.generationConfig = { maxOutputTokens: tok };
      if (sys) body.systemInstruction = { parts: [{ text: sys }] };
      return body;
    },
    unwrap: (raw) => raw.candidates?.[0]?.content?.parts?.reduce((a, p) => a + (p.text || ''), '') || '',
    extractStream: (pkt) => pkt.candidates?.[0]?.content?.parts?.reduce((a, p) => a + (p.text || ''), '') || '',
    extraHeaders: () => ({}),
    testPayload: () => ({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }], generationConfig: { maxOutputTokens: 1 } }),
    testExtract: (raw) => raw.candidates?.[0]?.content?.parts?.[0]?.text !== undefined,
  },

  deepseek: {
    label: 'DeepSeek',
    gateway: 'https://api.deepseek.com/v1',
    path: '/chat/completions',
    stream: '?stream=true',
    auth: { scheme: 'Bearer', header: 'Authorization' },
    models: ['deepseek-chat', 'deepseek-reasoner'],
    fallback: 'deepseek-chat',
    wrap: (msgs, sys, model, tok) => ({
      model,
      max_tokens: tok || 4096,
      stream: true,
      messages: sys ? [{ role: 'system', content: sys }, ...msgs] : msgs,
    }),
    unwrap: (raw) => raw.choices?.[0]?.message?.content || '',
    extractStream: (pkt) => pkt.choices?.[0]?.delta?.content || '',
    extraHeaders: () => ({}),
    testPayload: () => ({ max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    testExtract: (raw) => raw.choices?.[0]?.message?.content !== undefined,
  },

  mistral: {
    label: 'Mistral',
    gateway: 'https://api.mistral.ai/v1',
    path: '/chat/completions',
    stream: '?stream=true',
    auth: { scheme: 'Bearer', header: 'Authorization' },
    models: ['mistral-large-2411', 'mistral-small-2501', 'codestral-2501'],
    fallback: 'mistral-large-2411',
    wrap: (msgs, sys, model, tok) => ({
      model,
      max_tokens: tok || 4096,
      stream: true,
      messages: sys ? [{ role: 'system', content: sys }, ...msgs] : msgs,
    }),
    unwrap: (raw) => raw.choices?.[0]?.message?.content || '',
    extractStream: (pkt) => pkt.choices?.[0]?.delta?.content || '',
    extraHeaders: () => ({}),
    testPayload: () => ({ max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    testExtract: (raw) => raw.choices?.[0]?.message?.content !== undefined,
  },
};

export function resolve(id) {
  return BACKENDS[id] || BACKENDS.openrouter;
}

export function buildUrl(id, customGw, model) {
  const b = resolve(id);
  const base = (customGw || b.gateway).replace(/\/+$/, '');
  let path = b.path;
  if (b.pathTemplate || id === 'gemini') path = path.replace('{model}', model);
  return `${base}${path}${b.stream || ''}`;
}
