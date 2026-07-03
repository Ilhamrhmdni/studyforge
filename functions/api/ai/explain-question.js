import { requireUser } from '../../_shared/auth.js';
import { sendJson } from '../../_shared/response.js';
import { supabaseFetch } from '../../_shared/supabase.js';
import { getQuizById, decryptAnswer } from '../../_shared/quiz.js';

// Rate limiting: maks 20 request AI per user per hari
const DAILY_LIMIT = 20;

async function checkRateLimit(env, userId) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const key = `ai_explain:${userId}:${today}`;

  try {
    const rows = await supabaseFetch(env,
      `/rest/v1/ai_usage_logs?user_id=eq.${userId}&usage_date=eq.${today}&select=request_count`
    );
    const count = rows?.[0]?.request_count || 0;
    return { allowed: count < DAILY_LIMIT, count, limit: DAILY_LIMIT };
  } catch {
    // Kalau tabel belum ada, izinkan dulu
    return { allowed: true, count: 0, limit: DAILY_LIMIT };
  }
}

async function incrementUsage(env, userId) {
  const today = new Date().toISOString().split('T')[0];
  try {
    // Upsert usage log
    await supabaseFetch(env, '/rest/v1/ai_usage_logs', {
      method: 'POST',
      headers: {
        'Prefer': 'resolution=merge-duplicates'
      },
      body: {
        user_id: userId,
        usage_date: today,
        request_count: 1
      }
    });
  } catch {
    // Jika tabel belum ada, abaikan saja
  }
}

export async function onRequestPost(context) {
  try {
    // 1. Verifikasi user login
    const auth = await requireUser(context);
    if (!auth.ok) {
      return sendJson({ error: auth.message }, auth.status);
    }
    const { user } = auth;

    // 2. Pastikan Workers AI binding tersedia
    if (!context.env.AI) {
      return sendJson({
        error: 'Fitur AI belum aktif. Silakan hubungi administrator.'
      }, 503);
    }

    // 3. Parse request body
    let body;
    try {
      body = await context.request.json();
    } catch {
      return sendJson({ error: 'Request tidak valid.' }, 400);
    }

    const { attempt_id, question_number } = body;
    if (!attempt_id || question_number === undefined) {
      return sendJson({ error: 'Parameter tidak lengkap: attempt_id dan question_number diperlukan.' }, 400);
    }

    // 4. Ambil attempt dan pastikan milik user ini
    const attemptRows = await supabaseFetch(context.env,
      `/rest/v1/quiz_attempts?id=eq.${encodeURIComponent(attempt_id)}&user_id=eq.${encodeURIComponent(user.id)}&select=*`
    );
    if (!attemptRows || attemptRows.length === 0) {
      return sendJson({ error: 'Hasil ujian tidak ditemukan atau bukan milik Anda.' }, 403);
    }
    const attempt = attemptRows[0];

    // 5. Ambil jawaban user untuk soal ini
    const answerRows = await supabaseFetch(context.env,
      `/rest/v1/quiz_attempt_answers?attempt_id=eq.${encodeURIComponent(attempt_id)}&user_id=eq.${encodeURIComponent(user.id)}&question_num=eq.${question_number}&select=*`
    );
    if (!answerRows || answerRows.length === 0) {
      return sendJson({ error: 'Data jawaban soal ini tidak ditemukan.' }, 404);
    }
    const answerData = answerRows[0];

    // 6. Cek rate limit
    const rateCheck = await checkRateLimit(context.env, user.id);
    if (!rateCheck.allowed) {
      return sendJson({
        error: `Batas harian tercapai. Kamu sudah menggunakan ${rateCheck.count}/${rateCheck.limit} pembahasan AI hari ini. Coba lagi besok.`
      }, 429);
    }

    // 7. Siapkan data soal untuk AI (hanya data yang diperlukan, bukan seluruh bank soal)
    const questionText = answerData.question_text || '';
    const options = Array.isArray(answerData.options) ? answerData.options : [];
    const correctAnswer = answerData.correct_answer || '';
    const userAnswer = answerData.user_answer || '(tidak dijawab)';
    const isCorrect = answerData.is_correct;
    const subject = attempt.quiz_title || '';

    // Format opsi jawaban
    const optionsText = options.map(o => `${o.key}. ${o.text}`).join('\n');

    // 8. Buat prompt AI
    const prompt = `Kamu adalah tutor ujian yang membantu mahasiswa belajar dari kesalahan mereka. 
Berikut adalah soal dari ujian "${subject}":

SOAL:
${questionText}

PILIHAN JAWABAN:
${optionsText}

JAWABAN USER: ${userAnswer}
JAWABAN BENAR: ${correctAnswer}
STATUS: ${isCorrect ? 'BENAR ✓' : 'SALAH ✗'}

Berikan pembahasan singkat, jelas, dan edukatif dalam Bahasa Indonesia.

Format pembahasan:
1. **Jawaban Benar**: Sebutkan jawaban benar dan alasannya secara singkat.
2. **Penjelasan Konsep**: Jelaskan konsep/teori yang mendasari soal ini (2-3 kalimat).
3. **Analisis Jawaban**: ${isCorrect ? 'Konfirmasi kenapa jawaban user sudah tepat.' : 'Jelaskan kenapa jawaban user salah dan kenapa jawaban benar itu benar.'}
4. **Tips**: Satu tips praktis untuk mengerjakan soal sejenis.

Aturan:
- Jangan terlalu panjang, maksimal 200 kata.
- Jangan membuat informasi di luar data soal yang diberikan.
- Jika data soal tidak cukup untuk memberi pembahasan mendalam, katakan bahwa pembahasan terbatas pada data yang ada.`;

    // 9. Panggil Workers AI
    const aiResponse = await context.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        {
          role: 'system',
          content: 'Kamu adalah tutor ujian yang membantu mahasiswa Indonesia belajar. Selalu jawab dalam Bahasa Indonesia yang jelas dan edukatif.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 512,
      temperature: 0.3
    });

    const explanation = aiResponse?.response || aiResponse?.result?.response || '';
    if (!explanation) {
      return sendJson({ error: 'AI tidak dapat membuat pembahasan saat ini. Coba lagi nanti.' }, 500);
    }

    // 10. Increment usage counter
    await incrementUsage(context.env, user.id);

    return sendJson({
      explanation,
      question_number,
      is_correct: isCorrect,
      usage: {
        used: rateCheck.count + 1,
        limit: DAILY_LIMIT
      }
    });

  } catch (error) {
    console.error('AI explain error:', error);
    return sendJson({ error: `Terjadi kesalahan server: ${error.message || error}` }, 500);
  }
}
