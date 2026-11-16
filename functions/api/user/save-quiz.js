import { readJson, sendJson } from '../../_shared/response.js';
import { supabaseFetch, getServiceConfigError } from '../../_shared/supabase.js';
import { requireUser } from '../../_shared/auth.js';
import { prepareQuestionsForStorage } from '../../_shared/quiz.js';
export async function onRequestPost(context) {
  try {
    const auth = await requireUser(context);
    if (!auth.ok) return sendJson({ error: auth.message }, auth.status);

    const serviceConfigError = getServiceConfigError(context.env);
    if (serviceConfigError) {
      return sendJson({ error: serviceConfigError }, 500);
    }

    const body = await readJson(context.request);
    const { title, subject, description, duration, questions, parse_job_id } = body;

    if (!title || !subject || !questions || !Array.isArray(questions)) {
      return sendJson({ error: 'Data kuis tidak lengkap.' }, 400);
    }
    if (questions.length === 0) {
      return sendJson({ error: 'Kuis harus memiliki minimal 1 soal.' }, 400);
    }
    if (questions.length > 100) {
      return sendJson({ error: 'Kuis tidak boleh memiliki lebih dari 100 soal.' }, 400);
    }

    // Validation
    const qnums = new Set();
    for (const q of questions) {
      if (!q.text || q.text.trim() === '') {
        return sendJson({ error: `Soal nomor ${q.num} kosong.` }, 400);
      }
      if (!q.options || Object.keys(q.options).length < 2) {
        return sendJson({ error: `Soal nomor ${q.num} harus memiliki minimal 2 opsi.` }, 400);
      }
      if (!q.answer) {
        return sendJson({ error: `Soal nomor ${q.num} tidak memiliki kunci jawaban.` }, 400);
      }
      if (qnums.has(q.num)) {
        return sendJson({ error: `Nomor soal duplikat terdeteksi: ${q.num}` }, 400);
      }
      qnums.add(q.num);
    }

    // Verify ownership of the job
    if (parse_job_id) {
      const jobs = await supabaseFetch(context.env, `/rest/v1/parse_jobs?id=eq.${parse_job_id}&user_id=eq.${auth.user.id}`);
      if (!jobs || jobs.length === 0) {
        return sendJson({ error: 'Parse job tidak valid.' }, 400);
      }
    }

    // Insert Quiz
    const quizData = {
      title,
      subject,
      description: description || '',
      duration: Math.max(1, parseInt(duration, 10) || 60),
      count: questions.length,
      questions: await prepareQuestionsForStorage(context.env, questions),
      creator_id: auth.user.id,
      source_type: 'user_generated',
      visibility: 'private',
      review_status: 'draft',
      parser_job_id: parse_job_id || null,
      is_hidden: true
    };

    const savedQuiz = await supabaseFetch(context.env, '/rest/v1/quizzes', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: quizData
    });

    if (parse_job_id) {
      await supabaseFetch(context.env, `/rest/v1/parse_jobs?id=eq.${parse_job_id}`, {
        method: 'PATCH',
        body: { status: 'saved', completed_at: new Date().toISOString() }
      });
    }

    return sendJson({ success: true, id: savedQuiz[0].id });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
