import { requireAdmin } from '../../_shared/auth.js';
import { getServiceConfigError } from '../../_shared/supabase.js';
import { sendJson } from '../../_shared/response.js';
import { runGroqWithPool } from '../../_shared/groq.js';

function buildAuditPrompt(questions) {
  const compact = questions.map((q) => ({
    num: q.num,
    text: q.text,
    options: q.options,
    answer: q.answer || '',
    explanation: q.explanation || '',
    issues: [...(q.errors || []), ...(q.warnings || [])],
    ...(q.rawSource ? { rawSource: q.rawSource } : {})
  }));

  return `Audit dan perbaiki hasil parsing soal pilihan ganda berikut.
Tugas per soal:
1. Tulis "reasoning" singkat terlebih dahulu untuk mengecek apakah teks soal utuh, opsi lengkap tanpa teks bocor/duplikat, dan kunci jawaban sesuai.
2. Jika ada "rawSource" (kutipan teks asli PDF), bandingkan hasil parsing dengan "rawSource" untuk memulihkan kata/kalimat yang terpotong, opsi yang hilang, atau kunci jawaban yang terlewat.
3. Jika terdapat opsi jawaban yang sama/duplikat: cek "rawSource" untuk memulihkan opsi asli dari PDF; jika tidak ada di "rawSource", pertahankan opsi yang merupakan jawaban benar dan ubah opsi duplikat lainnya menjadi pengecoh yang relevan dan berbeda agar semua opsi unik (set status "fixed").
4. Pastikan tidak ada soal duplikat dalam batch ini; jika ada soal yang duplikat persis dengan soal lain, set "remove": true pada soal ganda tersebut.
5. Tentukan "status":
   - "ok" jika soal, opsi, dan kunci jawaban sudah bersih & benar.
   - "fixed" jika kamu memperbaiki teks OCR/spasi, memulihkan teks/opsi dari rawSource, mengganti opsi duplikat, menghapus metadata bocor, atau melengkapi kunci jawaban yang jelas.
   - "flagged" jika soal rusak parah/butuh gambar/kurang opsi dan tidak bisa diperbaiki otomatis.
6. Jika ada perbaikan, isi "fixes" secara nyata (jangan hanya menulis niat di "reasoning"): { "text"?, "options"?: [{"key":"A","text":"..."}, ...], "answer"?, "explanation"? }. Jika mengubah opsi, sertakan seluruh opsi A-D/E di "fixes.options". Jangan mengubah arti soal.

Kembalikan HANYA JSON object valid dengan key "results" berisi array tanpa markdown atau teks tambahan:
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

    const messages = [
      {
        role: 'system',
        content: 'Kamu adalah auditor soal ujian StudyForge. Selalu balas dengan JSON array valid saja.'
      },
      { role: 'user', content: buildAuditPrompt(questions) }
    ];

    // 1. Prefer Groq multi-key pool if configured (with strict JSON object mode).
    const groqRes = await runGroqWithPool(context.env, messages, {
      temperature: 0.1,
      maxTokens: 6144,
      responseFormat: { type: 'json_object' }
    });
    if (groqRes.ok) {
      const results = extractJsonArray(groqRes.content);
      if (results) {
        return sendJson({ results, provider: 'groq', model: groqRes.model });
      }
      return sendJson({
        error: `Respons Groq tidak berbentuk JSON valid (${groqRes.content.slice(0, 120)}).`
      }, 502);
    }

    // 2. Fallback to Cloudflare Workers AI if Groq is not configured or unavailable.
    if (!context.env.AI) {
      const status = groqRes.configured ? 502 : 501;
      return sendJson({ error: groqRes.error || 'AI provider belum dikonfigurasi.' }, status);
    }

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
  } catch (error) {
    console.error('audit-quiz error:', error);
    return sendJson({ error: 'Terjadi kesalahan server saat mengaudit soal.' }, 500);
  }
}
