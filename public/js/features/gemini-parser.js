// Shared Gemini Vision PDF parser & question deduplication helpers.

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'];

/**
 * Compress a page data URL to reduce Gemini Vision token usage.
 */
function compressForGemini(dataUrl, maxWidth = 600, quality = 0.5) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality).split(',')[1]);
    };
    img.src = dataUrl;
  });
}

function formatGeminiError(errMsg) {
  const low = String(errMsg || '').toLowerCase();
  if (low.includes('reported as leaked')) {
    return 'Gemini API key terdeteksi bocor oleh Google. Buat key baru di AI Studio, simpan hanya di Konfigurasi, lalu hapus key lama.';
  }
  if (low.includes('api key not valid') || low.includes('invalid api key')) {
    return 'Gemini API key tidak valid. Pastikan key benar dan masih aktif.';
  }
  if (low.includes('permission denied') || low.includes('permission_denied')) {
    return 'Gemini API key tidak punya izin untuk model ini. Coba key atau project lain di Google AI Studio.';
  }
  return String(errMsg || 'Terjadi kesalahan saat memanggil Gemini.');
}

function getQuestionQualityScore(question) {
  const optionCount = Array.isArray(question?.options) ? question.options.length : 0;
  const textLength = String(question?.text || '').trim().length;
  return (question?.answer ? 8 : 0) + (question?.image ? 6 : 0) + (optionCount * 3) + Math.min(textLength, 200);
}

function shouldMergeQuestionPair(existing, incoming) {
  const normalize = typeof normalizeForCompare === 'function'
    ? normalizeForCompare
    : (s) => String(s || '').trim().toLowerCase();
  const a = normalize(existing?.text || '');
  const b = normalize(incoming?.text || '');

  if (!a || !b) return true;
  if (a === b || a.includes(b) || b.includes(a)) return true;

  const sameOptionCount = (existing?.options?.length || 0) === (incoming?.options?.length || 0);
  const sameAnswer = Boolean(existing?.answer && incoming?.answer && existing.answer === incoming.answer);
  return sameAnswer && sameOptionCount && a.slice(0, 80) === b.slice(0, 80);
}

function mergeQuestionPair(existing, incoming) {
  const keepExisting = getQuestionQualityScore(existing) >= getQuestionQualityScore(incoming);
  const base = keepExisting ? existing : incoming;
  const extra = keepExisting ? incoming : existing;
  return {
    ...base,
    text: String(base.text || '').trim() || String(extra.text || '').trim(),
    image: base.image || extra.image || null,
    answer: base.answer || extra.answer || '',
    options: (Array.isArray(base.options) && base.options.length ? base.options : extra.options) || []
  };
}

function mergeQuestionsByNumber(questions) {
  const merged = [];
  for (const question of (questions || []).slice().sort((a, b) => a.num - b.num)) {
    if (!question || !question.num) continue;
    if (typeof stripMarkers === 'function') {
      question.text = stripMarkers(question.text);
      if (Array.isArray(question.options)) {
        question.options = question.options.map((opt) => ({
          ...opt,
          text: stripMarkers(opt.text)
        }));
      }
    }
    const existingIndex = merged.findIndex((item) =>
      item.num === question.num && shouldMergeQuestionPair(item, question)
    );
    if (existingIndex >= 0) {
      merged[existingIndex] = mergeQuestionPair(merged[existingIndex], question);
    } else {
      merged.push(question);
    }
  }
  return merged;
}

async function requestGeminiBatch(model, geminiKey, parts, batchIndex, onLog) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
  let retries = 3;

  while (retries > 0) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
      })
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      const errMsg = data.error?.message || String(res.status);
      const friendlyErr = formatGeminiError(errMsg);
      if (friendlyErr !== errMsg) throw new Error(friendlyErr);

      const retryMatch = errMsg.match(/retry in ([\d.]+)s/i);
      if (retryMatch) {
        const waitSec = Math.ceil(parseFloat(retryMatch[1])) + 3;
        onLog(`⏳ Rate limit — menunggu ${waitSec}s lalu retry...`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        retries--;
        continue;
      }

      if (errMsg.includes('not found') || errMsg.includes('limit: 0')) {
        onLog(`⚠️ Model ${model} tidak tersedia, coba model lain...`);
        return null;
      }
      onLog(`⚠️ Batch ${batchIndex + 1}: ${errMsg.substring(0, 80)}`);
      return null;
    }

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      onLog(`⚠️ Batch ${batchIndex + 1}: Tidak ada JSON`);
      return null;
    }
    return JSON.parse(jsonMatch[0]);
  }
  return null;
}

