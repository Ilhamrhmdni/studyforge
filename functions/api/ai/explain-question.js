import { requireUser } from '../../_shared/auth.js';
import { sendJson } from '../../_shared/response.js';
import { supabaseFetch } from '../../_shared/supabase.js';
import { runGroqWithPool } from '../../_shared/groq.js';

// Rate limiting: maks 20 request AI per user per hari
const DAILY_LIMIT = 20;

function getJakartaDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

async function checkRateLimit(env, userId) {
  const today = getJakartaDateString();

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
  const today = getJakartaDateString();
  try {
    // Call RPC function to safely increment usage count
    await supabaseFetch(env, '/rest/v1/rpc/increment_ai_usage', {
      method: 'POST',
      body: {
        p_user_id: userId,
        p_date: today
      }
    });
  } catch {
    // Jika tabel/RPC belum ada, abaikan saja
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

    // 2. Pastikan minimal satu provider AI tersedia (Groq atau Cloudflare AI)
    // (Cek detail dilakukan saat memanggil provider di langkah 9)

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
    const optionsText = options.map(o => `${o.key || o.id || ''}. ${o.text}`).join('\n');

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

    const messages = [
      {
        role: 'system',
        content: 'Kamu adalah tutor ujian yang membantu mahasiswa Indonesia belajar. Selalu jawab dalam Bahasa Indonesia yang jelas dan edukatif.'
      },
      {
        role: 'user',
        content: prompt
      }
    ];

    // 9. Panggil Groq pool terlebih dahulu, fallback ke Workers AI
    let explanation = '';
    const groqRes = await runGroqWithPool(context.env, messages, {
      temperature: 0.3,
      maxTokens: 700
    });
    if (groqRes.ok) {
      explanation = groqRes.content;
    } else if (context.env.AI) {
      const modelsToTry = [
        '@cf/meta/llama-3.1-8b-instruct-fast',
        '@cf/meta/llama-3.1-8b-instruct-fp8'
      ];

      let aiResponse = null;
      let lastError = null;

      for (const model of modelsToTry) {
        try {
          aiResponse = await context.env.AI.run(model, {
            messages,
            max_tokens: 512,
            temperature: 0.3
          });
          if (aiResponse) break;
        } catch (err) {
          console.warn(`Model ${model} gagal:`, err.message);
          lastError = err;
        }
      }

      if (!aiResponse) {
        throw lastError || new Error(groqRes.error || 'Semua model AI fallback gagal.');
      }
      explanation = aiResponse?.response || aiResponse?.result?.response || '';
    } else {
      return sendJson({
        error: groqRes.error || 'Fitur AI belum aktif. Silakan hubungi administrator.'
      }, 503);
    }
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
    return sendJson({ error: 'Terjadi kesalahan server saat membuat pembahasan.' }, 500);
  }
}
