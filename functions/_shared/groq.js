const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instruct'
];

export function getGroqApiKeys(env) {
  const poolRaw = String(env?.GROQ_API_KEYS || '').trim();
  const singleRaw = String(env?.GROQ_API_KEY || '').trim();
  const keys = poolRaw
    ? poolRaw.split(',').map((k) => k.trim()).filter(Boolean)
    : [];
  if (singleRaw && !keys.includes(singleRaw)) {
    keys.push(singleRaw);
  }
  return keys;
}

async function callSingleGroq(apiKey, model, messages, options = {}) {
  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 4096
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errMsg = data?.error?.message || `HTTP ${res.status}`;
    return { ok: false, status: res.status, errMsg };
  }

  const content = data?.choices?.[0]?.message?.content?.trim() || '';
  return content
    ? { ok: true, content, model }
    : { ok: false, status: 502, errMsg: 'Respons Groq kosong.' };
}

/**
 * Call Groq Chat Completions with multi-key pool rotation and model fallback.
 */
export async function runGroqWithPool(env, messages, options = {}) {
  const keys = getGroqApiKeys(env);
  if (keys.length === 0) {
    return { ok: false, configured: false, error: 'GROQ_API_KEYS belum dikonfigurasi.' };
  }

  const startOffset = Math.floor(Math.random() * keys.length);
  const rotatedKeys = keys.map((_, idx) => keys[(startOffset + idx) % keys.length]);
  let lastError = 'Semua Groq API key gagal merespons.';

  for (const model of GROQ_MODELS) {
    for (const key of rotatedKeys) {
      const result = await callSingleGroq(key, model, messages, options);
      if (result.ok) {
        return { ok: true, configured: true, content: result.content, model: result.model };
      }
      lastError = result.errMsg;
      // On 429 rate-limit or 401/403 key error, rotate immediately to the next key in the pool.
      if (result.status === 429 || result.status === 401 || result.status === 403) {
        continue;
      }
      // On model-level errors (e.g. 404/400), move to the next fallback model.
      break;
    }
  }

  return { ok: false, configured: true, error: lastError };
}
