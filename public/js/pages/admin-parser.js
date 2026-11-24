// PDF scanning, regex + Gemini Vision parsing, and automatic question image cropping.
import { adminState, adminApiFetch, getAdminConfig, adminLog } from './admin-state.js';

function isFontBold(page, styles, fontName) {
  if (!fontName) return false;
  const styleFamily = String(styles?.[fontName]?.fontFamily || '');
  if (/bold|black|heavy/i.test(styleFamily)) return true;
  try {
    if (page.commonObjs && page.commonObjs.has(fontName)) {
      const fontObj = page.commonObjs.get(fontName);
      if (/bold|black|heavy/i.test(String(fontObj?.name || ''))) return true;
    }
  } catch {
    // Ignore unresolved font objects
  }
  return false;
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
      b.items.sort((a, b2) => a.x - b2.x);
      let lineText = '';
      for (let i = 0; i < b.items.length; i++) {
        const curr = b.items[i];
        if (i === 0) {
          lineText = curr.str;
          continue;
        }
        const prev = b.items[i - 1];
        // Fix PDF kerning split on leading question numbers (e.g. "3" + "7." -> "37.")
        const isSplitQuestionNum =
          i === 1 &&
          /^\d+$/.test(prev.str) &&
          /^\d+[.)]?$/.test(curr.str) &&
          curr.x - prev.x < 25;
        lineText += isSplitQuestionNum ? curr.str : ` ${curr.str}`;
      }
      lineText = lineText.trim();
      if (!lineText) return '';

      // Detect bold-formatted multiple-choice option lines (e.g. "a. Correct answer")
      if (/^[([]?[A-Ea-e]\s*[.)\]]\s+\S/.test(lineText)) {
        let boldChars = 0;
        let totalChars = 0;
        for (const t of b.items) {
          const len = t.str.replace(/\s+/g, '').length;
          totalChars += len;
          if (t.isBold) boldChars += len;
        }
        if (totalChars > 0 && boldChars / totalChars >= 0.6) {
          return `${lineText} [✓]`;
        }
      }

      return lineText;
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

