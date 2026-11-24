// Admin entry point: auth guard, PDF dropzone setup, and global bindings.
import { adminApiFetch, getAdminConfig, saveConfig, adminLog } from './admin-state.js';
import { handleFile, attachCroppedImages } from './admin-parser.js';
import {
  updatePreview,
  buildQuizPreview,
  attachImage,
  removeImage,
  openCropModal,
  closeCropModal,
  applyCrop,
  addOption,
  deleteQuestion,
  addQuestion,
  cancelPreview,
  copyTextFromEl,
  renumberQuestions,
  runAiQuizAudit,
  saveQuizDraft,
  publishQuiz,
  saveQuizData
} from './admin-editor.js';
import {
  switchTab,
  loadManage,
  editQuizInfo,
  toggleQuizVisibility,
  deleteQuiz,
  loadResults,
  deleteResult,
  loadUGC,
  approveUGC,
  rejectUGC,
  loadAnalytics,
  loadBugReports,
  deleteBugReport,
  loadInsight
} from './admin-tabs.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

function adminLogout() {
  initSupabase().auth.signOut().then(() => {
    location.href = '/login.html';
  });
}

function initAdmin() {
  const cfg = getAdminConfig();
  if (cfg.geminiKey) {
    document.getElementById('cfgGemini').value = cfg.geminiKey;
  }

  const dropZone = document.getElementById('dropZone');
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFile(e.dataTransfer.files[0], updatePreview).catch((err) => {
      showToast(err?.message || 'Gagal memproses PDF.', 'error');
    });
  });
}

async function initAdminAuthSafe() {
  const user = await requireAuth();
  if (!user) return;

  try {
    await adminApiFetch('/api/admin/session');
    document.getElementById('loginScreen').style.display = 'none';
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    initAdmin();
  } catch (error) {
    if (error.status === 403) {
      document.getElementById('adminStatusText').textContent = 'Akses Ditolak';
      document.getElementById('loginError').innerHTML = `Akun Anda (${escapeHTML(user.email)}) tidak memiliki akses admin.<br><br><button class="btn btn-outline" onclick="location.href='/'">Kembali ke Beranda</button>`;
      return;
    }

    document.getElementById('adminStatusText').textContent = 'Admin belum siap';
    document.getElementById('loginError').innerHTML = `${escapeHTML(error.message || 'Terjadi gangguan saat memeriksa sesi admin.')}<br><br><small style="color:var(--text2);">Periksa Cloudflare env dan koneksi Supabase, lalu refresh halaman.</small>`;
  }
}

initAdminAuthSafe().catch((err) => console.error('initAdminAuthSafe error:', err));

// Expose handlers used by inline onclick/onchange attributes in admin.html
Object.assign(window, {
  saveConfig,
  getConfig: getAdminConfig,
  adminLogout,
  initAdmin,
  initAdminAuthSafe,
  adminApiFetch,
  log: adminLog,
  handleFile: (file) => handleFile(file, updatePreview),
  attachCroppedImages,
  updatePreview,
  buildQuizPreview,
  attachImage,
  removeImage,
  openCropModal,
  closeCropModal,
  applyCrop,
  addOption,
  deleteQuestion,
  addQuestion,
  cancelPreview,
  copyTextFromEl,
  renumberQuestions,
  runAiQuizAudit,
  saveQuizDraft,
  publishQuiz,
  saveQuizData,
  switchTab,
  loadManage,
  editQuizInfo,
  toggleQuizVisibility,
  deleteQuiz,
  loadResults,
  deleteResult,
  loadUGC,
  approveUGC,
  rejectUGC,
  loadAnalytics,
  loadBugReports,
  deleteBugReport,
  loadInsight
});
