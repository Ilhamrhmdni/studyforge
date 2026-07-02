import {
  getServiceConfigError,
  prepareQuestionsForStorage,
  readJson,
  requireAdmin,
  sendJson,
  supabaseFetch
} from '../../_shared.js';

export async function onRequestPost(context) {
  try {
    const serviceConfigError = getServiceConfigError(context.env);
    if (serviceConfigError) {
      return sendJson({ error: serviceConfigError }, 500);
    }

    const auth = await requireAdmin(context);
    if (!auth.ok) {
      return sendJson({ error: auth.message }, auth.status);
    }

    const body = await readJson(context.request);
    const title = String(body.title || '').trim();
    const subject = String(body.subject || '').trim() || 'Umum';
    const description = String(body.description || '').trim();
    const duration = Math.max(1, parseInt(body.duration, 10) || 60);
    const questions = Array.isArray(body.questions) ? body.questions : [];

    if (!title) {
      return sendJson({ error: 'Judul paket soal wajib diisi.' }, 400);
    }
    if (!questions.length) {
      return sendJson({ error: 'Tidak ada soal untuk disimpan.' }, 400);
    }

    const payload = {
      id: `quiz-${Date.now()}`,
      title,
      subject,
      description,
      duration,
      count: questions.length,
      created_at: new Date().toISOString(),
      questions: await prepareQuestionsForStorage(context.env, questions)
    };

    await supabaseFetch(context.env, '/rest/v1/quizzes', {
      method: 'POST',
      body: payload
    });

    return sendJson({ ok: true, quizId: payload.id });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
