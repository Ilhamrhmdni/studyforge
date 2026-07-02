import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wsmclqrqfhrzysxgmfdj.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const QUIZ_ENCRYPTION_SECRET = process.env.QUIZ_ENCRYPTION_SECRET;

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY belum diset.');
  process.exit(1);
}

if (!QUIZ_ENCRYPTION_SECRET) {
  console.error('QUIZ_ENCRYPTION_SECRET belum diset.');
  process.exit(1);
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
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || `Supabase error ${response.status}`);
  }
  return data;
}

function secureQuestions(questions) {
  return (questions || []).map((question, index) => {
    if (question.answer_token) return question;
    return {
      num: question.num || index + 1,
      text: question.text || '',
      image: question.image || null,
      options: (question.options || []).map((option) => ({
        key: String(option.key || ''),
        text: option.text || ''
      })),
      answer_token: encryptAnswer(String(question.answer || ''))
    };
  });
}

const quizzes = await supabaseFetch('/rest/v1/quizzes?select=id,title,questions');
for (const quiz of quizzes || []) {
  const hasPlainAnswers = (quiz.questions || []).some((question) => question.answer && !question.answer_token);
  if (!hasPlainAnswers) continue;

  console.log(`Securing ${quiz.id} - ${quiz.title}`);
  await supabaseFetch(`/rest/v1/quizzes?id=eq.${quiz.id}`, {
    method: 'PATCH',
    body: {
      questions: secureQuestions(quiz.questions)
    }
  });
}

console.log('Selesai mengamankan quiz yang masih menyimpan jawaban plaintext.');
