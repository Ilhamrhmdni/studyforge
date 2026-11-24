import { requireAdmin } from '../../_shared/auth.js';
import { getServiceConfigError } from '../../_shared/supabase.js';
import { sendJson } from '../../_shared/response.js';
import { runGroqWithPool, GROQ_VISION_MODELS } from '../../_shared/groq.js';

function buildAuditPrompt(questions) {
  const compact = questions.map((q) => ({
    num: q.num,
    text: q.text,
    options: q.options,
    answer: q.answer || '',
    explanation: q.explanation || '',
    hasImage: Boolean(q.image || q.pageImage),
    issues: [...(q.errors || []), ...(q.warnings || [])],
    ...(q.rawSource ? { rawSource: q.rawSource } : {})
  }));

  return `Kamu adalah auditor soal ujian cerdas yang berpikir seperti manusia (problem solver).
Analisis setiap soal pilihan ganda berikut, pahami akar masalahnya, dan berikan solusi perbaikan nyata.

Tugas & Strategi Problem Solving per soal:
1. "reasoning": Jelaskan singkat akar masalah yang ditemukan (misalnya: teks terpotong, dua soal tergabung, teks bacaan sah, urutan opsi melompat karena dialog/teks soal bocor ke opsi, opsi duplikat, atau informasi dari gambar) dan solusi yang kamu lakukan.
2. **Teks soal sangat panjang (> 1500 karakter) / soal tergabung**:
   - Cek apakah itu (a) satu bacaan (reading passage) + 1 pertanyaan yang sah -> bersihkan seperlunya dan set "status": "ok" (atau "fixed" jika diperbaiki).
   - Atau (b) 2+ soal berbeda yang ikut tergabung -> PECAH soal! Taruh soal pertama di "fixes" ("text", "options", "answer", "explanation") dan taruh soal tambahan hasil pecahan ke "fixes.splitQuestions": [{"num": 43, "text": "...", "options": [...], "answer": "A", "explanation": "..."}].
3. **Urutan opsi melompat (mis. B, A, B, C, D) atau opsi tidak lengkap**:
   - Pahami penyebabnya (biasanya ada teks/dialog berawalan B./C. dari badan soal yang ikut terbaca sebagai opsi sebelum opsi A..D yang asli, atau ada opsi yang hilang).
   - Pindahkan bagian yang sebenarnya merupakan badan soal kembali ke "fixes.text", dan susun ulang "fixes.options" secara bersih & berurutan (A, B, C, D/E). Periksa "rawSource" bila ada untuk memulihkan opsi yang terlewat, lalu sesuaikan "fixes.answer".
4. **Soal bergambar (hasImage: true atau gambar terlampir)**:
   - Jika gambar dilampirkan pada pesan ini, BACA gambar/tabel/grafik/notice tersebut untuk melengkapi teks/opsi yang hilang, menentukan kunci jawaban yang benar ("fixes.answer"), dan menulis "fixes.explanation" berdasarkan isi gambar.
   - Jika soal merujuk gambar tetapi gambar tidak tersedia, jelaskan di "reasoning" apa yang kurang dan set "status": "flagged" hanya jika tidak bisa dijawab tanpa gambar.
5. **Opsi duplikat**:
   - Cek "rawSource"/gambar untuk memulihkan opsi asli; jika tidak ada, pertahankan opsi jawaban benar dan ubah opsi duplikat lain menjadi pengecoh yang relevan & unik (set "status": "fixed").
6. **Soal duplikat**:
   - Pastikan tidak ada soal yang sama persis dalam batch ini; jika ada soal ganda, set "remove": true pada soal ganda tersebut.
7. **Kunci jawaban & pembahasan**:
   - Jika "answer" kosong atau jelas keliru berdasarkan analisis soal/gambar, lengkapi "fixes.answer" (A-E) dan berikan "fixes.explanation" singkat yang akurat.
8. **Status**:
   - "ok": soal, opsi, dan kunci jawaban sudah bersih & benar.
   - "fixed": kamu melakukan perbaikan nyata di "fixes".
   - "flagged": soal rusak parah/butuh gambar yang hilang dan tidak dapat diperbaiki otomatis.

Kembalikan HANYA JSON object valid dengan key "results" tanpa markdown atau teks tambahan:
{"results":[{"num":1,"reasoning":"...","status":"ok","remove":false,"issues":[],"fixes":{}}]}

Data soal:
${JSON.stringify(compact)}`;
}

