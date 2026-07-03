import { isDraftTitle, requireAdmin, sendJson, supabaseFetch } from '../../_shared.js';

export async function onRequestGet(context) {
  try {
    const auth = await requireAdmin(context);
    if (!auth.ok) {
      return sendJson({ error: auth.message }, auth.status);
    }

    const params = new URLSearchParams({
      select: 'id,title,subject,count,created_at',
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
