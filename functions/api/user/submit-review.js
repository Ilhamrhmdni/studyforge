import { requireUser } from '../../_shared/auth.js';
import { supabaseFetch } from '../../_shared/supabase.js';
import { readJson, sendJson } from '../../_shared/response.js';

export async function onRequestPost(context) {
  try {
    const auth = await requireUser(context);
    if (!auth.ok) return sendJson({ error: auth.message }, auth.status);

    const body = await readJson(context.request);
    const { quiz_id } = body;

    if (!quiz_id) return sendJson({ error: 'quiz_id diperlukan.' }, 400);

    // Verify ownership and status
    const existing = await supabaseFetch(context.env, `/rest/v1/quizzes?id=eq.${quiz_id}&creator_id=eq.${auth.user.id}&select=review_status,visibility`);
    if (!existing || existing.length === 0) {
      return sendJson({ error: 'Kuis tidak ditemukan atau bukan milik Anda.' }, 404);
    }

    const quiz = existing[0];
    if (quiz.review_status !== 'draft' && quiz.review_status !== 'rejected') {
      return sendJson({ error: `Kuis berstatus ${quiz.review_status} tidak dapat diajukan ulang.` }, 400);
    }

    // Update status to pending
    await supabaseFetch(context.env, `/rest/v1/quizzes?id=eq.${quiz_id}`, {
      method: 'PATCH',
      body: { review_status: 'pending', visibility: 'private' }
    });

    return sendJson({ success: true });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
