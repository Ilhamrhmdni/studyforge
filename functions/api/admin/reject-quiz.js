import { readJson, sendJson, supabaseFetch, requireAdmin } from '../../_shared.js';

export async function onRequestPost(context) {
  try {
    const auth = await requireAdmin(context);
    if (!auth.ok) return sendJson({ error: auth.message }, auth.status);

    const body = await readJson(context.request);
    const { quiz_id, reason } = body;

    if (!quiz_id) return sendJson({ error: 'quiz_id diperlukan.' }, 400);

    const patchRes = await supabaseFetch(context.env, `/rest/v1/quizzes?id=eq.${quiz_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ 
        review_status: 'rejected', 
        visibility: 'private',
        rejection_reason: reason || 'Tidak sesuai dengan standar.'
      })
    });

    if (!patchRes.ok) throw new Error('Gagal menolak kuis.');

    return sendJson({ success: true });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
