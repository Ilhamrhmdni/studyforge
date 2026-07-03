import {
  extractBearerToken,
  getProfile,
  getQuizById,
  getUserFromToken,
  isDraftTitle,
  sanitizeQuestion,
  sendJson
} from '../_shared.js';

export async function onRequestGet(context) {
  const id = new URL(context.request.url).searchParams.get('id');
  if (!id) {
    return sendJson({ error: 'Parameter id wajib diisi.' }, 400);
  }

  try {
    const quiz = await getQuizById(context.env, id);
    if (!quiz) {
      return sendJson({ error: 'Quiz tidak ditemukan.' }, 404);
    }

    if (isDraftTitle(quiz.title)) {
      const token = extractBearerToken(context.request);
      const user = await getUserFromToken(context.env, token);
      const profile = user ? await getProfile(context.env, user.id) : null;
      if (!profile || profile.role !== 'admin') {
        return sendJson({ error: 'Quiz tidak ditemukan.' }, 404);
      }
    }

    return sendJson({
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
    return sendJson({ error: error.message }, 500);
  }
}
