pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let parsedQuestions = [];
const parserHelpers = {
  parseQuestions: window.parseQuestions,
  parseAnswerKey: window.parseAnswerKey,
  validateParsedQuiz: window.validateParsedQuiz
};

async function getAdminAccessToken() {
  const sb = initSupabase();
  const { data: { session } } = await sb.auth.getSession();
  return session?.access_token || '';
}

async function adminApiFetch(path, options = {}) {
  const token = await getAdminAccessToken();
  if (!token) throw new Error('Sesi login admin tidak ditemukan.');

  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `Request gagal (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

// ── ADMIN AUTH ──
async function initAdminAuth() {
  const user = await requireAuth(); // Redirects to login.html if not logged in
  if (!user) return;

  try {
    await adminApiFetch('/api/admin/session');
    document.getElementById('loginScreen').style.display = 'none';
    initAdmin();
  } catch (error) {
    document.getElementById('adminStatusText').innerHTML = '❌ Akses Ditolak';
    document.getElementById('loginError').innerHTML = 'Akun Anda ('+escapeHTML(user.email)+') tidak memiliki akses admin.<br><br><button class="btn btn-outline" onclick="location.href=\'/\'">Kembali ke Beranda</button>';
  }
}

function adminLogout() {
  initSupabase().auth.signOut().then(() => {
    location.href = '/login.html';
  });
}

async function initAdminAuthSafe() {
  const user = await requireAuth();
  if (!user) return;

  try {
    await adminApiFetch('/api/admin/session');
    document.getElementById('loginScreen').style.display = 'none';
    initAdmin();
  } catch (error) {
    if (error.status === 403) {
      document.getElementById('adminStatusText').textContent = 'Akses Ditolak';
      document.getElementById('loginError').innerHTML = 'Akun Anda (' + escapeHTML(user.email) + ') tidak memiliki akses admin.<br><br><button class="btn btn-outline" onclick="location.href=\'/\'">Kembali ke Beranda</button>';
      return;
    }

    document.getElementById('adminStatusText').textContent = 'Admin belum siap';
    document.getElementById('loginError').innerHTML = `${escapeHTML(error.message || 'Terjadi gangguan saat memeriksa sesi admin.')}<br><br><small style="color:var(--text2);">Periksa Cloudflare env dan koneksi Supabase, lalu refresh halaman.</small>`;
  }
}

initAdminAuthSafe();

// ── CONFIG ──
function saveConfig() {
  const geminiKey = document.getElementById('cfgGemini').value.trim();
  const cfg = { geminiKey };
  localStorage.setItem('sf_config', JSON.stringify(cfg));
  document.getElementById('cfgStatus').textContent = geminiKey ? '✅ Key tersimpan! (Gemini aktif 🤖)' : '✅ Key tersimpan!';
  setTimeout(() => document.getElementById('cfgStatus').textContent = '', 3000);
}

function getConfig() {
  try { return JSON.parse(localStorage.getItem('sf_config')||'null'); } catch { return null; }
}

function initAdmin() {
  // Load saved keys
  const cfg = getConfig();
  if (cfg) {
    document.getElementById('cfgGemini').value = cfg.geminiKey || '';
  }
}

// ── DRAG & DROP ──
const dropZone = document.getElementById('dropZone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFile(e.dataTransfer.files[0]); });

// ── PDF PARSING ──
let pageImages = {}; // page number → base64 image

// Compress page image before sending to Gemini (reduce token usage ~80%)
function compressForGemini(dataUrl, maxWidth = 600) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(1, maxWidth / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * ratio);
      c.height = Math.round(img.height * ratio);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.4).split(',')[1]);
    };
    img.src = dataUrl;
  });
}

function formatGeminiError(errMsg) {
  const low = String(errMsg || '').toLowerCase();
  if (low.includes('reported as leaked')) {
    return 'Gemini API key terdeteksi bocor oleh Google. Buat key baru di AI Studio, simpan hanya di Konfigurasi admin, lalu hapus key lama.';
  }
  if (low.includes('api key not valid') || low.includes('invalid api key')) {
    return 'Gemini API key tidak valid. Pastikan key benar dan masih aktif.';
  }
  if (low.includes('permission denied') || low.includes('permission_denied')) {
    return 'Gemini API key tidak punya izin untuk model ini. Coba key atau project lain di Google AI Studio.';
  }
  return String(errMsg || 'Terjadi kesalahan saat memanggil Gemini.');
}

// ── GEMINI VISION PARSER (BATCH MODE) ──
async function parseWithGemini(pageImagesMap, geminiKey) {
  const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'];
  const pageNums = Object.keys(pageImagesMap).map(Number).sort((a,b) => a-b);
  const BATCH_SIZE = 2; // 2 pages per call → safer token limit

  const PROMPT = (pages) => `Kamu adalah ekstraktor soal ujian.
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

  let workingModel = null;
  let GEMINI_URL = '';

  // Process in batches
  const allQuestions = [];
  const batches = [];
  for (let i = 0; i < pageNums.length; i += BATCH_SIZE) {
    batches.push(pageNums.slice(i, i + BATCH_SIZE));
  }

  log(`📦 Batching: ${pageNums.length} halaman → ${batches.length} request Gemini`);

  for (let bi = 0; bi < batches.length; bi++) {
    const batchPages = batches[bi];
    log(`🤖 Gemini batch ${bi+1}/${batches.length}: halaman ${batchPages.join(', ')}...`);

    // Build multi-image parts (compressed to save tokens)
    const parts = [{ text: PROMPT(batchPages) }];
    for (const pg of batchPages) {
      const compressed = await compressForGemini(pageImagesMap[pg]);
      parts.push({ text: `\n[HALAMAN PDF ${pg}]` });
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: compressed } });
    }

    // Try models until one works
    let success = false;
    for (const model of MODELS) {
      if (!workingModel) {
        GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      }
      const url = workingModel
        ? GEMINI_URL
        : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;

      let retries = 3;
      while (retries > 0) {
        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
            })
          });

          const data = await res.json();

          if (!res.ok) {
            const errMsg = data.error?.message || String(res.status);
            const friendlyErr = formatGeminiError(errMsg);
            if (friendlyErr !== errMsg) {
              throw new Error(friendlyErr);
            }
            // Rate limit → wait and retry
            const retryMatch = errMsg.match(/retry in ([\d.]+)s/i);
            if (retryMatch) {
              const waitSec = Math.ceil(parseFloat(retryMatch[1])) + 3;
              log(`⏳ Rate limit — menunggu ${waitSec}s lalu retry...`);
              await new Promise(r => setTimeout(r, waitSec * 1000));
              retries--;
              continue;
            }
            // Model not available → try next
            if (errMsg.includes('not found') || errMsg.includes('limit: 0')) {
              log(`⚠️ Model ${model} tidak tersedia, coba model lain...`);
              break;
            }
            log(`⚠️ Batch ${bi+1}: ${errMsg.substring(0, 80)}`);
            retries = 0; break;
          }

          // Success!
          if (!workingModel) { workingModel = model; GEMINI_URL = url; log(`✅ Model: ${model}`); }
          const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const jsonMatch = raw.match(/\[[\s\S]*\]/);
          if (!jsonMatch) { log(`⚠️ Batch ${bi+1}: Tidak ada JSON`); retries = 0; break; }

          const batchQs = JSON.parse(jsonMatch[0]);
          log(`✅ Batch ${bi+1}: ${batchQs.length} soal diekstrak`);

          for (const q of batchQs) {
            allQuestions.push(q);
          }
          success = true;
          retries = 0; break;

        } catch(e) {
          log(`❌ Batch ${bi+1} error: ${e.message}`);
          retries = 0; break;
        }
      }
      if (success) break;
    }

    // Delay between batches — 20s ensures we stay under 20 RPM free tier
    if (bi < batches.length - 1) {
      log(`⏱️ Jeda 20 detik antar batch (free tier limit)...`);
      await new Promise(r => setTimeout(r, 20000));
    }
  }

  return mergeQuestionsByNumber(allQuestions);
}

