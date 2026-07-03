import { requireAdmin, sendJson, supabaseFetch } from '../../_shared.js';

function escapeValue(value) {
  return String(value || '').replace(/,/g, '\\,');
}

export async function onRequestGet(context) {
  try {
    const auth = await requireAdmin(context);
    if (!auth.ok) {
      return sendJson({ error: auth.message }, auth.status);
    }

    const attemptParams = new URLSearchParams({
      select: 'id,user_id,quiz_title,score,correct,total,time_taken,submitted_at',
      order: 'submitted_at.desc',
      limit: '50'
    });
    const attempts = await supabaseFetch(context.env, `/rest/v1/quiz_attempts?${attemptParams.toString()}`);

    const userIds = [...new Set((attempts || []).map((row) => row.user_id).filter(Boolean))];
    let profileMap = {};

    if (userIds.length) {
      const profileParams = new URLSearchParams({
        select: 'id,full_name,email',
        id: `in.(${userIds.map(escapeValue).join(',')})`
      });
      const profiles = await supabaseFetch(context.env, `/rest/v1/profiles?${profileParams.toString()}`);
      profileMap = Object.fromEntries((profiles || []).map((profile) => [profile.id, profile]));
    }

    return sendJson({
      results: (attempts || []).map((attempt) => ({
        ...attempt,
        full_name: profileMap[attempt.user_id]?.full_name || '',
        email: profileMap[attempt.user_id]?.email || ''
      }))
    });
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

    await supabaseFetch(context.env, `/rest/v1/quiz_attempts?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });

    return sendJson({ ok: true });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
