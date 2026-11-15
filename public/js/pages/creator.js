let currentParseJobId = null;
let currentQuestions = [];
let rawAIOutput = [];

const logEl = document.getElementById('uploadStatus');
function log(msg) {
  logEl.textContent = msg;
  console.log(msg);
}

// Event listeners dipasang di dalam init() setelah auth selesai
let creatorDropZone = null;
let pdfInput = null;

async function apiCall(endpoint, data = {}) {
  const token = await getAccessToken();
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

    /** @type {any[]} */
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
    creatorDropZone.style.pointerEvents = 'none';
    creatorDropZone.style.opacity = '0.5';
    
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
    creatorDropZone.style.pointerEvents = 'auto';
    creatorDropZone.style.opacity = '1';
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

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:1rem;';

    const title = document.createElement('strong');
    title.textContent = `Soal ${q.num}`;
    header.appendChild(title);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-logout';
    deleteBtn.textContent = 'Hapus';
    deleteBtn.addEventListener('click', () => delQuestion(idx));
    header.appendChild(deleteBtn);
    card.appendChild(header);

    const ta = document.createElement('textarea');
    ta.className = 'form-input';
    ta.style.cssText = 'min-height:80px; margin-bottom:1rem; width:100%;';
    ta.value = q.text || '';
    ta.addEventListener('input', (e) => updateText(idx, e.target.value));
    card.appendChild(ta);

    if (q.options && q.options.length) {
      q.options.forEach((opt, oidx) => {
        const optDiv = document.createElement('div');
        optDiv.style.cssText = 'display:flex; gap:0.5rem; margin-bottom:0.5rem; align-items:center;';

        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `ans_${idx}`;
        radio.value = opt.key || '';
        radio.checked = q.answer === opt.key;
        radio.addEventListener('change', () => {
          if (radio.checked) updateAns(idx, opt.key);
        });
        optDiv.appendChild(radio);

        const label = document.createElement('strong');
        label.textContent = `${opt.key}.`;
        optDiv.appendChild(label);

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'form-input';
        input.style.cssText = 'padding:0.2rem 0.5rem; flex:1;';
        input.value = opt.text || '';
        input.addEventListener('input', (e) => updateOpt(idx, oidx, e.target.value));
        optDiv.appendChild(input);

        card.appendChild(optDiv);
      });
    }

    c.appendChild(card);
  });
}

function updateText(qidx, val) {
  currentQuestions[qidx].text = val;
}
function updateOpt(qidx, oidx, val) {
  currentQuestions[qidx].options[oidx].text = val;
}
function updateAns(qidx, key) {
  currentQuestions[qidx].answer = key;
}
function delQuestion(qidx) {
  currentQuestions.splice(qidx, 1);
  renderEditor();
}

function addManualQuestion() {
  currentQuestions.push({
    num: currentQuestions.length + 1,
    text: 'Pertanyaan baru',
    options: [
      { key: 'A', text: 'Opsi A' },
      { key: 'B', text: 'Opsi B' },
      { key: 'C', text: 'Opsi C' },
      { key: 'D', text: 'Opsi D' }
    ],
    answer: 'A'
  });
  renderEditor();
}

function validateCreatorQuiz() {
  const alertsEl = document.getElementById('validationAlerts');
  if (!alertsEl) return;

  const issues = [];
  const nums = new Set();
  currentQuestions.forEach((q, idx) => {
    const label = q.num || idx + 1;
    if (!q.text || q.text.trim().length < 5) issues.push(`Soal ${label}: Teks soal terlalu pendek atau kosong.`);
    if (!q.options || q.options.length < 2) issues.push(`Soal ${label}: Minimal harus ada 2 opsi jawaban.`);
    if (!q.answer) issues.push(`Soal ${label}: Kunci jawaban belum dipilih.`);
    if (nums.has(q.num)) issues.push(`Soal ${label}: Nomor soal duplikat.`);
    nums.add(q.num);
  });

  if (issues.length === 0) {
    alertsEl.innerHTML = `<div style="background:rgba(16,185,129,0.1);color:var(--success);border:1px solid rgba(16,185,129,0.2);padding:0.8rem 1rem;border-radius:8px;font-size:0.85rem;">✅ Semua ${currentQuestions.length} soal valid dan siap disimpan!</div>`;
  } else {
    alertsEl.innerHTML = `<div style="background:rgba(245,158,11,0.1);color:var(--warning);border:1px solid rgba(245,158,11,0.2);padding:0.8rem 1rem;border-radius:8px;font-size:0.85rem;"><strong>⚠️ Ditemukan ${issues.length} catatan:</strong><br>${issues.map((i) => `• ${i}`).join('<br>')}</div>`;
  }
}

window.updateText = updateText;
window.updateOpt = updateOpt;
window.updateAns = updateAns;
window.delQuestion = delQuestion;
window.addManualQuestion = addManualQuestion;
window.validateCreatorQuiz = validateCreatorQuiz;

const btnValidateEl = document.getElementById('btnValidate');
if (btnValidateEl) btnValidateEl.addEventListener('click', validateCreatorQuiz);

const btnAddQuestionEl = document.getElementById('btnAddQuestion');
if (btnAddQuestionEl) btnAddQuestionEl.addEventListener('click', addManualQuestion);

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

  // Setup event listeners setelah auth berhasil
  creatorDropZone = document.getElementById('dropZone');
  pdfInput = document.getElementById('pdfInput');

  if (creatorDropZone && pdfInput) {
    creatorDropZone.addEventListener('click', () => pdfInput.click());
    creatorDropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      creatorDropZone.style.borderColor = 'var(--primary)';
      creatorDropZone.style.background = 'rgba(99, 102, 241, 0.05)';
    });
    creatorDropZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      creatorDropZone.style.borderColor = 'var(--border)';
      creatorDropZone.style.background = 'transparent';
    });
    creatorDropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      creatorDropZone.style.borderColor = 'var(--border)';
      creatorDropZone.style.background = 'transparent';
      if (e.dataTransfer.files.length) handleFileUpload(e.dataTransfer.files[0]);
    });
    pdfInput.addEventListener('change', (e) => {
      if (e.target.files.length) handleFileUpload(e.target.files[0]);
    });
  }
};

// --- Auto-exports to window ---
window.log = log;
window.renderEditor = renderEditor;
window.compressForGemini = compressForGemini;
window.parseWithGemini = parseWithGemini;
window.handleFileUpload = handleFileUpload;
window.apiCall = apiCall;