/**
 * Parse PDF page images in batches using Gemini Vision with automatic model fallback.
 */
async function parseWithGemini(pageImagesMap, geminiKey, options = {}) {
  const onLog = typeof options.onLog === 'function' ? options.onLog : () => {};
  const pageNums = Object.keys(pageImagesMap).map(Number).sort((a, b) => a - b);
  const BATCH_SIZE = 2;

  const buildPrompt = (pages) => `Kamu adalah ekstraktor soal ujian.
Berikut ada ${pages.length} halaman PDF ujian (halaman ${pages.join(', ')}).
Analisis SEMUA halaman dan ekstrak SEMUA soal dari semua halaman.

Kembalikan SATU JSON array berisi SEMUA soal dari SEMUA halaman, format:
[
  {
    "num": 8,
    "text": "teks pertanyaan lengkap",
    "options": [
      {"key": "A", "text": "opsi A"},
      {"key": "B", "text": "opsi B"},
      {"key": "C", "text": "opsi C"},
      {"key": "D", "text": "opsi D"}
    ],
    "answer": "B",
    "hasImage": false,
    "imgPage": ${pages[0]}
  }
]
Aturan penting:
- Jika soal ada grafik/tabel/gambar di soalnya: set hasImage:true, set imgPage ke nomor halaman PDF soal itu berada
- answer = huruf jawaban benar (A/B/C/D/E), kosongkan "" jika tidak terlihat
- Nomor soal (num) harus sesuai nomor di PDF
- HANYA kembalikan JSON valid, TIDAK ada teks lain sama sekali`;

  const batches = [];
  for (let i = 0; i < pageNums.length; i += BATCH_SIZE) {
    batches.push(pageNums.slice(i, i + BATCH_SIZE));
  }

  onLog(`📦 Batching: ${pageNums.length} halaman → ${batches.length} request Gemini`);
  const allQuestions = [];
  let workingModel = null;

  for (let bi = 0; bi < batches.length; bi++) {
    const batchPages = batches[bi];
    onLog(`🤖 Gemini batch ${bi + 1}/${batches.length}: halaman ${batchPages.join(', ')}...`);

    /** @type {any[]} */
    const parts = [{ text: buildPrompt(batchPages) }];
    for (const pg of batchPages) {
      const compressed = await compressForGemini(pageImagesMap[pg]);
      parts.push({ text: `\n[HALAMAN PDF ${pg}]` });
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: compressed } });
    }

    const candidates = workingModel
      ? [workingModel, ...GEMINI_MODELS.filter((m) => m !== workingModel)]
      : GEMINI_MODELS;

    for (const model of candidates) {
      try {
        const batchQs = await requestGeminiBatch(model, geminiKey, parts, bi, onLog);
        if (Array.isArray(batchQs)) {
          if (!workingModel) {
            workingModel = model;
            onLog(`✅ Model: ${model}`);
          }
          onLog(`✅ Batch ${bi + 1}: ${batchQs.length} soal diekstrak`);
          allQuestions.push(...batchQs);
          break;
        }
      } catch (e) {
        onLog(`❌ Batch ${bi + 1} error: ${e.message}`);
        if (options.rethrowFatal) throw e;
        break;
      }
    }

    if (bi < batches.length - 1) {
      onLog('⏱️ Jeda 20 detik antar batch (free tier limit)...');
      await new Promise((r) => setTimeout(r, 20000));
    }
  }

  return mergeQuestionsByNumber(allQuestions);
}

function extractQuestionSourceSnippet(rawPdfText, num) {
  if (!rawPdfText || !num) return '';
  const startRegex = new RegExp(`(?:^|\\n)\\s*${num}\\s*[.)]\\s`, 'm');
  const startMatch = startRegex.exec(rawPdfText);
  if (!startMatch) return '';

  const startIdx = Math.max(0, startMatch.index);
  const nextRegex = new RegExp(`(?:^|\\n)\\s*${num + 1}\\s*[.)]\\s`, 'm');
  const tail = rawPdfText.slice(startIdx);
  const nextMatch = nextRegex.exec(tail.slice(10));
  const endIdx = nextMatch ? nextMatch.index + 10 : Math.min(tail.length, 1400);
  return tail.slice(0, Math.min(endIdx, 1400)).trim();
}

