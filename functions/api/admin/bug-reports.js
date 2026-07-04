import { requireAdmin } from '../../_shared/auth.js';
import { supabaseFetch } from '../../_shared/supabase.js';
import { sendJson } from '../../_shared/response.js';

export async function onRequestGet(context) {
  try {
    const auth = await requireAdmin(context);
    if (!auth.ok) {
      return sendJson({ error: auth.message }, auth.status);
    }

    const params = new URLSearchParams({
      select: 'id,reporter_email,reporter_name,quiz_id,quiz_title,question_num,page_url,message,created_at',
      order: 'created_at.desc',
      limit: '100'
    });
    const reports = await supabaseFetch(context.env, `/rest/v1/bug_reports?${params.toString()}`);

    return sendJson({ reports: reports || [] });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const auth = await requireAdmin(context);
    if (!auth.ok) {
      return sendJson({ error: auth.message }, auth.status);
    }

    const id = new URL(context.request.url).searchParams.get('id');
    if (!id) {
      return sendJson({ error: 'Parameter id wajib diisi.' }, 400);
    }

    await supabaseFetch(context.env, `/rest/v1/bug_reports?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });

    return sendJson({ ok: true });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
