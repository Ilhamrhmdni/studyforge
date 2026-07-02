const {
  sendJson,
  readJson,
  extractBearerToken,
  getServiceConfigError,
  getUserFromToken,
  getQuizById,
  isDraftTitle,
  resolveStoredAnswer,
  supabaseFetch
} = require('./_shared');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method tidak diizinkan.' });
  }

  try {
    const serviceConfigError = getServiceConfigError();
    if (serviceConfigError) {
      return sendJson(res, 500, { error: serviceConfigError });
    }

    const token = extractBearerToken(req);
    const user = await getUserFromToken(token);
    if (!user) {
      return sendJson(res, 401, { error: 'Sesi login tidak valid.' });
    }

    const body = await readJson(req);
    const quizId = String(body.quizId || '').trim();
    const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
    const timeTaken = Math.max(0, parseInt(body.timeTaken, 10) || 0);

    if (!quizId) {
      return sendJson(res, 400, { error: 'quizId wajib diisi.' });
    }

    const quiz = await getQuizById(quizId);
    if (!quiz || isDraftTitle(quiz.title)) {
      return sendJson(res, 404, { error: 'Quiz tidak ditemukan.' });
    }

    const storedQuestions = quiz.questions || [];
    let correct = 0;
    const review = storedQuestions.map((question, index) => {
      const qid = `q-${index + 1}`;
      const selected = answers[qid] ? String(answers[qid]) : null;
      const correctAnswer = resolveStoredAnswer(question);
      const isCorrect = !!selected && selected === correctAnswer;
      if (isCorrect) correct += 1;
      return {
        qid,
        question_num: question.num || index + 1,
        question_text: question.text || '',
        options: question.options || [],
        correct_answer: correctAnswer,
        user_answer: selected,
        is_correct: isCorrect
      };
    });

    const total = storedQuestions.length;
    const score = total ? Math.round((correct / total) * 100) : 0;

    const attemptPayload = {
      user_id: user.id,
      quiz_id: quiz.id,
      quiz_title: quiz.title,
      score,
      correct,
      total,
      time_taken: timeTaken
    };

    const attemptRows = await supabaseFetch('/rest/v1/quiz_attempts?select=id', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: attemptPayload
    });
    const attempt = attemptRows[0];
    if (!attempt) throw new Error('Gagal membuat data attempt.');

    try {
      await supabaseFetch('/rest/v1/quiz_attempt_answers', {
        method: 'POST',
        body: review.map((item) => ({
          attempt_id: attempt.id,
          user_id: user.id,
          question_num: item.question_num,
          question_text: item.question_text,
          options: item.options,
          correct_answer: item.correct_answer,
          user_answer: item.user_answer,
          is_correct: item.is_correct
        }))
      });
    } catch (error) {
      await supabaseFetch(`/rest/v1/quiz_attempts?id=eq.${attempt.id}`, { method: 'DELETE' });
      throw error;
    }

    return sendJson(res, 200, {
      attemptId: attempt.id,
      score,
      correct,
      total
    });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
};