function getQuestionQualityScore(question) {
  const optionCount = Array.isArray(question?.options) ? question.options.length : 0;
  const textLength = String(question?.text || '').trim().length;
  return (question?.answer ? 8 : 0) + (question?.image ? 6 : 0) + (optionCount * 3) + Math.min(textLength, 200);
}

function shouldMergeQuestionPair(existing, incoming) {
  const a = typeof normalizeForCompare === 'function'
    ? normalizeForCompare(existing?.text || '')
    : String(existing?.text || '').trim().toLowerCase();
  const b = typeof normalizeForCompare === 'function'
    ? normalizeForCompare(incoming?.text || '')
    : String(incoming?.text || '').trim().toLowerCase();

  if (!a || !b) return true;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;

  const sameOptionCount = (existing?.options?.length || 0) === (incoming?.options?.length || 0);
  const sameAnswer = !!existing?.answer && !!incoming?.answer && existing.answer === incoming.answer;
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


// Store raw canvas elements for cropping (not just base64)
let pageCanvasEls = {};
let pageTextItems = {};
let pageViewports  = {};

async function handleFile(file) {
  if (!file || file.type !== 'application/pdf') { showToast('Pilih file PDF!','error'); return; }
  log('📂 File: ' + file.name);
  log('⏳ Memproses PDF...');
  document.getElementById('parseLog').style.display = 'block';
  pageImages = {}; pageCanvasEls = {}; pageTextItems = {}; pageViewports = {};

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
  log(`📄 Total halaman: ${pdf.numPages}`);

  // ── Step 1: Scan all pages, detect which have embedded images ──
  const imagePages = [];   // pages with embedded graphics/graphs
  const textOnlyPages = []; // pages with text only
  let textFullText = '';   // combined text from text-only pages
  let imageFullText = '';  // text from image pages (for regex fallback)

  log('🔍 Memindai halaman...');
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const scale = 1.8;
    const viewport = page.getViewport({ scale });
    pageViewports[i] = viewport;

    // Render to canvas
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    pageCanvasEls[i] = canvas;
    pageImages[i] = canvas.toDataURL('image/jpeg', 0.80);

    // Extract text items with Y positions
    const content = await page.getTextContent();
    pageTextItems[i] = content.items
      .filter(it => it.str.trim())
      .map(it => ({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] }));

    // Reconstruct lines
    const byY = {};
    for (const it of pageTextItems[i]) {
      const yr = Math.round(it.y);
      if (!byY[yr]) byY[yr] = [];
      byY[yr].push(it);
    }
    const pageLines = Object.keys(byY).map(Number).sort((a,b) => b-a)
      .map(y => byY[y].sort((a,b) => a.x-b.x).map(t => t.str).join(' ').trim())
      .filter(l => l);

    // ── Detect embedded images via operator list ──
    const opList = await page.getOperatorList();
    const hasEmbeddedImage = opList.fnArray.some(fn =>
      fn === pdfjsLib.OPS.paintImageXObject ||
      fn === pdfjsLib.OPS.paintJpegXObject ||
      fn === pdfjsLib.OPS.paintInlineImageXObject ||
      fn === pdfjsLib.OPS.paintImageMaskXObject
    );

    if (hasEmbeddedImage) {
      imagePages.push(i);
      imageFullText += pageLines.join('\n') + '\n\n';
    } else {
      textOnlyPages.push(i);
      textFullText += pageLines.join('\n') + '\n\n';
    }
  }

  log(`📝 Halaman teks saja: ${textOnlyPages.join(', ') || '-'}`);
  log(`🖼️ Halaman bergambar: ${imagePages.join(', ') || '-'}`);

  // ── Step 2: Parse text-only pages with REGEX (fast, no API) ──
  let regexQuestions = [];
  if (textFullText.trim()) {
    log('🔍 Parsing halaman teks dengan regex...');
    regexQuestions = parserHelpers.parseQuestions(textFullText);
    log(`✅ Regex: ${regexQuestions.length} soal dari halaman teks`);
  }

  // ── Step 3: Parse image pages with GEMINI (only if key exists) ──
  let geminiQuestions = [];
  if (imagePages.length > 0) {
    const cfg = getConfig();
    const geminiKey = cfg?.geminiKey;

    if (geminiKey) {
      log(`🤖 Gemini memproses ${imagePages.length} halaman bergambar...`);
      // Build map of ONLY image page images
      const imagePageMap = {};
      imagePages.forEach(pg => imagePageMap[pg] = pageImages[pg]);
      try {
        geminiQuestions = await parseWithGemini(imagePageMap, geminiKey);
        log(`✅ Gemini: ${geminiQuestions.length} soal dari halaman bergambar`);
      } catch(e) {
        log(`⚠️ Gemini gagal: ${e.message}`);
        log('↩️ Fallback regex untuk halaman bergambar...');
        const fallback = parserHelpers.parseQuestions(imageFullText);
        geminiQuestions = fallback;
        log(`⚠️ Fallback: ${fallback.length} soal (mungkin tidak sempurna)`);
      }
    } else {
      log(`⚠️ ${imagePages.length} halaman punya gambar — isi Gemini API Key untuk hasil akurat!`);
      log('↩️ Mencoba regex (mungkin ada soal yang tidak terparsing)...');
      const fallback = parserHelpers.parseQuestions(imageFullText);
      geminiQuestions = fallback;
      log(`📋 Regex fallback: ${fallback.length} soal`);
    }
  }

  // ── Step 4: Merge regex + Gemini results, sort by question number ──
  const allRaw = [...regexQuestions, ...geminiQuestions];
  parsedQuestions = mergeQuestionsByNumber(allRaw);

  log(`✅ Total: ${parsedQuestions.length} soal terdeteksi secara Regex & AI`);

  // ── Attach Key file if present ──
  const keyInput = document.getElementById('keyInput').files[0];
  if (keyInput && typeof parserHelpers.parseAnswerKey === 'function') {
    try {
      const keyText = await keyInput.text();
      const answerMap = parserHelpers.parseAnswerKey(keyText);
      log(`🔑 Kunci jawaban diproses: ${Object.keys(answerMap).length} baris.`);
      for (const q of parsedQuestions) {
        if (answerMap[q.num]) q.answer = answerMap[q.num];
      }
    } catch(e) { log(`⚠️ Gagal memproses file kunci: ${e.message}`); }
  }

  // ── Step 5: Attach cropped images for Gemini-detected image questions ──
  const pageQuestionMap = {};
  for (const pg of imagePages) {
    const pgItems = pageTextItems[pg] || [];
    pgItems.forEach(it => {
      const m = it.str.match(/^(\d+)[.)]/);
      if (m) {
        if (!pageQuestionMap[pg]) pageQuestionMap[pg] = [];
        pageQuestionMap[pg].push(parseInt(m[1]));
      }
    });
  }
  attachCroppedImages(parsedQuestions, pageQuestionMap);

  document.getElementById('quizTitle').value = file.name.replace('.pdf','');
  updatePreview();

  // Generate description with Gemini (client) or Cloudflare AI (server)
  const cfg = getConfig();
  if (parsedQuestions.length > 0) {
    const descInput = document.getElementById('quizDesc');
    descInput.placeholder = '✨ AI sedang membuat deskripsi...';
    const contextText = parsedQuestions.slice(0, 5).map(q => q.text).join('\n');
    
    if (cfg?.geminiKey) {
      // Prioritaskan Gemini jika key ada
      generateQuizDescription(contextText, cfg.geminiKey).then(desc => {
        if (desc && !descInput.value) descInput.value = desc;
        descInput.placeholder = 'Deskripsi singkat paket soal';
      }).catch(e => {
        descInput.placeholder = 'Deskripsi singkat paket soal';
      });
    } else {
      // Gunakan Cloudflare AI lewat backend
      adminApiFetch('/api/admin/generate-description', {
        method: 'POST',
        body: { text: contextText }
      }).then(res => {
        if (res.description && !descInput.value) {
          // Bersihkan sisa tanda kutip dari Llama
          descInput.value = res.description.replace(/^["']|["']$/g, '').trim();
          if (typeof showToast === 'function') showToast('Deskripsi berhasil di-generate dengan Cloudflare AI', 'success');
        }
        descInput.placeholder = 'Deskripsi singkat paket soal';
      }).catch(e => {
        console.error('Gagal generate deskripsi dari CF AI:', e);
        if (typeof showToast === 'function') {
          showToast('Gagal memuat deskripsi AI (Mungkin binding AI mati di lokal)', 'error');
        }
        descInput.placeholder = 'Deskripsi singkat paket soal';
      });
    }
  }
}

// ── Crop image area between question text and options ──
function attachCroppedImages(questions, pageQuestionMap) {

  // Build question → page map
  const qToPage = {};
  for (const [pg, nums] of Object.entries(pageQuestionMap)) {
    for (const n of nums) qToPage[n] = parseInt(pg);
  }

  for (const q of questions) {
    if (!q.hasImage) continue;

    // Use Gemini's imgPage if available, else fallback to text-based map
    let pg = q.imgPage || qToPage[q.num];
    if (!pg) {
      // Find the page by searching text items directly
      pg = Object.keys(pageTextItems).find(p => 
        pageTextItems[p].some(it => it.str.match(new RegExp('^' + q.num + '[.)]')))
      );
    }
    if (!pg || !pageCanvasEls[pg] || !pageTextItems[pg]) continue;

    const items = pageTextItems[pg];
    const viewport = pageViewports[pg];
    const scale = viewport.scale;
    const pageH = viewport.viewBox[3]; // PDF page height in points

    // Find Y of question text line (search for question number marker)
    let qMarker = items.find(it =>
      it.str.match(new RegExp('^' + q.num + '[.)]')) ||
      it.str === q.num.toString()
    );
    
    // If exact number not found, try to find the question text itself
    if (!qMarker && q.text) {
      const qSnippet = q.text.substring(0, 15);
      qMarker = items.find(it => it.str.includes(qSnippet));
    }
    
    if (!qMarker) continue;
    const qY = qMarker.y; // PDF Y of question start (from bottom)

    // Find Y of first option text (MUST be below the question text, so y < qY + 10)
    let bottomY = null;
    const optionYs = q.options.map(opt => {
      const validMarkers = items.filter(it =>
        it.y < qY + 10 &&
        (it.str.match(new RegExp('^[' + opt.key + '][.)]', 'i')) ||
         (opt.text.length > 3 && it.str.includes(opt.text.substring(0, Math.min(8, opt.text.length)))))
      );
      if (validMarkers.length === 0) return null;
      // We want the one closest to the question (highest Y among those below qY)
      return Math.max(...validMarkers.map(m => m.y));
    }).filter(y => y !== null);

    if (optionYs.length > 0) {
      bottomY = Math.max(...optionYs);
    } else {
      // Fallback 1: Find next question's Y (must be below current question)
      const validNextQ = items.filter(it => 
        it.y < qY - 10 && 
        it.str.match(new RegExp('^' + (q.num + 1) + '[.)]'))
      );
      if (validNextQ.length > 0) {
        bottomY = Math.max(...validNextQ.map(m => m.y));
      } else {
        // Fallback 2: Just take 300 points below the question
        bottomY = Math.max(0, qY - 300); 
      }
    }

    // Gap = question Y - bottomY (question is above options in PDF)
    const gap = qY - bottomY;

    // Convert PDF Y coords → canvas pixel coords
    // Canvas Y = (pageH - pdfY) * scale
    // We add some padding (-15 to go slightly above question, +15 to go slightly below)
    const canvasYTop = Math.max(0, (pageH - qY) * scale - 15);      
    const canvasYBottom = Math.min(pageCanvasEls[pg].height, (pageH - bottomY) * scale + 15); 

    let cropTop = Math.round(canvasYTop);
    let cropBottom = Math.round(canvasYBottom);
    
    // If the gap is suspiciously small (e.g., options are on the same line or right below),
    // force a minimum height for the image crop
    if (cropBottom - cropTop < 100) {
      cropBottom = Math.min(pageCanvasEls[pg].height, cropTop + 250);
    }
    
    const cropH = cropBottom - cropTop;

    // Crop canvas
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = pageCanvasEls[pg].width;
    cropCanvas.height = cropH;
    cropCanvas.getContext('2d').drawImage(pageCanvasEls[pg], 0, -cropTop);
    q.image = cropCanvas.toDataURL('image/jpeg', 0.88);
  }
}

// ── Legacy wrapper (kept for compatibility) ──
function parseWithRegex(fullText, pageImages, pageQuestionMap) {
  return parserHelpers.parseQuestions(fullText);
}




function parseQuestions(text) {
  // ── Detect format ──
  const isLMSFormat = /Question\s+\d+/i.test(text) || /Correct\s+Mark\s+[\d.]+\s+out\s+of/i.test(text);
  log(`📋 Format terdeteksi: ${isLMSFormat ? 'LMS/Moodle Export' : 'Standard Numbered'}`);
  return isLMSFormat ? parseLMSFormat(text) : parseStandardFormat(text);
}

// ── FORMAT 1: Standard (1. Soal, A. Opsi) ──
function parseStandardFormat(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const questions = [];
  let current = null;

  // Detect answer key section
  let answerKeyStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/kunci\s*jawaban|answer\s*key|pembahasan|kunci\s*soal/i.test(lines[i])) {
      answerKeyStart = i; break;
    }
  }
  const answerKeys = {};
  if (answerKeyStart > -1) {
    for (let i = answerKeyStart; i < lines.length; i++) {
      const m = lines[i].match(/^(\d+)[.)]\s*([A-Ea-e])\b/) ||
                lines[i].match(/no\.?\s*(\d+)\s*[=:]\s*([A-Ea-e])\b/i);
      if (m) answerKeys[parseInt(m[1])] = m[2].toUpperCase();
    }
    log(`🔑 Kunci jawaban: ${Object.keys(answerKeys).length} soal`);
  }

  const workLines = answerKeyStart > 0 ? lines.slice(0, answerKeyStart) : lines;

  for (let i = 0; i < workLines.length; i++) {
    const line = workLines[i];
    const qMatch = line.match(/^(\d+)[.)]\s+(.+)/);
    if (qMatch) {
      const nextNum = parseInt(qMatch[1], 10);
      if (current && nextNum <= current.num) {
        current.text += ' ' + line;
        continue;
      }
      if (current) questions.push(current);
      current = { num: nextNum, text: qMatch[2], options: [], answer: answerKeys[nextNum] || '' };
      continue;
    }
    if (!current) continue;
    const optMatch = line.match(/^([A-Ea-e])[.)]\s+(.+)/);
    if (optMatch) {
      current.options.push({ key: optMatch[1].toUpperCase(), text: optMatch[2] });
      continue;
    }
    if (current.options.length > 0) {
      current.options[current.options.length-1].text += ' ' + line;
    } else {
      current.text += ' ' + line;
    }
  }
  if (current) questions.push(current);
  
  // Post-process with normalize.js
  for (const q of questions) {
    q.text = stripMarkers(q.text);
    for (const opt of q.options) {
      if (hasCorrectMarker(opt.text)) {
        q.answer = opt.key;
      }
      opt.text = stripMarkers(opt.text);
    }
  }

  return questions.filter(q => q.options.length >= 2);
}

