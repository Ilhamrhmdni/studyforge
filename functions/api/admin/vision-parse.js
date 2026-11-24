import { requireAdmin } from '../../_shared/auth.js';
import { getServiceConfigError } from '../../_shared/supabase.js';
import { sendJson } from '../../_shared/response.js';
import { runGroqWithPool, GROQ_VISION_MODELS } from '../../_shared/groq.js';

function extractQuestionsJson(rawText) {
  const raw = String(rawText || '').trim();
  try {
    const direct = JSON.parse(raw);
    if (Array.isArray(direct)) return direct;
    if (Array.isArray(direct?.questions)) return direct.questions;
    if (Array.isArray(direct?.results)) return direct.results;
  } catch {
    // Fallback to bracket extraction below.
  }

  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function buildVisionPrompt(pageNums) {
  return `Kamu adalah ekstraktor soal ujian yang sangat teliti dan mampu membaca gambar, tabel, grafik, poster, dan teks PDF.
Berikut ada ${pageNums.length} halaman PDF ujian (halaman ${pageNums.join(', ')}).
Analisis SEMUA halaman dan ekstrak SEMUA soal dari semua halaman secara lengkap.

Aturan penting:
- Jika soal merujuk pada gambar/tabel/grafik/notice/sign: jelaskan isi gambar/tabel tersebut secara ringkas jika perlu di teks soal agar soal tetap bisa dipahami, set "hasImage": true, dan set "imgPage" ke nomor halaman tempat soal berada.
- Pastikan opsi A, B, C, D (atau E) lengkap, bersih, dan berurutan.
- "answer": huruf jawaban benar (A/B/C/D/E) jika terlihat di halaman atau bisa disimpulkan dengan yakin; jika tidak terlihat, isi "".
- Nomor soal ("num") harus sesuai nomor pada PDF.

Kembalikan HANYA JSON object valid dengan key "questions" tanpa markdown atau teks tambahan:
{"questions":[{"num":8,"text":"teks pertanyaan lengkap","options":[{"key":"A","text":"opsi A"},{"key":"B","text":"opsi B"},{"key":"C","text":"opsi C"},{"key":"D","text":"opsi D"}],"answer":"B","hasImage":true,"imgPage":${pageNums[0]}}]}`;
}

export async function onRequestPost(context) {
  try {
    const configError = getServiceConfigError(context.env);
    if (configError) return sendJson({ error: configError }, 500);

    const auth = await requireAdmin(context);
    if (!auth.ok) return sendJson({ error: auth.message }, auth.status);

    let body;
    try {
      body = await context.request.json();
    } catch {
      return sendJson({ error: 'Request body tidak valid.' }, 400);
    }

    const pages = Array.isArray(body?.pages) ? body.pages.slice(0, 2) : [];
    const validPages = pages.filter((p) => Number(p?.pageNum) > 0 && typeof p?.imageDataUrl === 'string' && p.imageDataUrl.startsWith('data:image/'));
    if (validPages.length === 0) {
      return sendJson({ error: 'Daftar halaman gambar tidak boleh kosong.' }, 400);
    }

    const pageNums = validPages.map((p) => Number(p.pageNum));
    /** @type {any[]} */
    const userContent = [{ type: 'text', text: buildVisionPrompt(pageNums) }];
    for (const page of validPages) {
      userContent.push(
        { type: 'text', text: `\n[HALAMAN PDF ${page.pageNum}]` },
        { type: 'image_url', image_url: { url: page.imageDataUrl } }
      );
    }

    const messages = [
      {
        role: 'system',
        content: 'Kamu adalah ekstraktor soal ujian berbasis Vision AI StudyForge. Selalu balas dengan JSON object valid.'
      },
      { role: 'user', content: userContent }
    ];

    const groqRes = await runGroqWithPool(context.env, messages, {
      models: GROQ_VISION_MODELS,
      temperature: 0.1,
      maxTokens: 6144,
      responseFormat: { type: 'json_object' }
    });

    if (groqRes.ok) {
      const questions = extractQuestionsJson(groqRes.content);
      if (questions) {
        return sendJson({ questions, provider: 'groq-vision', model: groqRes.model });
      }
    }

    if (!context.env.AI) {
      const status = groqRes.configured ? 502 : 501;
      return sendJson({ error: groqRes.error || 'Vision AI provider belum dikonfigurasi.' }, status);
    }

    try {
      const firstPage = validPages[0];
      const base64 = firstPage.imageDataUrl.split(',')[1] || '';
      const imageBytes = Uint8Array.from(atob(base64), (c) => c.codePointAt(0) || 0);
      const cfResponse = await context.env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
        prompt: buildVisionPrompt([firstPage.pageNum]),
        image: [...imageBytes],
        max_tokens: 4096
      });
      const questions = extractQuestionsJson(cfResponse?.response);
      if (questions) {
        return sendJson({ questions, provider: 'cloudflare-vision' });
      }
      return sendJson({ error: 'Respons Vision AI tidak berbentuk JSON valid.' }, 502);
    } catch (cfErr) {
      return sendJson({ error: cfErr?.message || groqRes.error || 'Vision AI gagal memproses halaman.' }, 502);
    }
  } catch (error) {
    console.error('vision-parse error:', error);
    return sendJson({ error: error?.message || 'Terjadi kesalahan server saat memproses halaman bergambar.' }, 500);
  }
}
