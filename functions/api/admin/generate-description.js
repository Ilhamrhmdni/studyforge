import { requireAdmin } from '../../_shared/auth.js';
import { getServiceConfigError } from '../../_shared/supabase.js';
import { sendJson } from '../../_shared/response.js';

export async function onRequestPost(context) {
  try {
    // 1. Cek konfigurasi server
    const configError = getServiceConfigError(context.env);
    if (configError) return sendJson({ error: configError }, 500);

    // 2. Verifikasi admin via shared utility
    const auth = await requireAdmin(context);
    if (!auth.ok) return sendJson({ error: auth.message }, auth.status);

    // 3. Pastikan AI binding tersedia
    if (!context.env.AI) {
      return sendJson({ error: 'Cloudflare AI binding belum dikonfigurasi.' }, 501);
    }

    // 4. Parse request body
    let body;
    try {
      body = await context.request.json();
    } catch {
      return sendJson({ error: 'Request body tidak valid.' }, 400);
    }

    const { text } = body;
    if (!text || typeof text !== 'string' || text.trim().length < 10) {
      return sendJson({ error: 'Teks terlalu pendek (minimal 10 karakter).' }, 400);
    }

    // 5. Generate deskripsi dengan CF AI
    const prompt = `Buatkan deskripsi singkat (maksimal 2 kalimat) yang menarik untuk paket soal berikut. Fokus pada topik utamanya. Jangan menggunakan awalan seperti "Deskripsi:" atau tanda kutip. Langsung tulis kalimatnya saja.\n\nSoal:\n${text.substring(0, 1500)}`;

    const response = await context.env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        { role: 'system', content: 'Kamu adalah asisten AI untuk platform edukasi StudyForge. Tugasmu membuat deskripsi singkat dan menarik untuk paket soal.' },
        { role: 'user', content: prompt }
      ]
    });

    const description = response?.response?.trim() || '';
    return sendJson({ description });

  } catch (error) {
    console.error('generate-description error:', error);
    return sendJson({ error: 'Terjadi kesalahan server saat membuat deskripsi.' }, 500);
  }
}