// ── FORMAT 2: LMS/Moodle Export (Question X, a. b. c. d., Correct answer: teks) ──

// Strip PDF checkbox/marker symbols that leak into option text
function cleanPdfText(s) {
  return (s || '')
    .replace(/[\u25A0\u25A1\u25AA\u25AB\u2610\u2611\u2612\u2713\u2714\u2715\u2716\u2717\u2718\u2022\u00B7]/g, '') // boxes & checkmarks
    .replace(/[\uF0FE\uF0FC\uF0B7\uF020\uFFFD]/g, '') // common PDF private-use chars
    .replace(/\s{2,}/g, ' ') // collapse double spaces
    .trim();
}

function parseLMSFormat(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const questions = [];
  let current = null;
  let skipMeta = false;

  // Meta lines to skip
  const isMetaLine = l =>
    /^(Correct|Incorrect|Partially\s+correct|Mark\s+[\d.]+|Flag|Question\s+\d+\s*$|Not\s+answered|Score\s+[\d.]+|Finish\s+review|Started\s+on|State:|Completed\s+on|Time\s+taken|Grade|Maximum|Question\s+text)/i.test(l) ||
    /^(out\s+of\s+[\d.]+|[\d.]+\s+out\s+of)/i.test(l);

  const isQuestionHeader = l => /^Question\s+\d+\s*$/i.test(l);
  const isOption = l => /^[a-e][.)]\s+\S/.test(l);
  const isCorrectAnswerLine = l => /^The\s+correct\s+answer\s+is[:\s]/i.test(l) || /^Correct\s+answer[:\s]/i.test(l) || /^Jawaban\s+yang\s+benar[:\s]/i.test(l);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New question block
    if (isQuestionHeader(line)) {
      if (current && current.options.length >= 2) questions.push(current);
      const numMatch = line.match(/^Question\s+(\d+)/i);
      const actualNum = numMatch ? parseInt(numMatch[1], 10) : questions.length + 1;
      current = { num: actualNum, text: '', options: [], answer: '', _correctText: '' };
      skipMeta = true;
      continue;
    }

    if (!current) continue;

    // Skip metadata lines
    if (isMetaLine(line)) { skipMeta = false; continue; }

    // Correct answer declaration
    if (isCorrectAnswerLine(line)) {
      const ansText = line.replace(/^(The\s+correct\s+answer\s+is[:\s]|Correct\s+answer[:\s]|Jawaban\s+yang\s+benar[:\s])/i, '').trim();
      current._correctText = ansText.toLowerCase();
      continue;
    }

    // Option line: a. b. c. d. e.
    if (isOption(line)) {
      const m = line.match(/^([a-e])[.)]\s+(.+)/i);
      if (m) {
        current.options.push({ key: m[1].toUpperCase(), text: m[2] });
      }
      continue;
    }

    // Option continuation
    if (current.options.length > 0) {
      current.options[current.options.length-1].text += ' ' + line;
      continue;
    }

    // Question text (non-empty, non-meta lines before options)
    if (!skipMeta && line.length > 3) {
      current.text += (current.text ? ' ' : '') + line;
    }
  }
  if (current && current.options.length >= 2) questions.push(current);

  // Match correct answer text to option key and strip markers
  for (const q of questions) {
    q.text = stripMarkers(q.text);
    if (q._correctText) {
      for (const opt of q.options) {
        if (normalizeForCompare(opt.text).includes(normalizeForCompare(q._correctText)) || 
            normalizeForCompare(q._correctText).includes(normalizeForCompare(opt.text))) {
          q.answer = opt.key;
          break;
        }
      }
    }
    for (const opt of q.options) {
      if (hasCorrectMarker(opt.text) && !q.answer) {
        q.answer = opt.key;
      }
      opt.text = stripMarkers(opt.text);
    }
    delete q._correctText;
  }

  return questions.filter(q => q.text.length > 5 && q.options.length >= 2);
}

