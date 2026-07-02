const { sendJson, supabaseFetch, isDraftTitle } = require('./_shared');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  }

  try {
    const params = new URLSearchParams({
      select: 'id,title,subject,description,duration,count,created_at',
      order: 'created_at.desc'
    });
    const rows = await supabaseFetch(`/rest/v1/quizzes?${params.toString()}`);
    const quizzes = (rows || []).filter((quiz) => !isDraftTitle(quiz.title));
    return sendJson(res, 200, { quizzes });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
};
