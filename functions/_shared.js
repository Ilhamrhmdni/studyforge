const encoder = new TextEncoder();
const decoder = new TextDecoder();
const derivedKeys = new Map();

export function sendJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

export async function readJson(request) {
  const text = (await request.text()).trim();
  return text ? JSON.parse(text) : {};
}

export function extractBearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

export function getServiceConfigError(env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return 'SUPABASE_SERVICE_ROLE_KEY belum diset.';
  if (!env.QUIZ_ENCRYPTION_SECRET) return 'QUIZ_ENCRYPTION_SECRET belum diset.';
  return '';
}

export function isDraftTitle(title) {
  return String(title || '').startsWith('[DRAFT]');
}

export async function supabaseFetch(env, path, options = {}) {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = data && typeof data === 'object' && data.message
      ? data.message
      : `Supabase error ${response.status}`;
    throw new Error(message);
  }

  return data;
}

export async function getUserFromToken(env, accessToken) {
  if (!accessToken) return null;

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) return null;
  return response.json();
}

export async function getProfile(env, userId) {
  const params = new URLSearchParams({
    select: 'id,email,full_name,role',
    id: `eq.${userId}`
  });
  const rows = await supabaseFetch(env, `/rest/v1/profiles?${params.toString()}`);
  return rows[0] || null;
}

export async function requireAdmin(context) {
  const token = extractBearerToken(context.request);
  const user = await getUserFromToken(context.env, token);
  if (!user) return { ok: false, status: 401, message: 'Sesi login tidak valid.' };

  const profile = await getProfile(context.env, user.id);
  if (!profile || profile.role !== 'admin') {
    return { ok: false, status: 403, message: 'Akses admin diperlukan.' };
  }

  return { ok: true, user, profile };
}

async function deriveQuizKey(secret) {
  if (!derivedKeys.has(secret)) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
    const key = await crypto.subtle.importKey(
      'raw',
      digest,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    derivedKeys.set(secret, key);
  }
  return derivedKeys.get(secret);
}

function bytesToBase64Url(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function encryptAnswer(secret, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveQuizKey(secret);
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(String(value))
  );
  const encrypted = new Uint8Array(encryptedBuffer);
  const tag = encrypted.slice(encrypted.length - 16);
  const cipher = encrypted.slice(0, encrypted.length - 16);
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(cipher)}.${bytesToBase64Url(tag)}`;
}

export async function decryptAnswer(secret, token) {
  const [ivPart, dataPart, tagPart] = String(token || '').split('.');
  if (!ivPart || !dataPart || !tagPart) throw new Error('Format answer token tidak valid.');

  const iv = base64UrlToBytes(ivPart);
  const cipher = base64UrlToBytes(dataPart);
  const tag = base64UrlToBytes(tagPart);
  const combined = new Uint8Array(cipher.length + tag.length);
  combined.set(cipher, 0);
  combined.set(tag, cipher.length);

  const key = await deriveQuizKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    combined
  );
  return decoder.decode(decrypted);
}

export function sanitizeQuestion(question, index) {
  return {
    qid: `q-${index + 1}`,
    num: question.num || index + 1,
    text: question.text || '',
    image: question.image || null,
    options: (question.options || []).map((option) => ({
      id: String(option.key || ''),
      text: option.text || ''
    }))
  };
}

export async function prepareQuestionsForStorage(env, questions) {
  const prepared = [];
  for (let index = 0; index < (questions || []).length; index++) {
    const question = questions[index];
    prepared.push({
      num: question.num || index + 1,
      text: question.text || '',
      image: question.image || null,
      options: (question.options || []).map((option) => ({
        key: String(option.key || ''),
        text: option.text || ''
      })),
      answer_token: await encryptAnswer(env.QUIZ_ENCRYPTION_SECRET, String(question.answer || ''))
    });
  }
  return prepared;
}

export async function resolveStoredAnswer(env, question) {
  if (question.answer_token) return decryptAnswer(env.QUIZ_ENCRYPTION_SECRET, question.answer_token);
  return String(question.answer || '');
}

export async function getQuizById(env, id) {
  const params = new URLSearchParams({
    select: 'id,title,subject,description,duration,count,created_at,questions',
    id: `eq.${id}`
  });
  const rows = await supabaseFetch(env, `/rest/v1/quizzes?${params.toString()}`);
  return rows[0] || null;
}