// ── EDITOR & VALIDATION ──
function updatePreview() {
  if (typeof parserHelpers.validateParsedQuiz === 'function') {
    const validationResult = parserHelpers.validateParsedQuiz(parsedQuestions);
    parsedQuestions = validationResult.questions;
    buildQuizPreview(validationResult.stats);
  } else {
    buildQuizPreview(null);
  }
}

function buildQuizPreview(stats) {
  document.getElementById('metaBox').style.display = 'block';
  document.getElementById('quizPreview').style.display = 'block';
  
  if (stats) {
    document.getElementById('parseSummary').innerHTML = `
      <div><span style="color:var(--text2)">Total Soal:</span> <strong style="font-size:1.1rem">${stats.total}</strong></div>
      <div><span style="color:var(--text2)">Valid:</span> <strong style="color:var(--success);font-size:1.1rem">${stats.valid}</strong></div>
      <div><span style="color:var(--text2)">Warning:</span> <strong style="color:var(--warning);font-size:1.1rem">${stats.warning}</strong></div>
      <div><span style="color:var(--text2)">Error:</span> <strong style="color:var(--danger);font-size:1.1rem">${stats.error}</strong></div>
      ${stats.missingNums.length ? `<div style="color:var(--danger)"><strong>Nomor Loncat/Hilang:</strong> ${stats.missingNums.join(', ')}</div>` : ''}
      ${stats.duplicateNums.length ? `<div style="color:var(--danger)"><strong>Nomor Duplikat:</strong> ${stats.duplicateNums.join(', ')}</div>` : ''}
      <div style="margin-left:auto;"><span style="color:var(--text2)">Kualitas Parsing:</span> <strong style="font-size:1.2rem;color:${stats.qualityScore >= 80 ? 'var(--success)' : 'var(--warning)'}">${stats.qualityScore}%</strong></div>
    `;
    
    const btnPublish = document.getElementById('btnPublish');
    if (stats.error > 0) {
      btnPublish.disabled = true;
      btnPublish.title = "Selesaikan semua error sebelum publish.";
    } else {
      btnPublish.disabled = false;
      btnPublish.title = "";
    }
  }

  const list = document.getElementById('questionsList');
  list.innerHTML = parsedQuestions.map((q, qi) => {
    let statusColor = 'var(--border)';
    if (q.status === 'error') statusColor = 'var(--danger)';
    if (q.status === 'warning') statusColor = 'var(--warning)';
    if (q.status === 'valid') statusColor = 'var(--success)';
    
    return `
    <div class="question-editor" id="qe-${qi}" style="border-left: 4px solid ${statusColor}; border-radius: 8px;">
      <div class="q-header">
        <div class="q-num" style="background:${statusColor};color:${q.status==='warning'?'#000':'#fff'}">${q.num}</div>
        <div style="flex:1;">
          <input class="form-input" value="${esc(q.text)}" oninput="parsedQuestions[${qi}].text=this.value" placeholder="Teks pertanyaan"/>
        </div>
        <select class="answer-select" onchange="parsedQuestions[${qi}].answer=this.value; updatePreview();" title="Jawaban benar">
          <option value="">Kunci?</option>
          ${['A','B','C','D','E'].map(k=>`<option value="${k}" ${q.answer===k?'selected':''}>${k}</option>`).join('')}
        </select>
        <button class="q-del-btn" onclick="deleteQuestion(${qi})">🗑️</button>
      </div>
      <div class="q-body">
        ${q.warnings && q.warnings.length ? `<div style="background:rgba(245,158,11,0.1);color:var(--warning);padding:0.5rem;border-radius:6px;font-size:0.8rem;margin-bottom:0.8rem;">⚠️ ${q.warnings.join('<br>')}</div>` : ''}
        ${q.errors && q.errors.length ? `<div style="background:rgba(239,68,68,0.1);color:var(--danger);padding:0.5rem;border-radius:6px;font-size:0.8rem;margin-bottom:0.8rem;">❌ ${q.errors.join('<br>')}</div>` : ''}
        ${q.image ? `
          <div style="margin-bottom:0.8rem;position:relative;display:inline-block;">
            <div style="font-size:0.75rem;color:var(--primary);margin-bottom:0.4rem;">🖼️ Gambar terlampir</div>
            <img src="${q.image}" style="max-width:100%;border-radius:8px;border:1px solid var(--border);max-height:300px;object-fit:contain;display:block;" />
            <div style="position:absolute;top:32px;right:4px;display:flex;gap:0.3rem;">
              <button onclick="openCropModal(${qi})" style="background:rgba(92,156,252,0.9);border:none;color:#fff;border-radius:6px;padding:0.3rem 0.6rem;cursor:pointer;font-size:0.75rem;backdrop-filter:blur(4px);">✂️ Crop</button>
              <button onclick="removeImage(${qi})" style="background:rgba(239,68,68,0.9);border:none;color:#fff;border-radius:6px;padding:0.3rem 0.6rem;cursor:pointer;font-size:0.75rem;backdrop-filter:blur(4px);">✕ Hapus</button>
            </div>
          </div>
        ` : `
          <div style="margin-bottom:0.8rem;">
            <label style="font-size:0.75rem;color:var(--text3);cursor:pointer;display:inline-flex;align-items:center;gap:0.4rem;border:1px dashed var(--border);padding:0.4rem 0.8rem;border-radius:8px;">
              🖼️ Upload gambar (opsional)
              <input type="file" accept="image/*" style="display:none;" onchange="attachImage(${qi}, this)"/>
            </label>
          </div>
        `}
        <div class="options-grid">
          ${q.options.map((o,oi)=>`
            <div class="option-item ${o.key===q.answer?'correct':''}">
              <span class="option-label">${o.key}</span>
              <input class="form-input" style="border:none;background:transparent;padding:0;font-size:0.85rem;" value="${esc(o.text)}" oninput="parsedQuestions[${qi}].options[${oi}].text=this.value"/>
            </div>
          `).join('')}
        </div>
        ${q.options.length < 5 ? `<button class="btn btn-outline" style="font-size:0.8rem;margin-top:0.8rem;padding:0.4rem 0.8rem;" onclick="addOption(${qi})">+ Opsi</button>` : ''}
      </div>
    </div>
    `;
  }).join('');
}

