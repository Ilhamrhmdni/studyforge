import { requireUser } from '../../_shared/auth.js';
import { supabaseFetch } from '../../_shared/supabase.js';
import { readJson, sendJson } from '../../_shared/response.js';

export async function onRequestPost(context) {
  try {
    const auth = await requireUser(context);
    if (!auth.ok) return sendJson({ error: auth.message }, auth.status);

    const body = await readJson(context.request);
    const { file_name, file_size, page_count, analytics_consent } = body;

    if (!file_name || !file_name.toLowerCase().endsWith('.pdf')) {
      return sendJson({ error: 'File harus berformat PDF.' }, 400);
    }
    if (file_size > 20 * 1024 * 1024) {
      return sendJson({ error: 'Maksimal ukuran file adalah 20MB.' }, 400);
    }
    if (page_count > 30) {
      return sendJson({ error: 'Maksimal 30 halaman per PDF.' }, 400);
    }

    // Check quota: max 3 uploads per day
    const today = new Date();
    today.setUTCHours(0,0,0,0);
    const query = new URLSearchParams({
      user_id: `eq.${auth.user.id}`,
      action: `eq.init_parse`,
      created_at: `gte.${today.toISOString()}`,
      select: 'id'
    });

    const usageRes = await supabaseFetch(context.env, `/rest/v1/creator_usage_logs?${query}`);
    if (usageRes.ok) {
      const logs = await usageRes.json();
      if (logs.length >= 3) {
        return sendJson({ error: 'Batas harian tercapai. Maksimal 3 upload per hari.' }, 429);
      }
    }

    // Insert parse_jobs
    const jobRes = await supabaseFetch(context.env, '/rest/v1/parse_jobs', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        user_id: auth.user.id,
        file_name,
        file_size,
        page_count,
        analytics_consent: !!analytics_consent
      })
    });

    if (!jobRes.ok) throw new Error('Gagal membuat parse job.');
    const jobs = await jobRes.json();
    const parse_job_id = jobs[0].id;

    // Log usage
    await supabaseFetch(context.env, '/rest/v1/creator_usage_logs', {
      method: 'POST',
      body: JSON.stringify({
        user_id: auth.user.id,
        action: 'init_parse',
        file_name,
        file_size,
        page_count
      })
    });

    return sendJson({ success: true, parse_job_id });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
