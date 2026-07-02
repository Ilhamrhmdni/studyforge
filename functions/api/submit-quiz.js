import {
  extractBearerToken,
  getQuizById,
  getServiceConfigError,
  getUserFromToken,
  isDraftTitle,
  readJson,
  resolveStoredAnswer,
  sendJson,
  supabaseFetch
} from '../_shared.js';

export async function onRequestPost(context) {
  try {
    const serviceConfigError = getServiceConfigError(context.env);
    if (serviceConfigError) {
      return sendJson({ error: serviceConfigError }, 500);
    }

    const token = extractBearerToken(context.request);
    const user = await getUserFromToken(context.env, token);
    if (!user) {
      return sendJson({ error: 'Sesi login tidak valid.' }, 401);
    }

    const body = await readJson(context.request);
    const quizId = String(body.quizId || '').trim();
    const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
    const timeTaken = Math.max(0, parseInt(body.timeTaken, 10) || 0);

    if (!quizId) {
      return sendJson({ error: 'quizId wajib diisi.' }, 400);
    }

    const quiz = await getQuizById(context.env, quizId);
    if (!quiz || isDraftTitle(quiz.title)) {
      return sendJson({ error: 'Quiz tidak ditemukan.' }, 404);
    }

    const storedQuestions = quiz.questions || [];
    let correct = 0;
    const review = [];

    for (let index = 0; index < storedQuestions.length; index++) {
      const question = storedQuestions[index];
      const qid = `q-${index + 1}`;
      const selected = answers[qid] ? String(answers[qid]) : null;
      const correctAnswer = await resolveStoredAnswer(context.env, question);
      const isCorrect = !!selected && selected === correctAnswer;
      if (isCorrect) correct += 1;
      review.push({
        question_num: question.num || index + 1,
        question_text: question.text || '',
        options: question.options || [],
        correct_answer: correctAnswer,
        user_answer: selected,
        is_correct: isCorrect
      });
    }

    const total = storedQuestions.length;
    const score = total ? Math.round((correct / total) * 100) : 0;

    const attemptRows = await supabaseFetch(context.env, '/rest/v1/quiz_attempts?select=id', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: {
        user_id: user.id,
        quiz_id: quiz.id,
        quiz_title: quiz.title,
        score,
        correct,
        total,
        time_taken: timeTaken
      }
    });
    const attempt = attemptRows[0];
    if (!attempt) throw new Error('Gagal membuat data attempt.');

    try {
      await supabaseFetch(context.env, '/rest/v1/quiz_attempt_answers', {
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
      await supabaseFetch(context.env, `/rest/v1/quiz_attempts?id=eq.${attempt.id}`, {
        method: 'DELETE'
      });
      throw error;
    }

    return sendJson({
      attemptId: attempt.id,
      score,
      correct,
      total
    });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