export function attachCroppedImages(questions, pageQuestionMap) {
  const qToPage = {};
  for (const [pg, nums] of Object.entries(pageQuestionMap)) {
    for (const n of nums) qToPage[n] = parseInt(pg, 10);
  }

  for (const q of questions) {
    if (!q.hasImage) continue;

    let pg = q.imgPage || qToPage[q.num];
    if (!pg) {
      pg = Object.keys(adminState.pageTextItems).find((p) =>
        adminState.pageTextItems[p].some((it) => it.str.match(new RegExp(`^${q.num}[.)]`)))
      );
    }
    const canvasEl = adminState.pageCanvasEls[pg];
    const items = adminState.pageTextItems[pg];
    const viewport = adminState.pageViewports[pg];
    if (!pg || !canvasEl || !items || !viewport) continue;

    const scale = viewport.scale;
    const pageH = viewport.viewBox[3];

    let qMarker = items.find(
      (it) => it.str.match(new RegExp(`^${q.num}[.)]`)) || it.str === String(q.num)
    );
    if (!qMarker && q.text) {
      const snippet = q.text.substring(0, 15);
      qMarker = items.find((it) => it.str.includes(snippet));
    }
    if (!qMarker) continue;

    const qY = qMarker.y;
    const optionYs = (q.options || [])
      .map((opt) => {
        const matches = items.filter(
          (it) =>
            it.y < qY + 10 &&
            (it.str.match(new RegExp(`^[${opt.key}][.)]`, 'i')) ||
              (opt.text.length > 3 && it.str.includes(opt.text.substring(0, Math.min(8, opt.text.length)))))
        );
        return matches.length ? Math.max(...matches.map((m) => m.y)) : null;
      })
      .filter((y) => y !== null);

    let bottomY;
    if (optionYs.length > 0) {
      bottomY = Math.max(...optionYs);
    } else {
      const nextQs = items.filter(
        (it) => it.y < qY - 10 && it.str.match(new RegExp(`^${q.num + 1}[.)]`))
      );
      bottomY = nextQs.length ? Math.max(...nextQs.map((m) => m.y)) : Math.max(0, qY - 300);
    }

    const cropTop = Math.round(Math.max(0, (pageH - qY) * scale - 15));
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
        descInput.value = res.description.replace(/^["']|["']$/g, '').trim();
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

export async function handleFile(file, onQuestionsReady) {
  if (!file || file.type !== 'application/pdf') {
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

  const imagePages = [];
  const textOnlyPages = [];
  let allPagesFullText = '';

  adminLog('🔍 Memindai halaman...');
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.8 });
    adminState.pageViewports[i] = viewport;

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    adminState.pageCanvasEls[i] = canvas;
    adminState.pageImages[i] = canvas.toDataURL('image/jpeg', 0.80);

    const content = await page.getTextContent();
    adminState.pageTextItems[i] = content.items
      .filter((it) => it.str.trim())
      .map((it) => ({
        str: it.str.trim(),
        x: it.transform[4],
        y: it.transform[5],
        isBold: isFontBold(page, content.styles, it.fontName)
      }));

    const pageText = `${clusterPageLines(adminState.pageTextItems[i]).join('\n')}\n\n`;
    allPagesFullText += pageText;

    const opList = await page.getOperatorList();
    if (hasEmbeddedImages(opList)) {
      imagePages.push(i);
    } else {
      textOnlyPages.push(i);
    }
  }

  adminLog(`📝 Halaman teks saja: ${textOnlyPages.join(', ') || '-'}`);
  adminLog(`🖼️ Halaman bergambar: ${imagePages.join(', ') || '-'}`);

  let regexQuestions = [];
  if (allPagesFullText.trim()) {
    adminLog('🔍 Parsing seluruh halaman dengan regex...');
    regexQuestions = parseQuestions(allPagesFullText);
    adminLog(`✅ Regex: ${regexQuestions.length} soal terdeteksi`);
  }

  let geminiQuestions = [];
  const cfg = getAdminConfig();
  const geminiKey = cfg?.geminiKey;

  if (imagePages.length > 0) {
    if (geminiKey) {
      adminLog(`🤖 Gemini memproses ${imagePages.length} halaman bergambar...`);
      const imagePageMap = {};
      imagePages.forEach((pg) => {
        imagePageMap[pg] = adminState.pageImages[pg];
      });
      try {
        geminiQuestions = await parseWithGemini(imagePageMap, geminiKey, { onLog: adminLog });
        adminLog(`✅ Gemini: ${geminiQuestions.length} soal dari halaman bergambar`);
      } catch (e) {
        adminLog(`⚠️ Gemini gagal: ${e.message} (tetap menggunakan hasil regex lengkap)`);
      }
    } else {
      adminLog(`⚠️ ${imagePages.length} halaman punya gambar — isi Gemini API Key untuk deteksi gambar otomatis.`);
    }
  } else if (regexQuestions.length === 0 && textOnlyPages.length > 0) {
    if (geminiKey) {
      adminLog('⚠️ Regex mendeteksi 0 soal dari teks. Mencoba analisis visual AI Gemini...');
      try {
        geminiQuestions = await parseWithGemini(adminState.pageImages, geminiKey, { onLog: adminLog });
        adminLog(`✅ Gemini Fallback: ${geminiQuestions.length} soal berhasil diekstrak!`);
      } catch (e) {
        adminLog(`❌ Gemini Fallback gagal: ${e.message}`);
      }
    } else {
      adminLog('⚠️ Regex tidak mendeteksi soal pada format PDF ini. Masukkan Gemini API Key di tab Konfigurasi untuk parsing otomatis.');
    }
  }

  adminState.parsedQuestions = mergeQuestionsByNumber([...regexQuestions, ...geminiQuestions]);
  adminLog(`✅ Total: ${adminState.parsedQuestions.length} soal terdeteksi secara Regex & AI`);

  const keyFile = document.getElementById('keyInput').files[0];
  if (keyFile && typeof parseAnswerKey === 'function') {
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

  const pageQuestionMap = {};
  for (const pg of imagePages) {
    for (const it of adminState.pageTextItems[pg] || []) {
      const m = it.str.match(/^(\d+)[.)]/);
      if (m) {
        if (!pageQuestionMap[pg]) pageQuestionMap[pg] = [];
        pageQuestionMap[pg].push(parseInt(m[1], 10));
      }
    }
  }
  attachCroppedImages(adminState.parsedQuestions, pageQuestionMap);

  document.getElementById('quizTitle').value = file.name.replace('.pdf', '');
  onQuestionsReady();
  generateAutoDescription(adminState.parsedQuestions, geminiKey);
}
