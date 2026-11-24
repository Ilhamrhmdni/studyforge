import { requireAdmin } from '../../_shared/auth.js';
import { getServiceConfigError } from '../../_shared/supabase.js';
import { sendJson } from '../../_shared/response.js';

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
3. Tentukan "status":
   - "ok" jika soal, opsi, dan kunci jawaban sudah bersih & benar.
   - "fixed" jika kamu memperbaiki teks OCR/spasi, memulihkan teks/opsi dari rawSource, menghapus metadata bocor, atau melengkapi kunci jawaban yang jelas.
   - "flagged" jika soal rusak parah/butuh gambar/kurang opsi dan tidak bisa diperbaiki otomatis.
4. Jika ada perbaikan, isi "fixes" hanya untuk field yang berubah: { "text"?, "options"?: [{"key":"A","text":"..."}], "answer"?, "explanation"? }. Jangan mengubah arti soal.

Kembalikan HANYA JSON array valid tanpa markdown atau teks tambahan:
[{"num":1,"reasoning":"...","status":"ok","issues":[],"fixes":{}}]

Data soal:
${JSON.stringify(compact)}`;
}

function extractJsonArray(rawText) {
  const match = /\[[\s\S]*\]/.exec(String(rawText || ''));
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function onRequestPost(context) {
  try {
    const configError = getServiceConfigError(context.env);
    if (configError) return sendJson({ error: configError }, 500);

    const auth = await requireAdmin(context);
    if (!auth.ok) return sendJson({ error: auth.message }, auth.status);

    if (!context.env.AI) {
      return sendJson({ error: 'Cloudflare AI binding belum dikonfigurasi dan Gemini key belum diisi.' }, 501);
    }

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

    const response = await context.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        {
          role: 'system',
          content: 'Kamu adalah auditor soal ujian StudyForge. Selalu balas dengan JSON array valid saja.'
        },
        { role: 'user', content: buildAuditPrompt(questions) }
      ],
      max_tokens: 4096,
      temperature: 0.1
    });

    const results = extractJsonArray(response?.response);
    if (!results) {
      return sendJson({ error: 'Respons AI tidak berbentuk JSON valid.' }, 502);
    }

    return sendJson({ results });
  } catch (error) {
    console.error('audit-quiz error:', error);
    return sendJson({ error: 'Terjadi kesalahan server saat mengaudit soal.' }, 500);
  }
}
