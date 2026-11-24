// PDF scanning, regex + Gemini Vision parsing, and automatic question image cropping.
import { adminState, adminApiFetch, getAdminConfig, adminLog } from './admin-state.js';

function isFontBold(page, styles, fontName) {
  if (!fontName) return false;
  const styleFamily = String(styles?.[fontName]?.fontFamily || '');
  if (/bold|black|heavy/i.test(styleFamily)) return true;
  try {
    if (page.commonObjs?.has(fontName)) {
      const fontObj = page.commonObjs.get(fontName);
      if (/bold|black|heavy/i.test(String(fontObj?.name || ''))) return true;
    }
  } catch (err) {
    console.warn('Font metadata lookup failed:', { fontName, message: err?.message });
  }
  return false;
}

function joinBucketItems(items) {
  items.sort((a, b) => a.x - b.x);
  let lineText = '';
  for (let i = 0; i < items.length; i++) {
    const curr = items[i];
    if (i === 0) {
      lineText = curr.str;
      continue;
    }
    const prev = items[i - 1];
    // Fix PDF kerning split on leading question numbers (e.g. "3" + "7." -> "37.")
    const isSplitQuestionNum =
      i === 1 &&
      /^\d+$/.test(prev.str) &&
      /^\d+[.)]?$/.test(curr.str) &&
      curr.x - prev.x < 25;
    lineText += isSplitQuestionNum ? curr.str : ` ${curr.str}`;
  }
  return lineText.trim();
}

function isBoldOptionLine(lineText, items) {
  if (!/^[([]?[A-E]\s*[.)\]]\s+\S/i.test(lineText)) return false;
  let boldChars = 0;
  let totalChars = 0;
  for (const item of items) {
    const len = item.str.replaceAll(/\s+/g, '').length;
    totalChars += len;
    if (item.isBold) boldChars += len;
  }
  return totalChars > 0 && boldChars / totalChars >= 0.6;
}

function clusterPageLines(items) {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const buckets = [];

  for (const it of sorted) {
    const bucket = buckets.find((b) => Math.abs(b.y - it.y) <= 2.5);
    if (bucket) {
      bucket.items.push(it);
      bucket.y = bucket.items.reduce((sum, item) => sum + item.y, 0) / bucket.items.length;
    } else {
      buckets.push({ y: it.y, items: [it] });
    }
  }

  buckets.sort((a, b) => b.y - a.y);
  return buckets
    .map((b) => {
      const lineText = joinBucketItems(b.items);
      if (!lineText) return '';
      return isBoldOptionLine(lineText, b.items) ? `${lineText} ✓` : lineText;
    })
    .filter(Boolean);
}

function hasEmbeddedImages(opList) {
  return opList.fnArray.some((fn) =>
    fn === pdfjsLib.OPS.paintImageXObject ||
    fn === pdfjsLib.OPS.paintJpegXObject ||
    fn === pdfjsLib.OPS.paintInlineImageXObject ||
    fn === pdfjsLib.OPS.paintImageMaskXObject
  );
}

function findQuestionPage(q, qToPage) {
  if (q.imgPage) return q.imgPage;
  if (qToPage[q.num]) return qToPage[q.num];
  const qNumRegex = new RegExp(`^${q.num}[.)]`);
  return Object.keys(adminState.pageTextItems).find((p) =>
    adminState.pageTextItems[p].some((it) => qNumRegex.test(it.str))
  );
}

function findQuestionMarker(q, items) {
  const qNumRegex = new RegExp(`^${q.num}[.)]`);
  const exact = items.find((it) => qNumRegex.test(it.str) || it.str === String(q.num));
  if (exact || !q.text) return exact;
  const snippet = q.text.substring(0, 15);
  return items.find((it) => it.str.includes(snippet));
}

function findCropBottomY(q, qY, items) {
  const optionYs = (q.options || [])
    .map((opt) => {
      const optRegex = new RegExp(`^[${opt.key}][.)]`, 'i');
      const snippet = opt.text.length > 3 ? opt.text.substring(0, Math.min(8, opt.text.length)) : '';
      const matches = items.filter(
        (it) => it.y < qY + 10 && (optRegex.test(it.str) || (snippet && it.str.includes(snippet)))
      );
      return matches.length ? Math.max(...matches.map((m) => m.y)) : null;
    })
    .filter((y) => y !== null);

  if (optionYs.length > 0) return Math.max(...optionYs);

  const nextRegex = new RegExp(`^${q.num + 1}[.)]`);
  const nextQs = items.filter((it) => it.y < qY - 10 && nextRegex.test(it.str));
  return nextQs.length ? Math.max(...nextQs.map((m) => m.y)) : Math.max(0, qY - 300);
}