function attachImage(qi, input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    parsedQuestions[qi].image = e.target.result;
    updatePreview();
  };
  reader.readAsDataURL(file);
}

function removeImage(qi) {
  delete parsedQuestions[qi].image;
  updatePreview();
}

// ── CROPPER LOGIC ──
let cropperInstance = null;
let currentCropIndex = -1;

function openCropModal(qi) {
  currentCropIndex = qi;
  const imgData = parsedQuestions[qi].image;
  const target = document.getElementById('cropImageTarget');
  target.src = imgData;
  document.getElementById('cropModal').style.display = 'flex';
  
  if (cropperInstance) cropperInstance.destroy();
  
  setTimeout(() => {
    cropperInstance = new Cropper(target, {
      viewMode: 1,
      background: false,
      autoCropArea: 0.9,
      dragMode: 'crop',
    });
  }, 50);
}

function closeCropModal() {
  document.getElementById('cropModal').style.display = 'none';
  if (cropperInstance) cropperInstance.destroy();
  cropperInstance = null;
}

function applyCrop() {
  if (!cropperInstance) return;
  const canvas = cropperInstance.getCroppedCanvas();
  if (canvas) {
    parsedQuestions[currentCropIndex].image = canvas.toDataURL('image/jpeg', 0.9);
    updatePreview();
  }
  closeCropModal();
}


