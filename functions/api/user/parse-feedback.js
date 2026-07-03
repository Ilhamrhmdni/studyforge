import { requireUser } from '../../_shared/auth.js';
import { supabaseFetch } from '../../_shared/supabase.js';
import { readJson, sendJson } from '../../_shared/response.js';

export async function onRequestPost(context) {
  try {
    const auth = await requireUser(context);
    if (!auth.ok) return sendJson({ error: auth.message }, auth.status);

    const body = await readJson(context.request);
    const { parse_job_id, question_number, feedback_type, rating, before_value, after_value, user_note } = body;

    if (!parse_job_id) return sendJson({ error: 'parse_job_id diperlukan.' }, 400);

    // Verify ownership of the job
    const jobs = await supabaseFetch(context.env, `/rest/v1/parse_jobs?id=eq.${parse_job_id}&user_id=eq.${auth.user.id}`);
    if (!jobs || jobs.length === 0) {
      return sendJson({ error: 'Parse job tidak ditemukan atau bukan milik Anda.' }, 404);
    }

    const feedbackData = {
      parse_job_id,
      user_id: auth.user.id,
      question_number,
      feedback_type,
      rating,
      before_value,
      after_value,
      user_note
    };

    const fbRes = await supabaseFetch(context.env, '/rest/v1/parse_feedback', {
      method: 'POST',
      body: JSON.stringify(feedbackData)
    });

    if (!fbRes.ok) throw new Error('Gagal menyimpan feedback.');

    return sendJson({ success: true });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
