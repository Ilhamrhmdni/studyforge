// Quiz editor, validation summary, Cropper.js modal, and save/publish actions.
import { adminState, adminApiFetch, getAdminConfig, adminLog } from './admin-state.js';

let cropperInstance = null;
let currentCropIndex = -1;
let lastIssueCursor = -1;

function getIssueIndices() {
  return adminState.parsedQuestions
    .map((q, qi) => ({ q, qi }))
    .filter(({ q }) => q.status === 'error' || q.status === 'warning' || q.aiAudit?.status === 'flagged');
}

export function jumpToQuestion(qi) {
  const card = document.getElementById(`qe-${qi}`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.style.boxShadow = '0 0 0 2px var(--primary), 0 0 20px rgba(92,156,252,0.35)';
  setTimeout(() => {
    card.style.boxShadow = '';
  }, 1800);
}

export function jumpToNextIssue() {
  const issues = getIssueIndices();
  if (!issues.length) {
    showToast('Tidak ada soal bermasalah!', 'success');
    return;
  }
  const nextPos = issues.findIndex(({ qi }) => qi > lastIssueCursor);
  const target = nextPos >= 0 ? issues[nextPos] : issues[0];
  lastIssueCursor = target.qi;
  jumpToQuestion(target.qi);
}

function renderIssueChipsHtml() {
  const issues = getIssueIndices();
  if (!issues.length) return '';
  const chips = issues.slice(0, 25).map(({ q, qi }) => {
    const icon = q.status === 'error' ? '❌' : '⚠️';
    const border = q.status === 'error' ? 'rgba(239,68,68,0.45)' : 'rgba(245,158,11,0.45)';
    return `<button type="button" onclick="jumpToQuestion(${qi})" style="background:rgba(255,255,255,0.04);border:1px solid ${border};color:var(--text);border-radius:999px;padding:0.2rem 0.55rem;font-size:0.75rem;cursor:pointer;">${icon} No. ${q.num}</button>`;
  }).join('');
  const extra = issues.length > 25 ? `<span style="font-size:0.75rem;color:var(--text3);">+${issues.length - 25} lainnya</span>` : '';
  return `
    <div style="flex-basis:100%;display:flex;align-items:center;gap:0.45rem;flex-wrap:wrap;padding-top:0.6rem;border-top:1px solid var(--border);">
      <button type="button" onclick="jumpToNextIssue()" style="background:rgba(245,158,11,0.16);border:1px solid rgba(245,158,11,0.45);color:var(--warning);border-radius:6px;padding:0.28rem 0.65rem;font-size:0.78rem;font-weight:600;cursor:pointer;">🎯 Lompat ke Bermasalah (${issues.length})</button>
      ${chips}${extra}
    </div>
  `;
}

function renderAiAuditBadge(aiAudit) {
  if (!aiAudit) return '';
  let badge = '✅ Lolos Audit AI';
  let bg = 'rgba(34,197,94,0.1)';
  let color = 'var(--success)';

  if (aiAudit.status === 'fixed') {
    badge = '🤖 Diperbaiki AI';
    bg = 'rgba(92,156,252,0.12)';
    color = 'var(--primary)';
  } else if (aiAudit.status === 'flagged') {
    badge = '⚠️ AI Menandai Perlu Cek';
    bg = 'rgba(245,158,11,0.12)';
    color = 'var(--warning)';
  }

  const detail = aiAudit.reasoning ? ` — ${escapeHTML(aiAudit.reasoning)}` : '';
  return `<div style="background:${bg};color:${color};padding:0.45rem 0.65rem;border-radius:6px;font-size:0.78rem;margin-bottom:0.8rem;"><strong>${badge}</strong>${detail}</div>`;
}

export async function copyTextFromEl(elementId) {
  const el = document.getElementById(elementId);
  const text = (el?.innerText || el?.textContent || '').trim();
  if (!text) {
    showToast('Belum ada log untuk disalin.', 'warning');
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Log berhasil disalin ke clipboard!', 'success');
  } catch (err) {
    console.warn('Clipboard write failed:', err?.message || err);
    showToast('Gagal menyalin otomatis, blok teks log lalu tekan Ctrl+C.', 'warning');
  }
}

function appendAuditLog(msg) {
  adminLog(msg);
  const wrap = document.getElementById('auditLogWrap');
  const pre = document.getElementById('auditLogText');
  if (!wrap || !pre) return;
  wrap.style.display = 'block';
  const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
  pre.textContent += `[${time}] ${msg}\n`;
  pre.scrollTop = pre.scrollHeight;
}

export function renumberQuestions() {
  if (!adminState.parsedQuestions.length) return;
  adminState.parsedQuestions.forEach((q, idx) => {
    q.num = idx + 1;
  });
  updatePreview();
  showToast(`Nomor soal diurutkan ulang (1–${adminState.parsedQuestions.length}).`, 'success');
}

export async function runAiQuizAudit() {
  if (!adminState.parsedQuestions.length) {
    showToast('Belum ada soal untuk diperiksa.', 'warning');
    return;
  }
  if (typeof auditQuizWithAI !== 'function') {
    showToast('Modul audit AI belum termuat.', 'error');
    return;
  }

  const btn = document.getElementById('btnAiAudit');
  const statusEl = document.getElementById('aiAuditStatus');
  const logPre = document.getElementById('auditLogText');
  const { geminiKey } = getAdminConfig();

  if (logPre) logPre.textContent = '';
  appendAuditLog(`🚀 Memulai Audit AI (${adminState.parsedQuestions.length} soal)...`);

  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Mengaudit...';
  }
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.innerHTML = '🤖 Menyiapkan audit AI per batch...';
  }

  try {
    const result = await auditQuizWithAI(adminState.parsedQuestions, {
      geminiKey,
      rawPdfText: adminState.rawPdfText,
      onLog: appendAuditLog,
      onProgress: ({ batchNum, totalBatches, processed, total }) => {
        if (statusEl) {
          statusEl.innerHTML = `🤖 Mengaudit batch <strong>${batchNum}/${totalBatches}</strong> (${processed}/${total} soal)...`;
        }
      },
      backendAuditFn: (batch) => adminApiFetch('/api/admin/audit-quiz', {
        method: 'POST',
        body: { questions: batch }
      })
    });

    adminState.parsedQuestions = result.questions;
    updatePreview();

    if (statusEl) {
      const { ok, fixed, flagged, removed = 0, total } = result.summary;
      const removedBadge = removed > 0 ? ` · <span style="color:var(--text2)">${removed} duplikat dihapus</span>` : '';
      statusEl.innerHTML = `✅ <strong>Audit AI selesai (${total} soal):</strong> ${ok} OK · <span style="color:var(--primary)">${fixed} diperbaiki otomatis</span> · <span style="color:var(--warning)">${flagged} perlu cek manual</span>${removedBadge}`;
    }
    appendAuditLog(`🏁 Selesai: ${result.summary.ok} OK, ${result.summary.fixed} diperbaiki, ${result.summary.flagged} perlu cek manual, ${result.summary.removed || 0} duplikat dihapus.`);
    showToast(`Audit AI selesai: ${result.summary.fixed} soal diperbaiki, ${result.summary.flagged} perlu cek.`, 'success');
  } catch (error) {
    appendAuditLog(`❌ Audit AI gagal: ${error.message}`);
    if (statusEl) {
      statusEl.innerHTML = `❌ Audit AI gagal: ${escapeHTML(error.message)}`;
    }
    showToast(error.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🤖 Audit & Koreksi AI';
    }
  }
}