function esc(s) { return (s||'').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

function addOption(qi) {
  const opts = parsedQuestions[qi].options;
  const keys = ['A','B','C','D','E'];
  const nextKey = keys[opts.length] || 'E';
  opts.push({ key: nextKey, text: '' });
  updatePreview();
}

function deleteQuestion(qi) {
  parsedQuestions.splice(qi, 1);
  updatePreview();
}

function addQuestion() {
  parsedQuestions.push({
    num: parsedQuestions.length + 1,
    text: 'Pertanyaan baru',
    options: [
      {key:'A', text:'Opsi A'},
      {key:'B', text:'Opsi B'},
      {key:'C', text:'Opsi C'},
      {key:'D', text:'Opsi D'}
    ],
    answer: 'A'
  });
  updatePreview();
}

function cancelPreview() {
  parsedQuestions = [];
  document.getElementById('metaBox').style.display = 'none';
  document.getElementById('quizPreview').style.display = 'none';
  document.getElementById('parseLog').style.display = 'none';
  document.getElementById('fileInput').value = '';
  document.getElementById('keyInput').value = '';
}

// ── SAVE TO SUPABASE ──
function saveQuizDraft() {
  const title = document.getElementById('quizTitle').value.trim();
  saveQuizData('[DRAFT] ' + (title || 'Paket Soal Baru'), document.getElementById('btnDraft'));
}

function publishQuiz() {
  saveQuizData(document.getElementById('quizTitle').value.trim(), document.getElementById('btnPublish'));
}

async function saveQuizData(finalTitle, btn) {
  if (!parsedQuestions.length) { showToast('Tidak ada soal untuk disimpan!','error'); return; }
  if (!finalTitle || finalTitle === '[DRAFT] ') { showToast('Isi judul paket soal!','error'); return; }

  const subject = document.getElementById('quizSubject').value.trim();
  
  const originalText = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '⏳ Menyimpan...';

  try {
    await adminApiFetch('/api/admin/save-quiz', {
      method: 'POST',
      body: {
        title: finalTitle,
        subject: subject || 'Umum',
        description: document.getElementById('quizDesc').value.trim(),
        duration: parseInt(document.getElementById('quizDuration').value) || 60,
        questions: parsedQuestions
      }
    });

    showToast('✅ Berhasil disimpan ke Supabase!','success');
    btn.innerHTML = '✅ Tersimpan!';
    setTimeout(()=>{ btn.disabled=false; btn.innerHTML=originalText; cancelPreview(); },2500);
  } catch(e) {
    showToast('❌ Gagal: ' + e.message, 'error');
    btn.disabled=false; btn.innerHTML=originalText;
  }
}

// ── MANAGE TAB ──
async function loadManage() {
  const el = document.getElementById('manageList');
  try {
    const payload = await adminApiFetch('/api/admin/quizzes');
    const data = payload.quizzes || [];
    if (!data.length) { el.innerHTML='<div class="empty-state"><div class="empty-icon">💭</div><p>Belum ada paket soal.</p></div>'; return; }
    el.innerHTML = data.map(q => `
      <div class="quiz-list-row" style="${q.is_hidden ? 'opacity: 0.6;' : ''}">
        <div class="name">
          ${q.is_hidden ? '🔒 [HIDDEN] ' : ''}${escapeHTML(q.title)}
        </div>
        <div class="meta">${escapeHTML(q.subject)} • ${q.count} soal${q.is_draft ? ' • Draft' : ''}</div>
        
        <button class="btn btn-outline" style="font-size:0.8rem;padding:0.3rem 0.8rem;" onclick="editQuizInfo('${q.id}', '${escapeHTML(q.title).replace(/'/g, "\\\\'")}', '${escapeHTML(q.subject).replace(/'/g, "\\\\'")}')">✏️ Edit</button>
        <button class="btn btn-outline" style="font-size:0.8rem;padding:0.3rem 0.8rem;" onclick="toggleQuizVisibility('${q.id}', ${!!q.is_hidden})">${q.is_hidden ? '👁️ Tampilkan' : '🙈 Sembunyikan'}</button>
        <a href="/quiz?id=${q.id}" class="btn btn-outline" style="font-size:0.8rem;padding:0.3rem 0.8rem;">Preview</a>
        <button class="del-quiz-btn" onclick="deleteQuiz('${q.id}')">🗑️ Hapus</button>
      </div>
    `).join('');
  } catch(e) { el.innerHTML='<p style="color:var(--danger);padding:1rem;">Gagal memuat: '+e.message+'</p>'; }
}

async function editQuizInfo(id, oldTitle, oldSubject) {
  const newTitle = prompt('Ubah Judul Paket Soal:', oldTitle);
  if (newTitle === null) return;
  const newSubject = prompt('Ubah Mata Pelajaran:', oldSubject);
  if (newSubject === null) return;
  
  if (newTitle.trim() === '' || newSubject.trim() === '') {
    return alert('Judul dan Mata Pelajaran tidak boleh kosong.');
  }

  try {
    await adminApiFetch('/api/admin/quizzes', { 
      method: 'PATCH',
      body: { id, title: newTitle.trim(), subject: newSubject.trim() }
    });
    showToast('Info paket soal berhasil diubah','success');
    loadManage();
  } catch(e) {
    console.error('editQuiz error:', e);
    alert('Gagal mengubah info: ' + e.message);
  }
}

async function toggleQuizVisibility(id, currentlyHidden) {
  const newHiddenStatus = !currentlyHidden;
  const actionText = newHiddenStatus ? 'Sembunyikan' : 'Tampilkan';
  if (!confirm(`Yakin ingin ${actionText} paket soal ini dari murid?`)) return;

  try {
    await adminApiFetch('/api/admin/quizzes', { 
      method: 'PATCH',
      body: { id, is_hidden: newHiddenStatus }
    });
    showToast(`Paket soal berhasil di-${actionText}`,'success');
    loadManage();
  } catch(e) {
    console.error('toggle visibility error:', e);
    alert('Gagal mengubah visibilitas: ' + e.message);
  }
}

async function deleteQuiz(id) {
  if (!confirm('Hapus paket soal ini? Tindakan ini tidak bisa dibatalkan.')) return;

  try {
    await adminApiFetch(`/api/admin/quizzes?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast('Paket soal dihapus','success');
    loadManage();
  } catch(e) {
    console.error('deleteQuiz error:', e);
    alert('Gagal hapus: ' + e.message);
  }
}

// ── RESULTS TAB ──
async function loadResults() {
  const el = document.getElementById('resultsList');
  try {
    const payload = await adminApiFetch('/api/admin/results');
    const results = payload.results || [];
    if (!results || !results.length) { el.innerHTML='<div class="empty-state"><div class="empty-icon">📊</div><p>Belum ada hasil ujian.</p></div>'; return; }

    el.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
        <thead><tr style="border-bottom:1px solid var(--border);color:var(--text2);">
          <th style="padding:0.8rem;text-align:left;">Nama</th>
          <th style="padding:0.8rem;text-align:left;">Paket Soal</th>
          <th style="padding:0.8rem;text-align:center;">Nilai</th>
          <th style="padding:0.8rem;text-align:center;">Benar</th>
          <th style="padding:0.8rem;text-align:right;">Waktu</th>
          <th style="padding:0.8rem;text-align:center;">Aksi</th>
        </tr></thead>
        <tbody>${results.map(r => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:0.8rem;font-weight:600;">${escapeHTML(r.full_name || r.email || 'Anonim')}</td>
            <td style="padding:0.8rem;color:var(--text2);">${escapeHTML(r.quiz_title||'-')}</td>
            <td style="padding:0.8rem;text-align:center;"><span style="background:rgba(79,142,247,0.1);color:var(--primary);padding:0.2rem 0.6rem;border-radius:50px;font-weight:700;">${r.score}%</span></td>
            <td style="padding:0.8rem;text-align:center;">${r.correct}/${r.total}</td>
            <td style="padding:0.8rem;text-align:right;color:var(--text3);">${new Date(r.submitted_at).toLocaleString('id-ID')}</td>
            <td style="padding:0.8rem;text-align:center;">
              <button class="del-quiz-btn" onclick="deleteResult('${r.id}')">🗑️</button>
            </td>
          </tr>
        `).join('')}</tbody>
      </table>`;
  } catch(e) { el.innerHTML='<p style="color:var(--danger);padding:1rem;">'+e.message+'</p>'; }
}

async function deleteResult(id) {
  if (!confirm('Hapus hasil ujian ini?')) return;
  
  try {
    await adminApiFetch(`/api/admin/results?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast('Hasil ujian dihapus','success');
    loadResults();
  } catch(e) {
    console.error('deleteResult error:', e);
    alert('Error: ' + e.message);
  }
}