function extractJsonArray(rawText) {
  const raw = String(rawText || '').trim();
  try {
    const direct = JSON.parse(raw);
    if (Array.isArray(direct)) return direct;
    if (Array.isArray(direct?.results)) return direct.results;
  } catch {
    // Fallback to bracket extraction below if wrapped in extra text.
  }

  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    console.warn('audit-quiz JSON parse failed:', err?.message || err);
    return null;
  }
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

    const questions = Array.isArray(body?.questions) ? body.questions.slice(0, 10) : [];
    if (questions.length === 0) {
      return sendJson({ error: 'Daftar soal tidak boleh kosong.' }, 400);
    }

    const promptText = buildAuditPrompt(questions);
    const attachedImages = [];
    for (const q of questions) {
      const imgUrl = typeof q.image === 'string' && q.image.startsWith('data:image/')
        ? q.image
        : (typeof q.pageImage === 'string' && q.pageImage.startsWith('data:image/') ? q.pageImage : '');
      if (imgUrl) {
        attachedImages.push({ num: q.num, url: imgUrl });
      }
    }

    const hasVision = attachedImages.length > 0;
    const userContent = hasVision
      ? [
          { type: 'text', text: promptText },
          ...attachedImages.flatMap((img) => [
            { type: 'text', text: `\n[GAMBAR UNTUK SOAL NO. ${img.num}]` },
            { type: 'image_url', image_url: { url: img.url } }
          ])
        ]
      : promptText;

    const messages = [
      {
        role: 'system',
        content: 'Kamu adalah auditor soal ujian cerdas StudyForge. Selalu balas dengan JSON object valid.'
      },
      { role: 'user', content: userContent }
    ];

    // 1. Prefer Groq multi-key pool if configured (with strict JSON object mode).
    const groqRes = await runGroqWithPool(context.env, messages, {
      ...(hasVision ? { models: GROQ_VISION_MODELS } : {}),
      temperature: 0.1,
      maxTokens: 6144,
      responseFormat: { type: 'json_object' }
    });
    if (groqRes.ok) {
      const results = extractJsonArray(groqRes.content);
      if (results) {
        return sendJson({ results, provider: hasVision ? 'groq-vision' : 'groq', model: groqRes.model });
      }
      return sendJson({
        error: `Respons Groq tidak berbentuk JSON valid (${groqRes.content.slice(0, 120)}).`
      }, 502);
    }

    // 2. Fallback to Cloudflare Workers AI if Groq is not configured or unavailable (text-only fallback).
    if (!context.env.AI || hasVision) {
      const status = groqRes.configured ? 502 : 501;
      return sendJson({ error: groqRes.error || 'AI provider belum dikonfigurasi.' }, status);
    }

    try {
      const cfResponse = await context.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
        messages,
        max_tokens: 4096,
        temperature: 0.1
      });

      const results = extractJsonArray(cfResponse?.response);
      if (!results) {
        return sendJson({ error: 'Respons AI tidak berbentuk JSON valid.' }, 502);
      }

      return sendJson({ results, provider: 'cloudflare-ai' });
    } catch (cfErr) {
      return sendJson({ error: cfErr?.message || groqRes.error || 'CF AI gagal memproses batch.' }, 502);
    }
  } catch (error) {
    console.error('audit-quiz error:', error);
    return sendJson({ error: error?.message || 'Terjadi kesalahan server saat mengaudit soal.' }, 500);
  }
}
