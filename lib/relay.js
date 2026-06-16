import { BACKENDS, resolve, buildUrl } from './backends.js';
import { KEYS, mget, get, set, watch } from './keeper.js';

let state = null;

async function sync() {
  const cfg = await mget([
    KEYS.backend, KEYS.customGw, KEYS.secret,
    KEYS.model, KEYS.preamble, KEYS.temperature, KEYS.maxTokens,
    KEYS.activePreset, KEYS.activePreprompt, KEYS.presets, KEYS.preprompts,
    KEYS.modelPerBackend,
  ]);
  const id = cfg[KEYS.backend] || 'openrouter';
  const gw = cfg[KEYS.customGw] || '';
  const secret = cfg[KEYS.secret] || '';
  const modelMap = cfg[KEYS.modelPerBackend] || {};
  const model = cfg[KEYS.model] || modelMap[id] || resolve(id).fallback;
  const preamble = cfg[KEYS.preamble] || '';
  const temp = cfg[KEYS.temperature] ?? 0.7;
  const maxTok = cfg[KEYS.maxTokens] ?? 4096;
  const activePreset = cfg[KEYS.activePreset] || null;
  const activePreprompt = cfg[KEYS.activePreprompt] || null;
  const presets = cfg[KEYS.presets] || [];
  const preprompts = cfg[KEYS.preprompts] || [];

  let resolvedPreamble = preamble;
  if (activePreprompt) {
    const pp = preprompts.find(p => p.name === activePreprompt);
    if (pp) resolvedPreamble = pp.content;
  }

  state = { id, gw, secret, model, preamble: resolvedPreamble, temp, maxTok, activePreset, presets, preprompts };
}

watch((c) => {
  const relevant = [
    KEYS.backend, KEYS.customGw, KEYS.secret, KEYS.model, KEYS.preamble,
    KEYS.temperature, KEYS.maxTokens, KEYS.activePreset, KEYS.activePreprompt,
    KEYS.presets, KEYS.preprompts, KEYS.modelPerBackend,
  ];
  if (relevant.some(k => k in c)) sync();
});

export async function ensure() {
  if (!state) await sync();
  return state;
}

export async function refresh() {
  state = null;
  return await ensure();
}

export function snapshot() {
  return state;
}

function buildConfig(cfg) {
  const backend = resolve(cfg.id);
  let model = cfg.model;
  if (!model || model === '') model = backend.fallback;
  const url = buildUrl(cfg.id, cfg.gw, model);
  const headers = { 'Content-Type': 'application/json' };
  const extra = backend.extraHeaders?.() || {};
  Object.assign(headers, extra);
  if (backend.auth.scheme === 'Bearer') {
    headers[backend.auth.header] = `Bearer ${cfg.secret}`;
  } else if (backend.auth.scheme === 'ApiKey') {
    headers[backend.auth.header] = cfg.secret;
  }
  return { backend, model, url, headers };
}

export async function send(conversation, onToken, onDone, onFail) {
  let cfg;
  try {
    cfg = await ensure();
  } catch (err) {
    onFail?.(new Error('Failed to load config: ' + err.message));
    return;
  }

  if (!cfg.secret) {
    onFail?.(new Error('No API key configured. Open Settings and add your secret key.'));
    return;
  }

  const { backend, model, url, headers } = buildConfig(cfg);
  const body = backend.wrap(conversation, cfg.preamble, model, cfg.maxTok, cfg.temp);

  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const snippet = errBody.slice(0, 500) || '(no body)';
      throw new Error(`API ${res.status} — ${snippet}`);
    }

    const ctype = res.headers.get('content-type') || '';
    let full = '';

    if (ctype.includes('event-stream')) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim();
            if (!raw || raw === '[DONE]') continue;
            try {
              const pkt = JSON.parse(raw);
              let tok = '';
              if (backend.extractStream) {
                tok = backend.extractStream(pkt);
              } else {
                tok = pkt.choices?.[0]?.delta?.content || '';
              }
              if (tok) { full += tok; onToken?.(tok); }
            } catch { }
          }
        }
      }
      if (!full && backend.label !== 'Gemini') {
        onDone?.({ content: full, role: 'assistant', backend: cfg.id, model });
      } else {
        onDone?.({ content: full, role: 'assistant', backend: cfg.id, model });
      }
    } else {
      const text = await res.text();
      if (!text) throw new Error('Empty response from API');
      let json;
      try { json = JSON.parse(text); } catch { throw new Error('Non-JSON response: ' + text.slice(0, 300)); }
      const content = backend.unwrap(json);
      if (!content) throw new Error('API returned empty content — check model name and permissions');
      onToken?.(content);
      onDone?.({ content, role: 'assistant', backend: cfg.id, model });
    }
  } catch (err) {
    onFail?.(err);
  }
}

export async function testConnection(backendId, customGw, secretKey, modelName) {
  const backend = resolve(backendId);
  if (!secretKey) return { success: false, error: 'No API key provided' };
  const url = buildUrl(backendId, customGw, modelName);
  const headers = { 'Content-Type': 'application/json' };
  const extra = backend.extraHeaders?.() || {};
  Object.assign(headers, extra);
  if (backend.auth.scheme === 'Bearer') {
    headers[backend.auth.header] = `Bearer ${secretKey}`;
  } else if (backend.auth.scheme === 'ApiKey') {
    headers[backend.auth.header] = secretKey;
  }

  const payload = backend.testPayload ? backend.testPayload() : { max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] };

  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return { success: false, error: `HTTP ${res.status}: ${errBody.slice(0, 300)}` };
    }
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { return { success: false, error: 'Non-JSON response from API' }; }
    const ok = backend.testExtract ? backend.testExtract(json) : (json.choices?.[0]?.message?.content !== undefined);
    return ok
      ? { success: true, error: null }
      : { success: false, error: 'Unexpected API response format' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
