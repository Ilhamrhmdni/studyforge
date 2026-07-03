let currentParseJobId = null;
let currentQuestions = [];
let rawAIOutput = [];

const logEl = document.getElementById('uploadStatus');
const log = (msg) => {
  logEl.textContent = msg;
  console.log(msg);
};

// Handle Drag and Drop
const dropZone = document.getElementById('dropZone');
const pdfInput = document.getElementById('pdfInput');

dropZone.addEventListener('click', () => pdfInput.click());
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.style.borderColor = 'var(--primary)';
  dropZone.style.background = 'rgba(99, 102, 241, 0.05)';
});
dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dropZone.style.borderColor = 'var(--border)';
  dropZone.style.background = 'transparent';
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.style.borderColor = 'var(--border)';
  dropZone.style.background = 'transparent';
  if (e.dataTransfer.files.length) {
    handleFileUpload(e.dataTransfer.files[0]);
  }
});
pdfInput.addEventListener('change', (e) => {
  if (e.target.files.length) {
    handleFileUpload(e.target.files[0]);
  }
});

async function apiCall(endpoint, data = {}) {
  const token = localStorage.getItem('sf_token');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

function compressForGemini(dataUrl, maxWidth = 600) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > maxWidth) {
        h = Math.round((h * maxWidth) / w);
        w = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.6));
    };
    img.src = dataUrl;
  });
}

async function parseWithGemini(pageImagesMap, geminiKey) {
  const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-flash'];
  const pageNums = Object.keys(pageImagesMap).map(Number).sort((a,b) => a-b);
  const BATCH_SIZE = 2; 

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
- answer = huruf jawaban benar (A/B/C/D/E), kosongkan "" jika tidak terlihat
- Nomor soal (num) harus urut dan sesuai nomor di PDF
- HANYA kembalikan JSON valid array, tanpa markdown.`;

  let workingModel = null;
  let GEMINI_URL = '';
  const allQuestions = [];
  const batches = [];
  
  for (let i = 0; i < pageNums.length; i += BATCH_SIZE) {
    batches.push(pageNums.slice(i, i + BATCH_SIZE));
  }

  for (let bi = 0; bi < batches.length; bi++) {
    const batchPages = batches[bi];
    log(`🤖 Memproses batch ${bi+1}/${batches.length} (halaman ${batchPages.join(', ')})...`);

    const parts = [{ text: PROMPT(batchPages) }];
    for (const pg of batchPages) {
      const compressed = await compressForGemini(pageImagesMap[pg]);
      const base64Data = compressed.split(',')[1];
      parts.push({
        inlineData: { mimeType: 'image/jpeg', data: base64Data }
      });
    }

    const payload = { contents: [{ parts }], generationConfig: { temperature: 0.1 } };
    let success = false;
    let lastErr = null;

    for (const model of (workingModel ? [workingModel] : MODELS)) {
      const url = workingModel 
        ? GEMINI_URL 
        : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const data = await res.json();
        
        if (data.error) throw new Error(data.error.message);
        
        let text = data.candidates[0].content.parts[0].text.trim();
        if (text.startsWith('```json')) text = text.replace(/```json\n?/, '').replace(/```\s*$/, '');
        
        const qArray = JSON.parse(text);
        if (Array.isArray(qArray)) {
          allQuestions.push(...qArray);
          success = true;
          if (!workingModel) { workingModel = model; GEMINI_URL = url; }
          break;
        }
      } catch (e) {
        lastErr = e;
      }
    }
    
    if (!success) {
      console.warn(`Gagal memproses batch ${bi+1}:`, lastErr);
    }
  }

  return allQuestions;
}

async function handleFileUpload(file) {
  if (file.type !== 'application/pdf') return alert('Harus file PDF!');
  if (file.size > 20 * 1024 * 1024) return alert('Maksimal 20MB!');
  
  const geminiKey = document.getElementById('creatorGeminiKey').value.trim();
  if (!geminiKey) return alert('Silakan masukkan Gemini API Key terlebih dahulu.');
  
  const consent = document.getElementById('consentCheck').checked;
  if (!consent) return alert('Anda harus menyetujui persyaratan penggunaan.');

  try {
    dropZone.style.pointerEvents = 'none';
    dropZone.style.opacity = '0.5';
    
    // 1. Read PDF
    log('Membaca PDF...');
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument(buffer).promise;
    
    if (pdf.numPages > 30) throw new Error('Maksimal 30 halaman!');

    // 2. Init Job in Backend
    log('Membuat tugas parsing...');
    const initRes = await apiCall('/api/user/init-parse-job', {
      file_name: file.name,
      file_size: file.size,
      page_count: pdf.numPages,
      analytics_consent: consent
    });
    currentParseJobId = initRes.parse_job_id;

    // 3. Render Pages
    const pageImagesMap = {};
    for (let i = 1; i <= pdf.numPages; i++) {
      log(`Rendering halaman ${i}/${pdf.numPages}...`);
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      pageImagesMap[i] = canvas.toDataURL('image/jpeg', 0.8);
    }

    // 4. Gemini Parse
    log('Mengirim ke AI Gemini...');
    rawAIOutput = await parseWithGemini(pageImagesMap, geminiKey);
    
    if (rawAIOutput.length === 0) throw new Error('AI tidak menemukan soal apapun.');
    if (rawAIOutput.length > 100) rawAIOutput = rawAIOutput.slice(0, 100);

    // Normalize
    currentQuestions = JSON.parse(JSON.stringify(rawAIOutput));
    let detected_keys = currentQuestions.filter(q => q.answer).length;

    // 5. Save Raw Result to Backend
    log('Menyimpan metrik...');
    await apiCall('/api/user/save-parse-result', {
      parse_job_id: currentParseJobId,
      raw_ai_output: rawAIOutput,
      normalized_output: currentQuestions,
      detected_question_count: currentQuestions.length,
      detected_answer_key_count: detected_keys,
      validation_status: 'valid'
    });

    log('Selesai!');
    document.getElementById('metaForm').style.display = 'block';
    document.getElementById('quizTitle').value = file.name.replace('.pdf', '');
    renderEditor();

  } catch (err) {
    log(`Error: ${err.message}`);
    alert(err.message);
  } finally {
    dropZone.style.pointerEvents = 'auto';
    dropZone.style.opacity = '1';
  }
}

