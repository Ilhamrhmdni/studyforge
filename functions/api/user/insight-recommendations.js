import { requireUser } from '../../_shared/auth.js';
import { sendJson } from '../../_shared/response.js';
import { supabaseFetch } from '../../_shared/supabase.js';
import { isDraftTitle } from '../../_shared/quiz.js';

export async function onRequest(context) {
  // 1. Verifikasi User
  const auth = await requireUser(context);
  if (!auth.ok) {
    return sendJson({ error: auth.message }, 401);
  }

  const userId = auth.user.id;

  try {
    // 2. Cari subject terlemah
    const weakSubjectRows = await supabaseFetch(context.env,
      `/rest/v1/user_subject_stats_view?user_id=eq.${encodeURIComponent(userId)}&total_answered=gte.5&select=subject&order=accuracy_rate.asc&limit=1`,
      { method: 'GET' }
    );

    let weakestSubject = null;
    if (weakSubjectRows && weakSubjectRows.length > 0) {
      weakestSubject = weakSubjectRows[0].subject;
    }

    // 3. Ambil daftar quiz_id yang sudah pernah dikerjakan oleh user (untuk di-exclude atau dicek)
    // Supaya simpel, kita fetch semua quiz_id milik user ini. (Idealnya ambil yg score-nya bagus aja yg diexclude, tapi MVP kita exclude semua attempt yg sdh ada)
    const attempts = await supabaseFetch(context.env,
      `/rest/v1/quiz_attempts?user_id=eq.${encodeURIComponent(userId)}&select=quiz_id&order=submitted_at.desc&limit=100`,
      { method: 'GET' }
    );
    
    const attemptedQuizIds = (attempts && !attempts.error) ? attempts.map(a => a.quiz_id) : [];

    // 4. Query tabel quizzes
    // Fallback: jika weakestSubject null, maka query semua quiz public terbaru
    let queryPath = `/rest/v1/quizzes?visibility=eq.public&is_hidden=eq.false&review_status=eq.approved&select=id,title,subject,description&order=created_at.desc`;
    
    // Jika punya kelemahan, coba prioritaskan pencarian dengan subject tersebut
    // Karena REST API Supabase agak terbatas untuk NOT IN list besar, kita ambil agak banyak lalu filter di Worker.
    if (weakestSubject) {
        queryPath = `/rest/v1/quizzes?visibility=eq.public&is_hidden=eq.false&review_status=eq.approved&subject=eq.${encodeURIComponent(weakestSubject)}&select=id,title,subject,description&order=created_at.desc`;
    }

    let recommendedQuizzes = await supabaseFetch(context.env, queryPath, { method: 'GET' });

    if (!recommendedQuizzes || recommendedQuizzes.error) {
      recommendedQuizzes = [];
    }

    // 5. Filter out attempted quizzes and drafts
    let filteredQuizzes = recommendedQuizzes.filter(q => !attemptedQuizIds.includes(q.id) && !isDraftTitle(q.title));

    // Jika filter bikin kosong (semua soal di subject itu udah dikerjain), fallback ambil random public quiz yg belum dikerjain
    if (filteredQuizzes.length === 0 && weakestSubject) {
        const fallbackQuizzes = await supabaseFetch(context.env, 
            `/rest/v1/quizzes?visibility=eq.public&is_hidden=eq.false&review_status=eq.approved&select=id,title,subject,description&order=created_at.desc`, 
            { method: 'GET' });
        if (fallbackQuizzes && !fallbackQuizzes.error) {
            filteredQuizzes = fallbackQuizzes.filter(q => !attemptedQuizIds.includes(q.id) && !isDraftTitle(q.title));
        }
    }

    // 6. Limit ke 3 atau 4
    const finalRecommendations = filteredQuizzes.slice(0, 3);

    return sendJson({
      weakest_subject: weakestSubject,
      items: finalRecommendations
    });

  } catch (error) {
    console.error('Insight recommendations error:', error);
    return sendJson({ error: `Terjadi kesalahan server internal: ${error.message}` }, 500);
  }
}
