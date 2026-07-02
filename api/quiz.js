const {
  sendJson,
  extractBearerToken,
  getUserFromToken,
  getProfile,
  getQuizById,
  isDraftTitle,
  sanitizeQuestion
} = require('./_shared');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  }

  const id = req.query.id;
  if (!id) {
    return sendJson(res, 400, { error: 'Parameter id wajib diisi.' });
  }

  try {
    const quiz = await getQuizById(id);
    if (!quiz) {
      return sendJson(res, 404, { error: 'Quiz tidak ditemukan.' });
    }

    if (isDraftTitle(quiz.title)) {
      const token = extractBearerToken(req);
      const user = await getUserFromToken(token);
      const profile = user ? await getProfile(user.id) : null;
      if (!profile || profile.role !== 'admin') {
        return sendJson(res, 404, { error: 'Quiz tidak ditemukan.' });
      }
    }

    return sendJson(res, 200, {
      quiz: {
        id: quiz.id,
        title: quiz.title,
        subject: quiz.subject,
        description: quiz.description,
        duration: quiz.duration,
        count: quiz.count,
        created_at: quiz.created_at,
        questions: (quiz.questions || []).map((question, index) => sanitizeQuestion(question, index))
      }
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
};