function buildQuizAuditPrompt(batch) {
  const compact = batch.map((q) => ({
    num: q.num,
    text: q.text,
    options: q.options,
    answer: q.answer || '',
    explanation: q.explanation || '',
    detectedIssues: [...(q.errors || []), ...(q.warnings || [])],
    ...(q.rawSource ? { rawSource: q.rawSource } : {})
  }));

  return `Kamu adalah auditor kualitas soal pilihan ganda (MCQ) StudyForge.
Periksa batch soal hasil parsing PDF berikut.
Untuk setiap soal:
1. Isi "reasoning" terlebih dahulu (maksimal 2 kalimat): cek keutuhan kalimat soal, kebersihan opsi (tidak ada metadata bocor/duplikat/OCR rusak), dan kesesuaian kunci jawaban.
2. Jika field "rawSource" tersedia, itu adalah kutipan teks asli dari PDF. Bandingkan hasil parsing dengan "rawSource" untuk memulihkan kata/kalimat yang terpotong, opsi yang hilang, atau kunci jawaban yang terlewat di PDF.
3. Tentukan "status":
   - "ok": soal, opsi, dan kunci jawaban sudah bersih dan valid.
   - "fixed": ada perbaikan aman yang kamu terapkan di "fixes" (misalnya memulihkan teks/opsi dari rawSource, merapikan spasi/typo OCR, menghapus metadata bocor, memperbaiki kunci jawaban yang kosong/salah jika sangat jelas).
   - "flagged": soal butuh tinjauan manual admin (misalnya butuh gambar yang hilang, opsi terpotong parah, atau jawaban ambigu).
4. Isi "issues" (array string, kosong [] jika tidak ada masalah).
5. Isi "fixes" (object, hanya sertakan field yang diperbaiki: "text", "options", "answer", "explanation").

Kembalikan HANYA JSON array valid:
[{"num": 1, "reasoning": "...", "status": "ok", "issues": [], "fixes": {}}]

Data batch:
${JSON.stringify(compact)}`;
}

function parseJsonArraySafe(rawText) {
  const raw = String(rawText || '').trim();
  try {
    const direct = JSON.parse(raw);
    if (Array.isArray(direct)) return direct;
  } catch {
    // Fallback to regex bracket extraction below if wrapped in markdown.
  }
  const match = /\[[\s\S]*\]/.exec(raw);
  if (!match) return null;
  try {
    const extracted = JSON.parse(match[0]);
    return Array.isArray(extracted) ? extracted : null;
  } catch {
    return null;
  }
}

async function callGeminiAuditModel(model, geminiKey, promptText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: promptText }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json'
      }
    })
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    const errMsg = data.error?.message || String(res.status);
    const friendly = formatGeminiError(errMsg);
    if (friendly !== errMsg) throw new Error(friendly);
    return { ok: false, retryable: errMsg.includes('not found') || errMsg.includes('limit: 0'), errMsg };
  }
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { ok: true, raw };
}

async function requestGeminiAuditBatch(batch, geminiKey, preferredModel, onLog) {
  const candidates = preferredModel
    ? [preferredModel, ...GEMINI_MODELS.filter((m) => m !== preferredModel)]
    : GEMINI_MODELS;
  const promptText = buildQuizAuditPrompt(batch);

  for (const model of candidates) {
    const first = await callGeminiAuditModel(model, geminiKey, promptText);
    if (!first.ok) {
      if (first.retryable) continue;
      onLog(`⚠️ Audit Gemini (${model}): ${first.errMsg.substring(0, 80)}`);
      continue;
    }

    const parsed = parseJsonArraySafe(first.raw);
    if (parsed) return { results: parsed, model };

    // Single JSON repair retry per LLM-as-a-Judge self-correction pattern.
    const repairPrompt = `Perbaiki JSON berikut agar menjadi JSON array valid sesuai skema [{"num":1,"reasoning":"...","status":"ok","issues":[],"fixes":{}}] tanpa mengubah isi audit:\n${first.raw.slice(0, 6000)}`;
    const repaired = await callGeminiAuditModel(model, geminiKey, repairPrompt);
    const repairedParsed = repaired.ok ? parseJsonArraySafe(repaired.raw) : null;
    if (repairedParsed) return { results: repairedParsed, model };
  }
  return null;
}

