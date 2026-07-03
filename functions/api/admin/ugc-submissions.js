import { sendJson, supabaseFetch, requireAdmin } from '../../_shared.js';

export async function onRequestGet(context) {
  try {
    const auth = await requireAdmin(context);
    if (!auth.ok) return sendJson({ error: auth.message }, auth.status);

    const params = new URLSearchParams({
      source_type: 'eq.user_generated',
      review_status: 'eq.pending',
      select: 'id,title,count,created_at,parser_job_id,creator_id,profiles!quizzes_creator_id_fkey(full_name)',
      order: 'created_at.desc'
    });

    const rows = await supabaseFetch(context.env, `/rest/v1/quizzes?${params.toString()}`);
    if (!rows.ok) throw new Error('Gagal mengambil data submissions.');
    
    const quizzes = await rows.json();
    return sendJson({ quizzes });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