// ── TABS ──
function switchTab(name, el) {
  document.querySelectorAll('.sidebar-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-'+name).classList.add('active');
  if (name==='manage') loadManage();
  if (name==='results') loadResults();
  if (name==='bug-reports') loadBugReports();
  if (name==='ugc') loadUGC();
  if (name==='analytics') loadAnalytics();
  if (name==='insight') loadInsight();
}

async function loadUGC() {
  const el = document.getElementById('ugcList');
  el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text3);">Memuat...</div>';
  try {
    const payload = await adminApiFetch('/api/admin/ugc-submissions');
    const quizzes = payload.quizzes || [];
    if (!quizzes.length) {
      el.innerHTML = '<div class="empty-state"><p>Tidak ada pengajuan kuis baru.</p></div>';
      return;
    }
    el.innerHTML = quizzes.map(q => `
      <div class="quiz-list-row">
        <div class="name">${escapeHTML(q.title)} <span style="font-size:0.8rem; color:var(--text2); font-weight:normal;">(${q.count} soal)</span>
        <br><span style="font-size:0.8rem; color:var(--primary);">Oleh: ${escapeHTML(q.profiles?.full_name || 'Anonim')}</span></div>
        <div style="display:flex;gap:0.5rem;">
          <button class="btn btn-primary" onclick="approveUGC('${q.id}')">Setujui</button>
          <button class="btn btn-outline" onclick="rejectUGC('${q.id}')">Tolak</button>
        </div>
      </div>
    `).join('');
  } catch(e) { el.innerHTML = `<p style="color:red">Error: ${e.message}</p>`; }
}

async function approveUGC(id) {
  if (!confirm('Setujui kuis ini? (Akan menjadi publik)')) return;
  try {
    await adminApiFetch('/api/admin/approve-quiz', 'POST', { quiz_id: id });
    alert('Disetujui!');
    loadUGC();
  } catch(e) { alert(e.message); }
}

async function rejectUGC(id) {
  const reason = prompt('Alasan penolakan?');
  if (reason === null) return;
  try {
    await adminApiFetch('/api/admin/reject-quiz', 'POST', { quiz_id: id, reason });
    alert('Ditolak!');
    loadUGC();
  } catch(e) { alert(e.message); }
}

async function loadAnalytics() {
  try {
    const payload = await adminApiFetch('/api/admin/parser-analytics');
    const m = payload.metrics;
    if (!m) return;
    document.getElementById('an_total').textContent = m.total_processed || 0;
    document.getElementById('an_success').textContent = m.total_success || 0;
    document.getElementById('an_avg').textContent = m.avg_questions || 0;
    document.getElementById('an_fail').textContent = m.total_failed || 0;

    const errHtml = (m.top_errors || []).map(e => `<div>• ${escapeHTML(e[0])}: <strong>${e[1]}</strong> kali</div>`).join('') || 'Belum ada error.';
    document.getElementById('an_errors').innerHTML = errHtml;

    const fbHtml = (m.top_feedback || []).map(f => `<div>• ${escapeHTML(f[0])}: <strong>${f[1]}</strong> kali</div>`).join('') || 'Belum ada feedback.';
    document.getElementById('an_feedback').innerHTML = fbHtml;
  } catch(e) {
    console.error(e);
  }
}

