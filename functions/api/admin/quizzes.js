import { requireAdmin } from '../../_shared/auth.js';
import { supabaseFetch } from '../../_shared/supabase.js';
import { sendJson } from '../../_shared/response.js';
import { isDraftTitle } from '../../_shared/quiz.js';

export async function onRequestGet(context) {
  try {
    const auth = await requireAdmin(context);
    if (!auth.ok) {
      return sendJson({ error: auth.message }, auth.status);
    }

    const params = new URLSearchParams({
      select: 'id,title,subject,count,created_at,is_hidden',
      order: 'created_at.desc'
    });
    const rows = await supabaseFetch(context.env, `/rest/v1/quizzes?${params.toString()}`);
    return sendJson({
      quizzes: (rows || []).map((quiz) => ({
        ...quiz,
        is_draft: isDraftTitle(quiz.title)
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

    await supabaseFetch(context.env, `/rest/v1/quizzes?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });

    return sendJson({ ok: true });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}

export async function onRequestPatch(context) {
  try {
    const auth = await requireAdmin(context);
    if (!auth.ok) {
      return sendJson({ error: auth.message }, auth.status);
    }

    const body = await context.request.json();
    const { id, title, subject, is_hidden } = body;

    if (!id) {
      return sendJson({ error: 'Parameter id wajib diisi.' }, 400);
    }

    // Prepare update payload
    const payload = {};
    if (title !== undefined) payload.title = title;
    if (subject !== undefined) payload.subject = subject;
    if (is_hidden !== undefined) payload.is_hidden = is_hidden;

    if (Object.keys(payload).length === 0) {
      return sendJson({ error: 'Tidak ada data untuk diupdate.' }, 400);
    }

    await supabaseFetch(context.env, `/rest/v1/quizzes?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: payload
    });

    return sendJson({ ok: true });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
