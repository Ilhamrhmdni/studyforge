import { requireUser } from '../../_shared/auth.js';
import { sendJson } from '../../_shared/response.js';
import { supabaseFetch } from '../../_shared/supabase.js';

export async function onRequest(context) {
  // 1. Verifikasi User
  const auth = await requireUser(context);
  if (!auth.ok) {
    return sendJson({ error: auth.message }, 401);
  }

  const userId = auth.user.id;

  try {
    // 2. Fetch data dari view user_subject_stats_view (gunakan jwt token user agar aman dengan RLS jika ada)
    // Di view ini kita filter by user_id di supabaseFetch
    const rows = await supabaseFetch(context.env,
      `/rest/v1/user_subject_stats_view?user_id=eq.${encodeURIComponent(userId)}&total_answered=gte.5&select=*`,
      { method: 'GET' }
    );

    if (!rows || rows.error) {
      console.error('Error fetching user weaknesses:', rows);
      return sendJson({ error: 'Gagal mengambil data kelemahan' }, 500);
    }

    // 3. Jika data kosong (kurang dari 5 jawaban untuk semua subjek)
    if (rows.length === 0) {
      return sendJson({
        empty: true,
        message: 'Belum cukup data untuk analisis. Kerjakan minimal 2–3 quiz agar sistem bisa menganalisis area yang perlu diperkuat.',
        items: []
      });
    }

    // 4. Urutkan berdasarkan akurasi terendah
    rows.sort((a, b) => a.accuracy_rate - b.accuracy_rate);

    // 5. Ambil 3 terbawah (terlemah)
    const weaknesses = rows.slice(0, 3);

    return sendJson({
      empty: false,
      items: weaknesses
    });

  } catch (error) {
    console.error('Insight user endpoint error:', error);
    return sendJson({ error: 'Terjadi kesalahan server internal' }, 500);
  }
}