export function attachCroppedImages(questions, pageQuestionMap) {
  const qToPage = {};
  for (const [pg, nums] of Object.entries(pageQuestionMap)) {
    for (const n of nums) qToPage[n] = Number.parseInt(pg, 10);
  }

  for (const q of questions) {
    if (!q.hasImage) continue;

    const pg = findQuestionPage(q, qToPage);
    const canvasEl = adminState.pageCanvasEls[pg];
    const items = adminState.pageTextItems[pg];
    const viewport = adminState.pageViewports[pg];
    if (!pg || !canvasEl || !items || !viewport) continue;

    const qMarker = findQuestionMarker(q, items);
    if (!qMarker) continue;

    const scale = viewport.scale;
    const pageH = viewport.viewBox[3];
    const bottomY = findCropBottomY(q, qMarker.y, items);

    const cropTop = Math.round(Math.max(0, (pageH - qMarker.y) * scale - 15));
    let cropBottom = Math.round(Math.min(canvasEl.height, (pageH - bottomY) * scale + 15));
    if (cropBottom - cropTop < 100) {
      cropBottom = Math.min(canvasEl.height, cropTop + 250);
    }

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = canvasEl.width;
    cropCanvas.height = cropBottom - cropTop;
    cropCanvas.getContext('2d').drawImage(canvasEl, 0, -cropTop);
    q.image = cropCanvas.toDataURL('image/jpeg', 0.88);
  }
}

async function generateAutoDescription(questions, geminiKey) {
  if (!questions.length) return;
  const descInput = document.getElementById('quizDesc');
  descInput.placeholder = '✨ AI sedang membuat deskripsi...';
  const contextText = questions.slice(0, 5).map((q) => q.text).join('\n');

  try {
    if (geminiKey) {
      const desc = await generateQuizDescription(contextText, geminiKey);
      if (desc && !descInput.value) descInput.value = desc;
    } else {
      const res = await adminApiFetch('/api/admin/generate-description', {
        method: 'POST',
        body: { text: contextText }
      });
      if (res.description && !descInput.value) {
        descInput.value = res.description.replaceAll(/^["']|["']$/g, '').trim();
        showToast('Deskripsi berhasil di-generate dengan Cloudflare AI', 'success');
      }
    }
  } catch (e) {
    console.error('Gagal generate deskripsi:', e);
    if (!geminiKey) {
      showToast('Gagal memuat deskripsi AI (Mungkin binding AI mati di lokal)', 'error');
    }
  } finally {
    descInput.placeholder = 'Deskripsi singkat paket soal';
  }
}

async function scanSinglePage(pdf, pageNum) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1.8 });
  adminState.pageViewports[pageNum] = viewport;

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  adminState.pageCanvasEls[pageNum] = canvas;
  adminState.pageImages[pageNum] = canvas.toDataURL('image/jpeg', 0.80);

  const content = await page.getTextContent();
  adminState.pageTextItems[pageNum] = content.items
    .filter((it) => it.str.trim())
    .map((it) => ({
      str: it.str.trim(),
      x: it.transform[4],
      y: it.transform[5],
      isBold: isFontBold(page, content.styles, it.fontName)
    }));

  const pageText = `${clusterPageLines(adminState.pageTextItems[pageNum]).join('\n')}\n\n`;
  const opList = await page.getOperatorList();
  return { pageNum, pageText, hasImage: hasEmbeddedImages(opList) };
}

