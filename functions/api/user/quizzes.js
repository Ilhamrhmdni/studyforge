import { sendJson, supabaseFetch, requireUser } from '../../_shared.js';

export async function onRequestGet(context) {
  try {
    const auth = await requireUser(context);
    if (!auth.ok) return sendJson({ error: auth.message }, auth.status);

    const params = new URLSearchParams({
      creator_id: `eq.${auth.user.id}`,
      select: 'id,title,subject,description,duration,count,created_at,visibility,review_status,parser_job_id,rejection_reason',
      order: 'created_at.desc'
    });

    const rows = await supabaseFetch(context.env, `/rest/v1/quizzes?${params.toString()}`);
    if (!rows.ok) {
      throw new Error('Gagal mengambil kuis.');
    }

    const quizzes = await rows.json();
    return sendJson({ quizzes });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
