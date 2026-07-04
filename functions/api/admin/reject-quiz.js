import { requireAdmin } from '../../_shared/auth.js';
import { supabaseFetch } from '../../_shared/supabase.js';
import { readJson, sendJson } from '../../_shared/response.js';

export async function onRequestPost(context) {
  try {
    const auth = await requireAdmin(context);
    if (!auth.ok) return sendJson({ error: auth.message }, auth.status);

    const body = await readJson(context.request);
    const { quiz_id, reason } = body;

    if (!quiz_id) return sendJson({ error: 'quiz_id diperlukan.' }, 400);

    await supabaseFetch(context.env, `/rest/v1/quizzes?id=eq.${encodeURIComponent(quiz_id)}`, {
      method: 'PATCH',
      body: { 
        review_status: 'rejected', 
        visibility: 'private',
        rejection_reason: reason || 'Tidak sesuai dengan standar.'
      }
    });

    return sendJson({ success: true });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
