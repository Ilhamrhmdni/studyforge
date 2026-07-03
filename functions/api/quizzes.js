import { isDraftTitle, sendJson, supabaseFetch } from '../_shared.js';

export async function onRequestGet(context) {
  try {
    const params = new URLSearchParams({
      select: 'id,title,subject,description,duration,count,created_at',
      order: 'created_at.desc'
    });
    const rows = await supabaseFetch(context.env, `/rest/v1/quizzes?${params.toString()}`);
    const quizzes = (rows || []).filter((quiz) => !isDraftTitle(quiz.title));
    return sendJson({ quizzes });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
