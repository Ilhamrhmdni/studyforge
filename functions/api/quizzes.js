import { supabaseFetch } from '../_shared/supabase.js';
import { sendJson } from '../_shared/response.js';
import { isDraftTitle } from '../_shared/quiz.js';

export async function onRequestGet(context) {
  try {
    const params = new URLSearchParams({
      select: 'id,title,subject,description,duration,count,created_at,is_hidden',
      visibility: 'eq.public',
      is_hidden: 'eq.false',
      review_status: 'eq.approved',
      order: 'created_at.desc'
    });
    const rows = await supabaseFetch(context.env, `/rest/v1/quizzes?${params.toString()}`);
    // Fallback filter untuk judul draft (defensif)
    const quizzes = (rows || []).filter((quiz) => !isDraftTitle(quiz.title));
    return sendJson({ quizzes });
  } catch (error) {
    return sendJson({ error: 'Gagal memuat daftar kuis.' }, 500);
  }
}