export function updatePreview() {
  if (typeof validateParsedQuiz === 'function') {
    const validationResult = validateParsedQuiz(adminState.parsedQuestions);
    adminState.parsedQuestions = validationResult.questions;
    buildQuizPreview(validationResult.stats);
  } else {
    buildQuizPreview(null);
  }
}

export function buildQuizPreview(stats) {
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
      ${renderIssueChipsHtml()}
    `;

    const btnPublish = document.getElementById('btnPublish');
    btnPublish.disabled = stats.error > 0;
    btnPublish.title = stats.error > 0 ? 'Selesaikan semua error sebelum publish.' : '';
  }

  const list = document.getElementById('questionsList');
  list.innerHTML = adminState.parsedQuestions.map((q, qi) => {
    let statusColor = 'var(--border)';
    if (q.status === 'error') statusColor = 'var(--danger)';
    if (q.status === 'warning') statusColor = 'var(--warning)';
    if (q.status === 'valid') statusColor = 'var(--success)';

    return `
    <div class="question-editor" id="qe-${qi}" style="border-left: 4px solid ${statusColor}; border-radius: 8px;">
      <div class="q-header">
        <input type="number" min="1" class="q-num" style="background:${statusColor};color:${q.status === 'warning' ? '#000' : '#fff'};border:none;text-align:center;" value="${q.num}" onchange="parsedQuestions[${qi}].num=Number.parseInt(this.value,10)||${q.num}; updatePreview();" title="Ubah nomor soal"/>
        <div style="flex:1;">
          <input class="form-input" value="${escapeHTML(q.text)}" oninput="parsedQuestions[${qi}].text=this.value" placeholder="Teks pertanyaan"/>
        </div>
        <select class="answer-select" onchange="parsedQuestions[${qi}].answer=this.value; updatePreview();" title="Jawaban benar">
          <option value="">Kunci?</option>
          ${['A', 'B', 'C', 'D', 'E'].map((k) => `<option value="${k}" ${q.answer === k ? 'selected' : ''}>${k}</option>`).join('')}
        </select>
        <button class="q-del-btn" onclick="deleteQuestion(${qi})">🗑️</button>
      </div>
      <div class="q-body">
        ${renderAiAuditBadge(q.aiAudit)}
        ${q.warnings?.length ? `<div style="background:rgba(245,158,11,0.1);color:var(--warning);padding:0.5rem;border-radius:6px;font-size:0.8rem;margin-bottom:0.8rem;">⚠️ ${q.warnings.join('<br>')}</div>` : ''}
        ${q.errors?.length ? `<div style="background:rgba(239,68,68,0.1);color:var(--danger);padding:0.5rem;border-radius:6px;font-size:0.8rem;margin-bottom:0.8rem;">❌ ${q.errors.join('<br>')}</div>` : ''}
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
          ${q.options.map((o, oi) => `
            <div class="option-item ${o.key === q.answer ? 'correct' : ''}">
              <span class="option-label">${o.key}</span>
              <input class="form-input" style="border:none;background:transparent;padding:0;font-size:0.85rem;" value="${escapeHTML(o.text)}" oninput="parsedQuestions[${qi}].options[${oi}].text=this.value"/>
            </div>
          `).join('')}
        </div>
        ${q.options.length < 5 ? `<button class="btn btn-outline" style="font-size:0.8rem;margin-top:0.8rem;padding:0.4rem 0.8rem;" onclick="addOption(${qi})">+ Opsi</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

export function attachImage(qi, input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    adminState.parsedQuestions[qi].image = e.target.result;
    updatePreview();
  };
  reader.readAsDataURL(file);
}

export function removeImage(qi) {
  delete adminState.parsedQuestions[qi].image;
  updatePreview();
}

export function openCropModal(qi) {
  currentCropIndex = qi;
  const target = document.getElementById('cropImageTarget');
  target.src = adminState.parsedQuestions[qi].image;
  document.getElementById('cropModal').style.display = 'flex';

  if (cropperInstance) cropperInstance.destroy();
  setTimeout(() => {
    cropperInstance = new Cropper(target, {
      viewMode: 1,
      background: false,
      autoCropArea: 0.9,
      dragMode: 'crop'
    });
  }, 50);
}

export function closeCropModal() {
  document.getElementById('cropModal').style.display = 'none';
  if (cropperInstance) cropperInstance.destroy();
  cropperInstance = null;
}

export function applyCrop() {
  if (!cropperInstance) return;
  const canvas = cropperInstance.getCroppedCanvas();
  if (canvas) {
    adminState.parsedQuestions[currentCropIndex].image = canvas.toDataURL('image/jpeg', 0.9);
    updatePreview();
  }
  closeCropModal();
}

export function addOption(qi) {
  const opts = adminState.parsedQuestions[qi].options;
  const keys = ['A', 'B', 'C', 'D', 'E'];
  opts.push({ key: keys[opts.length] || 'E', text: '' });
  updatePreview();
}

export function deleteQuestion(qi) {
  adminState.parsedQuestions.splice(qi, 1);
  updatePreview();
}

export function addQuestion() {
  adminState.parsedQuestions.push({
    num: adminState.parsedQuestions.length + 1,
    text: 'Pertanyaan baru',
    options: [
      { key: 'A', text: 'Opsi A' },
      { key: 'B', text: 'Opsi B' },
      { key: 'C', text: 'Opsi C' },
      { key: 'D', text: 'Opsi D' }
    ],
    answer: 'A'
  });
  updatePreview();
}

export function cancelPreview() {
  adminState.parsedQuestions = [];
  document.getElementById('metaBox').style.display = 'none';
  document.getElementById('quizPreview').style.display = 'none';
  document.getElementById('parseLog').style.display = 'none';
  document.getElementById('fileInput').value = '';
  document.getElementById('keyInput').value = '';
}

export function saveQuizDraft() {
  const title = document.getElementById('quizTitle').value.trim();
  return saveQuizData(`[DRAFT] ${title || 'Paket Soal Baru'}`, document.getElementById('btnDraft'));
}

export function publishQuiz() {
  return saveQuizData(document.getElementById('quizTitle').value.trim(), document.getElementById('btnPublish'));
}

export async function saveQuizData(finalTitle, btn) {
  if (!adminState.parsedQuestions.length) {
    showToast('Tidak ada soal untuk disimpan!', 'error');
    return;
  }
  if (!finalTitle || finalTitle === '[DRAFT] ') {
    showToast('Isi judul paket soal!', 'error');
    return;
  }

  const subject = document.getElementById('quizSubject').value.trim();
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ Menyimpan...';

  try {
    await adminApiFetch('/api/admin/save-quiz', {
      method: 'POST',
      body: {
        title: finalTitle,
        subject: subject || 'Umum',
        description: document.getElementById('quizDesc').value.trim(),
        duration: Number.parseInt(document.getElementById('quizDuration').value, 10) || 60,
        questions: adminState.parsedQuestions
      }
    });

    showToast('✅ Berhasil disimpan ke Supabase!', 'success');
    btn.innerHTML = '✅ Tersimpan!';
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = originalText;
      cancelPreview();
    }, 2500);
  } catch (e) {
    showToast(`❌ Gagal: ${e.message}`, 'error');
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}