function applyAuditItemToQuestion(question, item) {
  if (!item || typeof item !== 'object') return 'ok';
  const fixes = item.fixes && typeof item.fixes === 'object' ? item.fixes : {};

  if (typeof fixes.text === 'string' && fixes.text.trim().length >= 5) {
    question.text = fixes.text.trim();
  }
  if (Array.isArray(fixes.options) && fixes.options.length >= 2) {
    question.options = fixes.options
      .filter((opt) => opt && opt.key && typeof opt.text === 'string')
      .map((opt) => ({ key: String(opt.key).trim().toUpperCase(), text: opt.text.trim() }));
  }
  if (typeof fixes.answer === 'string' && /^[A-E]$/i.test(fixes.answer.trim())) {
    question.answer = fixes.answer.trim().toUpperCase();
  }
  if (typeof fixes.explanation === 'string' && fixes.explanation.trim()) {
    question.explanation = fixes.explanation.trim();
  }

  const status = ['ok', 'fixed', 'flagged'].includes(item.status) ? item.status : 'ok';
  question.aiAudit = {
    status,
    reasoning: typeof item.reasoning === 'string' ? item.reasoning.trim() : '',
    issues: Array.isArray(item.issues) ? item.issues.map(String) : []
  };
  return status;
}

/**
 * Audit and auto-correct parsed questions in batches of 10 using Gemini or Cloudflare AI fallback.
 */
async function auditQuizWithAI(questions, options = {}) {
  const BATCH_SIZE = 10;
  const onLog = typeof options.onLog === 'function' ? options.onLog : () => {};
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const geminiKey = String(options.geminiKey || '').trim();
  const rawPdfText = String(options.rawPdfText || '');
  const backendAuditFn = typeof options.backendAuditFn === 'function' ? options.backendAuditFn : null;

  const summary = { total: questions.length, ok: 0, fixed: 0, flagged: 0 };
  let workingModel = null;

  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    const batch = questions.slice(i, i + BATCH_SIZE);
    const enrichedBatch = rawPdfText
      ? batch.map((q) => ({ ...q, rawSource: extractQuestionSourceSnippet(rawPdfText, q.num) }))
      : batch;
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(questions.length / BATCH_SIZE);
    onProgress({ batchNum, totalBatches, processed: i, total: questions.length });
    onLog(`🤖 Mengaudit batch ${batchNum}/${totalBatches} (soal ${batch[0].num}–${batch.at(-1).num})...`);

    let batchResults = null;
    if (geminiKey) {
      const geminiOut = await requestGeminiAuditBatch(enrichedBatch, geminiKey, workingModel, onLog);
      if (geminiOut) {
        workingModel = geminiOut.model;
        batchResults = geminiOut.results;
      }
    } else if (backendAuditFn) {
      const backendRes = await backendAuditFn(enrichedBatch);
      if (Array.isArray(backendRes?.results)) batchResults = backendRes.results;
    } else {
      throw new Error('Tidak ada penyedia AI yang tersedia untuk audit.');
    }

    if (!Array.isArray(batchResults)) {
      batch.forEach((q) => {
        q.aiAudit = { status: 'flagged', reasoning: 'Gagal memproses batch audit AI.', issues: ['Batch audit gagal'] };
        summary.flagged++;
      });
      continue;
    }

    const byNum = new Map(batchResults.map((item) => [Number(item?.num), item]));
    batch.forEach((q) => {
      const status = applyAuditItemToQuestion(q, byNum.get(Number(q.num)));
      summary[status] = (summary[status] || 0) + 1;
    });
  }

  onProgress({
    batchNum: Math.ceil(questions.length / BATCH_SIZE),
    totalBatches: Math.ceil(questions.length / BATCH_SIZE),
    processed: questions.length,
    total: questions.length
  });

  return { questions, summary };
}

window.compressForGemini = compressForGemini;
window.formatGeminiError = formatGeminiError;
window.getQuestionQualityScore = getQuestionQualityScore;
window.shouldMergeQuestionPair = shouldMergeQuestionPair;
window.mergeQuestionPair = mergeQuestionPair;
window.mergeQuestionsByNumber = mergeQuestionsByNumber;
window.parseWithGemini = parseWithGemini;
window.auditQuizWithAI = auditQuizWithAI;
