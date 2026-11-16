import { supabaseFetch } from './supabase.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const derivedKeys = new Map();

export function isDraftTitle(title) {
  return String(title || '').startsWith('[DRAFT]');
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
  const stableNum = Number.parseInt(question.num, 10) || index + 1;
  return {
    qid: String(question.qid || `q-${stableNum}`),
    num: stableNum,
    text: question.text || '',
    image: question.image || null,
    options: (question.options || []).map((option) => ({
      id: String(option.key || option.id || ''),
      text: option.text || ''
    }))
  };
}

export async function prepareQuestionsForStorage(env, questions) {
  const prepared = [];
  for (let index = 0; index < (questions || []).length; index++) {
    const question = questions[index];
    const stableNum = Number.parseInt(question.num, 10) || index + 1;
    let rawOptions = [];
    if (Array.isArray(question.options)) {
      rawOptions = question.options;
    } else if (question.options && typeof question.options === 'object') {
      rawOptions = Object.entries(question.options).map(([k, v]) => ({
        key: k,
        text: typeof v === 'object' && v !== null ? v.text || '' : String(v)
      }));
    }

    prepared.push({
      num: stableNum,
      text: question.text || '',
      image: question.image || null,
      options: rawOptions.map((option) => ({
        key: String(option.key || option.id || ''),
        text: option.text || ''
      })),
      answer_token: await encryptAnswer(env.QUIZ_ENCRYPTION_SECRET, String(question.answer || ''))
    });
  }
  return prepared;
}

export async function resolveStoredAnswer(env, question) {
  if (question.answer_token) {
    const decrypted = await decryptAnswer(env.QUIZ_ENCRYPTION_SECRET, question.answer_token);
    return String(decrypted || '').trim().toUpperCase();
  }
  return String(question.answer || '').trim().toUpperCase();
}

export async function getQuizById(env, id) {
  const params = new URLSearchParams({
    select: 'id,title,subject,description,duration,count,created_at,is_hidden,questions,creator_id,visibility,review_status',
    id: `eq.${id}`
  });
  const rows = await supabaseFetch(env, `/rest/v1/quizzes?${params.toString()}`);
  return rows[0] || null;
}
