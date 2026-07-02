const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wsmclqrqfhrzysxgmfdj.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const QUIZ_ENCRYPTION_SECRET = process.env.QUIZ_ENCRYPTION_SECRET || '';

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function extractBearerToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

function getServiceConfigError() {
  if (!SUPABASE_SERVICE_ROLE_KEY) return 'SUPABASE_SERVICE_ROLE_KEY belum diset.';
  if (!QUIZ_ENCRYPTION_SECRET) return 'QUIZ_ENCRYPTION_SECRET belum diset.';
  return '';
}

async function supabaseFetch(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
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
    const message = data && data.message ? data.message : `Supabase error ${response.status}`;
    throw new Error(message);
  }

  return data;
}

async function getUserFromToken(accessToken) {
  if (!accessToken) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) return null;
  return response.json();
}

async function getProfile(userId) {
  const params = new URLSearchParams({
    select: 'id,email,full_name,role',
    id: `eq.${userId}`
  });
  const rows = await supabaseFetch(`/rest/v1/profiles?${params.toString()}`);
  return rows[0] || null;
}

async function requireAdmin(req) {
  const token = extractBearerToken(req);
  const user = await getUserFromToken(token);
  if (!user) return { ok: false, status: 401, message: 'Sesi login tidak valid.' };

  const profile = await getProfile(user.id);
  if (!profile || profile.role !== 'admin') {
    return { ok: false, status: 403, message: 'Akses admin diperlukan.' };
  }

  return { ok: true, user, profile };
}

function isDraftTitle(title) {
  return String(title || '').startsWith('[DRAFT]');
}

function deriveQuizKey() {
  return crypto.createHash('sha256').update(QUIZ_ENCRYPTION_SECRET).digest();
}

function encryptAnswer(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveQuizKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${encrypted.toString('base64url')}.${tag.toString('base64url')}`;
}

function decryptAnswer(token) {
  const [ivPart, dataPart, tagPart] = String(token || '').split('.');
  if (!ivPart || !dataPart || !tagPart) throw new Error('Format answer token tidak valid.');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    deriveQuizKey(),
    Buffer.from(ivPart, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}

function sanitizeQuestion(question, index) {
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

function prepareQuestionsForStorage(questions) {
  return (questions || []).map((question, index) => ({
    num: question.num || index + 1,
    text: question.text || '',
    image: question.image || null,
    options: (question.options || []).map((option) => ({
      key: String(option.key || ''),
      text: option.text || ''
    })),
    answer_token: encryptAnswer(String(question.answer || ''))
  }));
}

function resolveStoredAnswer(question) {
  if (question.answer_token) return decryptAnswer(question.answer_token);
  return String(question.answer || '');
}

async function getQuizById(id) {
  const params = new URLSearchParams({
    select: 'id,title,subject,description,duration,count,created_at,questions',
    id: `eq.${id}`
  });
  const rows = await supabaseFetch(`/rest/v1/quizzes?${params.toString()}`);
  return rows[0] || null;
}

module.exports = {
  SUPABASE_URL,
  sendJson,
  readJson,
  extractBearerToken,
  getServiceConfigError,
  getUserFromToken,
  getProfile,
  requireAdmin,
  isDraftTitle,
  sanitizeQuestion,
  prepareQuestionsForStorage,
  resolveStoredAnswer,
  getQuizById,
  supabaseFetch
};