async function loadBugReports() {
  const el = document.getElementById('bugReportsList');
  if (!el) return;

  try {
    const payload = await adminApiFetch('/api/admin/bug-reports');
    const reports = payload.reports || [];

    if (!reports.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">🐞</div><p>Belum ada laporan bug.</p></div>';
      return;
    }

    el.innerHTML = reports.map((report) => `
      <div style="border:1px solid var(--border);border-radius:14px;padding:1rem 1rem 0.9rem;background:rgba(255,255,255,0.02);margin-bottom:1rem;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;margin-bottom:0.8rem;">
          <div>
            <div style="font-weight:700;font-size:1rem;">${escapeHTML(report.reporter_name || report.reporter_email || 'User')}</div>
            <div style="font-size:0.85rem;color:var(--text2);">${escapeHTML(report.reporter_email || '-')}</div>
          </div>
          <div style="text-align:right;font-size:0.8rem;color:var(--text2);">
            <div>${new Date(report.created_at).toLocaleString('id-ID')}</div>
            <div>${escapeHTML(report.quiz_title || report.quiz_id || 'Quiz tidak diketahui')}</div>
            <div>Soal ${escapeHTML(String(report.question_num || '-'))}</div>
          </div>
        </div>
        <div style="white-space:pre-wrap;line-height:1.65;margin-bottom:0.85rem;">${escapeHTML(report.message || '')}</div>
        ${report.page_url ? `<div style="font-size:0.8rem;color:var(--text2);margin-bottom:0.8rem;word-break:break-all;"><strong>URL:</strong> ${escapeHTML(report.page_url)}</div>` : ''}
        ${report.screenshot_data_url ? `<img src="${report.screenshot_data_url}" alt="Screenshot laporan bug" style="max-width:100%;max-height:360px;display:block;border:1px solid var(--border);border-radius:12px;margin-bottom:0.9rem;" />` : ''}
        <div style="display:flex;justify-content:flex-end;">
          <button class="del-quiz-btn" onclick="deleteBugReport('${report.id}')">Hapus</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = `<p style="color:var(--danger);padding:1rem;">${escapeHTML(e.message)}</p>`;
  }
}

async function deleteBugReport(id) {
  if (!confirm('Hapus laporan bug ini?')) return;

  try {
    await adminApiFetch(`/api/admin/bug-reports?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast('Laporan bug dihapus','success');
    loadBugReports();
  } catch(e) {
    alert('Gagal hapus laporan bug: ' + e.message);
  }
}

// ── LOG & TOAST ──
function log(msg) {
  const el = document.getElementById('parseLog');
  el.innerHTML += `<p>→ ${msg}</p>`;
  el.scrollTop = el.scrollHeight;
}

function showToast(msg, type='') {
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),3000);
}

// --- Auto-exports to window ---
window.saveConfig = saveConfig;
window.getQuestionQualityScore = getQuestionQualityScore;
window.adminLogout = adminLogout;
window.initAdminAuth = initAdminAuth;
window.closeCropModal = closeCropModal;
window.showToast = showToast;
window.deleteResult = deleteResult;
window.approveUGC = approveUGC;
window.rejectUGC = rejectUGC;
window.esc = esc;
window.toggleQuizVisibility = toggleQuizVisibility;
window.openCropModal = openCropModal;
window.addOption = addOption;
window.initAdmin = initAdmin;
window.handleFile = handleFile;
window.parseStandardFormat = parseStandardFormat;
window.editQuizInfo = editQuizInfo;
window.log = log;
window.parseWithGemini = parseWithGemini;
window.loadAnalytics = loadAnalytics;
window.attachCroppedImages = attachCroppedImages;
window.parseQuestions = parseQuestions;
window.mergeQuestionsByNumber = mergeQuestionsByNumber;
window.saveQuizData = saveQuizData;
window.loadResults = loadResults;
window.applyCrop = applyCrop;
window.approveUGC = approveUGC;
window.publishQuiz = publishQuiz;
window.initAdminAuthSafe = initAdminAuthSafe;
window.shouldMergeQuestionPair = shouldMergeQuestionPair;
window.formatGeminiError = formatGeminiError;
window.saveQuizDraft = saveQuizDraft;
window.attachImage = attachImage;
window.deleteQuiz = deleteQuiz;
window.switchTab = switchTab;
window.parseLMSFormat = parseLMSFormat;
window.addQuestion = addQuestion;
window.getConfig = getConfig;
window.parseWithRegex = parseWithRegex;
window.adminApiFetch = adminApiFetch;
window.deleteBugReport = deleteBugReport;
window.getAdminAccessToken = getAdminAccessToken;
window.cleanPdfText = cleanPdfText;
window.cancelPreview = cancelPreview;
window.loadBugReports = loadBugReports;
window.updatePreview = updatePreview;
window.compressForGemini = compressForGemini;
window.buildQuizPreview = buildQuizPreview;
window.mergeQuestionPair = mergeQuestionPair;
window.loadUGC = loadUGC;
window.removeImage = removeImage;
window.deleteQuestion = deleteQuestion;
window.loadManage = loadManage;

// ── STUDYFORGE INSIGHT ──
async function loadInsight() {
  const list = document.getElementById('insightList');
  list.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text3);">Memuat insight...</td></tr>';
  
  try {
    const data = await adminApiFetch('/api/admin/insight-questions');
    const summary = data.summary || {};
    
    document.getElementById('ins_total').textContent = summary.total_questions || 0;
    document.getElementById('ins_prob').textContent = summary.problematic || 0;
    document.getElementById('ins_hard').textContent = summary.hard || 0;
    document.getElementById('ins_med').textContent = summary.medium || 0;
    document.getElementById('ins_easy').textContent = summary.easy || 0;

    const items = data.items || [];
    if (!items.length) {
      list.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text3);">Belum ada data insight yang cukup.</td></tr>';
      return;
    }

    let html = '';
    for (const q of items) {
      let statusHtml = '';
      if (q.status === 'Bermasalah') statusHtml = `<span style="color:var(--danger);font-weight:600;">⚠️ Bermasalah</span>`;
      else if (q.status === 'Sulit') statusHtml = `<span style="color:var(--warning);">Sulit</span>`;
      else if (q.status === 'Sedang') statusHtml = `<span style="color:var(--text);">Sedang</span>`;
      else if (q.status === 'Mudah') statusHtml = `<span style="color:var(--success);">Mudah</span>`;
      else statusHtml = `<span style="color:var(--text3);">Data Kurang</span>`;
      
      const rateStr = q.status === 'Data Kurang' ? '-' : Math.round(q.correct_rate * 100) + '%';
      
      html += `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
          <td style="padding:0.8rem;">${escapeHTML(q.quiz_title)}<br><small style="color:var(--text3);">${escapeHTML(q.quiz_id)}</small></td>
          <td style="padding:0.8rem;">${escapeHTML(q.subject || '-')}</td>
          <td style="padding:0.8rem;"><strong>${q.question_num}</strong></td>
          <td style="padding:0.8rem;">${q.total_attempts}x</td>
          <td style="padding:0.8rem;">${rateStr}</td>
          <td style="padding:0.8rem;">${statusHtml}</td>
        </tr>
      `;
    }
    list.innerHTML = html;
  } catch (err) {
    list.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--danger);">Gagal memuat insight: ${escapeHTML(err.message)}</td></tr>`;
  }
}
window.loadInsight = loadInsight;
