const {
  sendJson,
  readJson,
  getServiceConfigError,
  requireAdmin,
  prepareQuestionsForStorage,
  supabaseFetch
} = require('../_shared');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  }

  try {
    const serviceConfigError = getServiceConfigError();
    if (serviceConfigError) {
      return sendJson(res, 500, { error: serviceConfigError });
    }

    const auth = await requireAdmin(req);
    if (!auth.ok) {
      return sendJson(res, auth.status, { error: auth.message });
    }

    const body = await readJson(req);
    const title = String(body.title || '').trim();
    const subject = String(body.subject || '').trim() || 'Umum';
    const description = String(body.description || '').trim();
    const duration = Math.max(1, parseInt(body.duration, 10) || 60);
    const questions = Array.isArray(body.questions) ? body.questions : [];

    if (!title) {
      return sendJson(res, 400, { error: 'Judul paket soal wajib diisi.' });
    }
    if (!questions.length) {
      return sendJson(res, 400, { error: 'Tidak ada soal untuk disimpan.' });
    }

    const payload = {
      id: `quiz-${Date.now()}`,
      title,
      subject,
      description,
      duration,
      count: questions.length,
      created_at: new Date().toISOString(),
      questions: prepareQuestionsForStorage(questions)
    };

    await supabaseFetch('/rest/v1/quizzes', {
      method: 'POST',
      body: payload
    });

    return sendJson(res, 200, { ok: true, quizId: payload.id });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
};
