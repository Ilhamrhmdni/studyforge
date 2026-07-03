import { requireAdmin } from '../../_shared/auth.js';
import { sendJson } from '../../_shared/response.js';
import { supabaseFetch } from '../../_shared/supabase.js';

export async function onRequest(context) {
  // 1. Verifikasi Admin
  const auth = await requireAdmin(context);
  if (!auth.ok) {
    return sendJson({ error: auth.message }, 401);
  }

  try {
    // 2. Fetch data dari view question_stats_view (gunakan token admin)
    const rows = await supabaseFetch(context.env,
      '/rest/v1/question_stats_view?select=*',
      { method: 'GET' }
    );

    if (!rows || rows.error) {
      console.error('Error fetching insight questions:', rows);
      return sendJson({ error: 'Gagal mengambil data insight' }, 500);
    }

    // 3. Hitung summary
    const summary = {
      total_questions: rows.length,
      problematic: 0,
      hard: 0,
      medium: 0,
      easy: 0,
      insufficient_data: 0
    };

    rows.forEach(row => {
      switch(row.status) {
        case 'Bermasalah': summary.problematic++; break;
        case 'Sulit': summary.hard++; break;
        case 'Sedang': summary.medium++; break;
        case 'Mudah': summary.easy++; break;
        case 'Data Kurang': summary.insufficient_data++; break;
      }
    });

    // 4. Urutkan berdasarkan prioritas status dan correct_rate
    const statusOrder = {
      'Bermasalah': 1,
      'Sulit': 2,
      'Sedang': 3,
      'Mudah': 4,
      'Data Kurang': 5
    };

    rows.sort((a, b) => {
      const orderA = statusOrder[a.status] || 99;
      const orderB = statusOrder[b.status] || 99;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.correct_rate - b.correct_rate; // Ascending: yang paling rendah (sulit) di atas
    });

    // 5. Kembalikan response
    return sendJson({
      summary,
      items: rows
    });

  } catch (error) {
    console.error('Insight endpoint error:', error);
    return sendJson({ error: 'Terjadi kesalahan server internal' }, 500);
  }
}