async function runGeminiStage(imagePages, textOnlyPages, regexQuestions, geminiKey) {
  if (imagePages.length > 0) {
    if (!geminiKey) {
      adminLog(`⚠️ ${imagePages.length} halaman punya gambar — isi Gemini API Key untuk deteksi gambar otomatis.`);
      return [];
    }
    adminLog(`🤖 Gemini memproses ${imagePages.length} halaman bergambar...`);
    const imagePageMap = {};
    imagePages.forEach((pg) => {
      imagePageMap[pg] = adminState.pageImages[pg];
    });
    try {
      const qs = await parseWithGemini(imagePageMap, geminiKey, { onLog: adminLog });
      adminLog(`✅ Gemini: ${qs.length} soal dari halaman bergambar`);
      return qs;
    } catch (e) {
      adminLog(`⚠️ Gemini gagal: ${e.message} (tetap menggunakan hasil regex lengkap)`);
      return [];
    }
  }

  if (regexQuestions.length === 0 && textOnlyPages.length > 0) {
    if (!geminiKey) {
      adminLog('⚠️ Regex tidak mendeteksi soal pada format PDF ini. Masukkan Gemini API Key di tab Konfigurasi untuk parsing otomatis.');
      return [];
    }
    adminLog('⚠️ Regex mendeteksi 0 soal dari teks. Mencoba analisis visual AI Gemini...');
    try {
      const qs = await parseWithGemini(adminState.pageImages, geminiKey, { onLog: adminLog });
      adminLog(`✅ Gemini Fallback: ${qs.length} soal berhasil diekstrak!`);
      return qs;
    } catch (e) {
      adminLog(`❌ Gemini Fallback gagal: ${e.message}`);
    }
  }
  return [];
}

async function applyAnswerKeyFile(keyFile) {
  if (!keyFile || typeof parseAnswerKey !== 'function') return;
  try {
    const answerMap = parseAnswerKey(await keyFile.text());
    adminLog(`🔑 Kunci jawaban diproses: ${Object.keys(answerMap).length} baris.`);
    for (const q of adminState.parsedQuestions) {
      if (answerMap[q.num]) q.answer = answerMap[q.num];
    }
  } catch (e) {
    adminLog(`⚠️ Gagal memproses file kunci: ${e.message}`);
  }
}

function buildPageQuestionMap(imagePages) {
  const pageQuestionMap = {};
  const qNumStartRegex = /^(\d+)[.)]/;
  for (const pg of imagePages) {
    for (const it of adminState.pageTextItems[pg] || []) {
      const m = qNumStartRegex.exec(it.str);
      if (m) {
        if (!pageQuestionMap[pg]) pageQuestionMap[pg] = [];
        pageQuestionMap[pg].push(Number.parseInt(m[1], 10));
      }
    }
  }
  return pageQuestionMap;
}

export async function handleFile(file, onQuestionsReady) {
  if (file?.type !== 'application/pdf') {
    showToast('Pilih file PDF!', 'error');
    return;
  }

  adminLog(`📂 File: ${file.name}`);
  adminLog('⏳ Memproses PDF...');
  document.getElementById('parseLog').style.display = 'block';
  adminState.pageImages = {};
  adminState.pageCanvasEls = {};
  adminState.pageTextItems = {};
  adminState.pageViewports = {};

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  adminLog(`📄 Total halaman: ${pdf.numPages}`);
  adminLog('🔍 Memindai halaman...');

  const pageNumbers = Array.from({ length: pdf.numPages }, (_, idx) => idx + 1);
  const scannedPages = await Promise.all(pageNumbers.map((num) => scanSinglePage(pdf, num)));

  const imagePages = [];
  const textOnlyPages = [];
  let allPagesFullText = '';

  for (const res of scannedPages) {
    allPagesFullText += res.pageText;
    if (res.hasImage) imagePages.push(res.pageNum);
    else textOnlyPages.push(res.pageNum);
  }

  adminLog(`📝 Halaman teks saja: ${textOnlyPages.join(', ') || '-'}`);
  adminLog(`🖼️ Halaman bergambar: ${imagePages.join(', ') || '-'}`);

  let regexQuestions = [];
  if (allPagesFullText.trim()) {
    adminLog('🔍 Parsing seluruh halaman dengan regex...');
    regexQuestions = parseQuestions(allPagesFullText);
    adminLog(`✅ Regex: ${regexQuestions.length} soal terdeteksi`);
  }

  const geminiKey = getAdminConfig()?.geminiKey;
  const geminiQuestions = await runGeminiStage(imagePages, textOnlyPages, regexQuestions, geminiKey);

  adminState.parsedQuestions = mergeQuestionsByNumber([...regexQuestions, ...geminiQuestions]);
  adminLog(`✅ Total: ${adminState.parsedQuestions.length} soal terdeteksi secara Regex & AI`);

  await applyAnswerKeyFile(document.getElementById('keyInput').files[0]);
  attachCroppedImages(adminState.parsedQuestions, buildPageQuestionMap(imagePages));

  document.getElementById('quizTitle').value = file.name.replace('.pdf', '');
  onQuestionsReady();
  void generateAutoDescription(adminState.parsedQuestions, geminiKey);
}
