import { requireAdmin } from '../../_shared/auth.js';
import { supabaseFetch } from '../../_shared/supabase.js';
import { readJson, sendJson } from '../../_shared/response.js';

export async function onRequestPost(context) {
  try {
    const auth = await requireAdmin(context);
    if (!auth.ok) return sendJson({ error: auth.message }, auth.status);

    const body = await readJson(context.request);
    const { quiz_id } = body;

    if (!quiz_id) return sendJson({ error: 'quiz_id diperlukan.' }, 400);

    const patchRes = await supabaseFetch(context.env, `/rest/v1/quizzes?id=eq.${quiz_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ 
        review_status: 'approved', 
        visibility: 'public',
        is_hidden: false,
        approved_by: auth.user.id,
        approved_at: new Date().toISOString()
      })
    });

    if (!patchRes.ok) throw new Error('Gagal menyetujui kuis.');

    return sendJson({ success: true });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
