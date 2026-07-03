import { requireUser } from '../../_shared/auth.js';
import { supabaseFetch } from '../../_shared/supabase.js';
import { readJson, sendJson } from '../../_shared/response.js';

export async function onRequestPost(context) {
  try {
    const auth = await requireUser(context);
    if (!auth.ok) return sendJson({ error: auth.message }, auth.status);

    const body = await readJson(context.request);
    const { parse_job_id, raw_ai_output, normalized_output, final_user_corrected_output, correction_summary, detected_question_count, detected_answer_key_count, validation_status, validation_errors } = body;

    if (!parse_job_id) return sendJson({ error: 'parse_job_id diperlukan.' }, 400);

    // Verify ownership of the job
    const jobs = await supabaseFetch(context.env, `/rest/v1/parse_jobs?id=eq.${parse_job_id}&user_id=eq.${auth.user.id}`);
    if (!jobs || jobs.length === 0) {
      return sendJson({ error: 'Parse job tidak ditemukan atau bukan milik Anda.' }, 404);
    }

    // Step 1: Update job stats if provided
    if (validation_status) {
      await supabaseFetch(context.env, `/rest/v1/parse_jobs?id=eq.${parse_job_id}`, {
        method: 'PATCH',
        body: {
          detected_question_count,
          detected_answer_key_count,
          validation_status,
          validation_errors
        }
      });
    }

    // Step 2: Check if result exists
    const existing = await supabaseFetch(context.env, `/rest/v1/parse_results?parse_job_id=eq.${parse_job_id}&select=id`);

    if (existing && existing.length > 0) {
      // Update existing result
      const updates = {};
      if (raw_ai_output !== undefined) updates.raw_ai_output = raw_ai_output;
      if (normalized_output !== undefined) updates.normalized_output = normalized_output;
      if (final_user_corrected_output !== undefined) updates.final_user_corrected_output = final_user_corrected_output;
      if (correction_summary !== undefined) updates.correction_summary = correction_summary;
      updates.updated_at = new Date().toISOString();

      await supabaseFetch(context.env, `/rest/v1/parse_results?parse_job_id=eq.${parse_job_id}`, {
        method: 'PATCH',
        body: updates
      });
    } else {
      // Insert new result
      await supabaseFetch(context.env, '/rest/v1/parse_results', {
        method: 'POST',
        body: {
          parse_job_id,
          raw_ai_output,
          normalized_output,
          final_user_corrected_output,
          correction_summary
        }
      });
    }

    return sendJson({ success: true });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