function renderEditor() {
  document.getElementById('editorArea').style.display = 'block';
  const c = document.getElementById('questionsContainer');
  c.innerHTML = '';
  
  currentQuestions.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'feature-card';
    card.style.padding = '1.5rem';
    
    let optionsHtml = '';
    if (q.options && q.options.length) {
      q.options.forEach((opt, oidx) => {
        const isAns = q.answer === opt.key;
        optionsHtml += `
          <div style="display:flex; gap:0.5rem; margin-bottom:0.5rem; align-items:center;">
            <input type="radio" name="ans_${idx}" value="${opt.key}" ${isAns ? 'checked' : ''} onchange="updateAns(${idx}, '${opt.key}')">
            <strong>${opt.key}.</strong>
            <input type="text" class="form-input" style="padding:0.2rem 0.5rem; flex:1;" value="${opt.text}" onchange="updateOpt(${idx}, ${oidx}, this.value)">
          </div>
        `;
      });
    }

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; margin-bottom:1rem;">
        <strong>Soal ${q.num}</strong>
        <button class="btn-logout" onclick="delQuestion(${idx})">Hapus</button>
      </div>
      <textarea class="form-input" style="min-height:80px; margin-bottom:1rem;" onchange="updateText(${idx}, this.value)">${q.text}</textarea>
      ${optionsHtml}
    `;
    c.appendChild(card);
  });
}

window.updateText = (qidx, val) => currentQuestions[qidx].text = val;
window.updateOpt = (qidx, oidx, val) => currentQuestions[qidx].options[oidx].text = val;
window.updateAns = (qidx, key) => currentQuestions[qidx].answer = key;
window.delQuestion = (qidx) => { currentQuestions.splice(qidx, 1); renderEditor(); };

document.getElementById('btnSaveQuiz').addEventListener('click', async () => {
  try {
    const title = document.getElementById('quizTitle').value.trim();
    const subject = document.getElementById('quizSubject').value.trim();
    
    if (!title || !subject) return alert('Judul dan Mata Pelajaran wajib diisi.');
    
    const btn = document.getElementById('btnSaveQuiz');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    // Calculate diff for correction_summary
    let changed_q = 0, changed_ans = 0;
    currentQuestions.forEach((q, i) => {
      const orig = rawAIOutput[i];
      if (!orig) { changed_q++; return; }
      if (q.text !== orig.text) changed_q++;
      if (q.answer !== orig.answer) changed_ans++;
    });

    // Save final parse result
    await apiCall('/api/user/save-parse-result', {
      parse_job_id: currentParseJobId,
      final_user_corrected_output: currentQuestions,
      correction_summary: { changed_questions: changed_q, changed_answers: changed_ans }
    });

    // Save Quiz
    await apiCall('/api/user/save-quiz', {
      title,
      subject,
      questions: currentQuestions,
      parse_job_id: currentParseJobId
    });

    alert('Kuis berhasil disimpan ke Koleksi Pribadi!');
    window.location.href = '/dashboard.html';

  } catch (err) {
    alert(`Error: ${err.message}`);
    document.getElementById('btnSaveQuiz').disabled = false;
    document.getElementById('btnSaveQuiz').textContent = '💾 Simpan ke Koleksi Pribadi';
  }
});

window.onload = async () => {
  const user = await requireAuth();
  if (!user) return;
  if (typeof updateNavForUser === 'function') updateNavForUser();
};

// --- Auto-exports to window ---
window.log = log;
window.renderEditor = renderEditor;
window.compressForGemini = compressForGemini;
window.parseWithGemini = parseWithGemini;
window.handleFileUpload = handleFileUpload;
window.apiCall = apiCall;
