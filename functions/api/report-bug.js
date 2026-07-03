import { extractBearerToken, getUserFromToken } from '../_shared/auth.js';
import { getProfile, getSupabaseConfigError, supabaseFetch } from '../_shared/supabase.js';
import { readJson, sendJson } from '../_shared/response.js';
import { getQuizById } from '../_shared/quiz.js';

function trimText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

export async function onRequestPost(context) {
  try {
    const configError = getSupabaseConfigError(context.env);
    if (configError) {
      return sendJson({ error: configError }, 500);
    }

    const token = extractBearerToken(context.request);
    const user = await getUserFromToken(context.env, token);
    if (!user) {
      return sendJson({ error: 'Sesi login tidak valid.' }, 401);
    }

    const body = await readJson(context.request);
    const message = trimText(body.message, 5000);
    const quizId = trimText(body.quizId, 120);
    const quizTitle = trimText(body.quizTitle, 255);
    const pageUrl = trimText(body.pageUrl, 2000);
    const screenshotDataUrl = trimText(body.screenshotDataUrl, 2_000_000);
    const questionNum = Math.max(0, parseInt(body.questionNum, 10) || 0);

    if (!message) {
      return sendJson({ error: 'Deskripsi bug wajib diisi.' }, 400);
    }

    const profile = await getProfile(context.env, user.id);
    const quiz = quizId ? await getQuizById(context.env, quizId).catch(() => null) : null;
    const reportPayload = {
      user_id: user.id,
      reporter_email: user.email || profile?.email || '',
      reporter_name: user.user_metadata?.full_name || profile?.full_name || '',
      quiz_id: quizId || null,
      quiz_title: quiz?.title || quizTitle || '',
      question_num: questionNum || null,
      page_url: pageUrl || '',
      message,
      screenshot_data_url: screenshotDataUrl || null
    };

    const insertedRows = await supabaseFetch(context.env, '/rest/v1/bug_reports?select=id,created_at', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: reportPayload
    });

    const inserted = insertedRows[0];

    return sendJson({
      ok: true,
      reportId: inserted?.id || null
    });
  } catch (error) {
    return sendJson({ error: error.message }, 500);
  }
}
