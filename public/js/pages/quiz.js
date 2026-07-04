let quiz = null, answers = {}, currentIdx = 0;
let doubtfulQuestions = new Set();
let timerInterval = null, timeLeft = 0;
let userName = '';
let currentQuizId = '';
let currentUser = null;
let bugReportImageDataUrl = '';

function getQuizStateKey() {
  if (!currentQuizId || !currentUser) return '';
  return `quizState:${currentQuizId}:${currentUser.id}`;
}

function saveQuizState() {
  const key = getQuizStateKey();
  if (!key || !quiz) return;

  const state = {
    currentIdx,
    answers,
    timeLeft,
    questionOrder: quiz.questions.map((question) => question.qid),
    doubtfulQuestions: Array.from(doubtfulQuestions),
    optionOrder: Object.fromEntries(
      quiz.questions.map((question) => [
        question.qid,
        (question.options || []).map((option) => option.id)
      ])
    )
  };

  sessionStorage.setItem(key, JSON.stringify(state));
}

function loadQuizState() {
  try {
    const key = getQuizStateKey();
    if (!key) return null;
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function clearQuizState() {
  try {
    const key = getQuizStateKey();
    if (key) sessionStorage.removeItem(key);
  } catch (e) {
    console.warn('Gagal menghapus state quiz:', e);
  }
}

function reorderById(items, orderedIds, pickId) {
  if (!Array.isArray(items) || !Array.isArray(orderedIds) || !orderedIds.length) return items;

  const itemMap = new Map(items.map((item) => [pickId(item), item]));
  const ordered = [];
  orderedIds.forEach((id) => {
    const item = itemMap.get(id);
    if (item) {
      ordered.push(item);
      itemMap.delete(id);
    }
  });
  itemMap.forEach((item) => ordered.push(item));
  return ordered;
}

function applyQuizState(savedState) {
  if (!quiz) return false;

  if (savedState?.questionOrder?.length) {
    quiz.questions = reorderById(quiz.questions, savedState.questionOrder, (question) => question.qid);
  } else {
    shuffleArray(quiz.questions);
  }

  quiz.questions.forEach((question) => {
    if (savedState?.optionOrder?.[question.qid]?.length) {
      question.options = reorderById(question.options || [], savedState.optionOrder[question.qid], (option) => option.id);
    } else if (question.options && question.options.length > 0) {
      shuffleArray(question.options);
    }

    (question.options || []).forEach((option, index) => {
      option.label = ['A', 'B', 'C', 'D', 'E'][index] || String(index + 1);
    });
  });

  answers = savedState?.answers && typeof savedState.answers === 'object' ? savedState.answers : {};
  doubtfulQuestions = new Set(savedState?.doubtfulQuestions || []);
  currentIdx = Math.min(Math.max(parseInt(savedState?.currentIdx, 10) || 0, 0), Math.max(quiz.questions.length - 1, 0));
  timeLeft = Math.max(0, parseInt(savedState?.timeLeft, 10) || ((quiz.duration || 60) * 60));
  return true;
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

async function init() {
  try {
    const user = await requireAuth();
    if (!user) return;
    currentUser = user;
    userName = user.user_metadata?.full_name || user.email;

    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if (!id) { window.location.href = '/'; return; }
    currentQuizId = id;

    const shouldReset = params.get('reset') === '1' || params.get('fresh') === '1';
    if (shouldReset) {
      clearQuizState();
      // Remove reset param from URL so refresh doesn't reset again
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.delete('reset');
      newUrl.searchParams.delete('fresh');
      window.history.replaceState({}, '', newUrl);
    }

    const sb = initSupabase();
    const { data: { session } } = await sb.auth.getSession();
    const response = await fetch(`/api/quiz?id=${encodeURIComponent(id)}`, {
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
    });
    const payload = await response.json();
    if (!response.ok || !payload.quiz) throw new Error(payload.error || 'Quiz tidak ditemukan');
    quiz = payload.quiz;
    applyQuizState(loadQuizState());

    document.title = `${escapeHTML(quiz.title)} - StudyForge`;
    document.getElementById('quizNavInfo').textContent = escapeHTML(quiz.title);
    document.getElementById('sb-total').textContent = quiz.questions.length;
    document.getElementById('sb-remaining').textContent = quiz.questions.length;
    if (!timeLeft) {
      timeLeft = (quiz.duration || 60) * 60;
    }

    startQuiz();
    updateBugReportMeta();
  } catch (e) {
    alert(`Gagal memuat quiz: ${e.message}`);
    window.location.href = '/';
  }
}

function startQuiz() {
  document.getElementById('questionCard').style.display = 'block';
  document.getElementById('quizNav').style.display = 'flex';
  const timerEl = document.getElementById('timer');
  const startMinutes = Math.floor(timeLeft / 60);
  const startSeconds = timeLeft % 60;
  timerEl.textContent = `${String(startMinutes).padStart(2, '0')}:${String(startSeconds).padStart(2, '0')}`;
  if (timeLeft <= 300) timerEl.classList.add('danger');
  startTimer();
  renderQuestion();
  renderSidebar();
  saveQuizState();
}

function startTimer() {
  const el = document.getElementById('timer');
  timerInterval = setInterval(() => {
    if (timeLeft <= 0) { clearInterval(timerInterval); submitQuiz(); return; }
    timeLeft--;
    const m = Math.floor(timeLeft / 60);
    const s = timeLeft % 60;
    el.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (timeLeft <= 300) el.classList.add('danger');
    saveQuizState();
  }, 1000);
}

function renderQuestion() {
  if (!quiz) return;
  const q = quiz.questions[currentIdx];
  const total = quiz.questions.length;
  document.getElementById('questionNum').textContent = `Soal ${currentIdx + 1} dari ${total}`;
  document.getElementById('progressText').textContent = `Soal ${currentIdx + 1} dari ${total}`;
  
  const opts = document.getElementById('optionsList');
  opts.innerHTML = q.options.map((o) => `
    <button class="option-btn ${answers[q.qid] === o.id ? 'selected' : ''}" onclick="selectAnswer('${escapeHTML(q.qid)}','${escapeHTML(o.id)}')">
      <span class="option-key">${escapeHTML(o.label || o.id)}</span>
      <span>${escapeHTML(o.text)}</span>
    </button>
  `).join('');

  let imgHtml = '';
  if (q.image) {
    imgHtml = `<div style="margin-bottom:1rem;text-align:center;">
      <img src="${q.image}" style="max-width:100%;max-height:320px;object-fit:contain;border-radius:10px;border:1px solid var(--border);" alt="Gambar soal"/>
    </div>`;
  }
  document.getElementById('questionText').innerHTML = `${imgHtml}<span>${escapeHTML(q.text)}</span>`;

  document.getElementById('prevBtn').disabled = currentIdx === 0;
  document.getElementById('nextBtn').textContent = currentIdx === total - 1 ? 'Lihat Ringkasan' : 'Selanjutnya →';

  updateDoubtBtn();
  updateSidebar();
}

function updateDoubtBtn() {
  if (!quiz) return;
  const q = quiz.questions[currentIdx];
  const btn = document.getElementById('doubtBtn');
  if (doubtfulQuestions.has(q.qid)) {
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-outline');
    btn.textContent = 'Hapus Ragu-ragu';
    btn.style.color = '#a855f7';
    btn.style.borderColor = '#a855f7';
  } else {
    btn.classList.remove('btn-outline');
    btn.classList.add('btn-secondary');
    btn.textContent = 'Tandai Ragu-ragu';
    btn.style.color = '';
    btn.style.borderColor = '';
  }
}

function toggleDoubt() {
  if (!quiz) return;
  const q = quiz.questions[currentIdx];
  if (doubtfulQuestions.has(q.qid)) {
    doubtfulQuestions.delete(q.qid);
  } else {
    doubtfulQuestions.add(q.qid);
  }
  saveQuizState();
  updateDoubtBtn();
  updateSidebar();
}

function toggleQuizSidebar() {
  const sidebar = document.getElementById('quizSidebarWrapper');
  if (sidebar) {
    sidebar.classList.toggle('open');
  }
}

function renderSidebar() {
  const el = document.getElementById('sidebarDots');
  el.innerHTML = quiz.questions.map((_, i) => {
    const qid = quiz.questions[i].qid;
    const isAnswered = !!answers[qid];
    const isDoubtful = doubtfulQuestions.has(qid);
    const isCurrent = (i === currentIdx);
    
    let cls = 'sdot';
    if (isDoubtful) cls += ' doubtful';
    else if (isAnswered) cls += ' answered';
    if (isCurrent) cls += ' current';
    
    let title = `Soal ${i + 1}`;
    if (isDoubtful) title += `, ragu-ragu`;
    else if (isAnswered) title += `, sudah dijawab`;
    else title += `, belum dijawab`;
    
    return `<button class="${cls}" onclick="goTo(${i})" title="${title}" aria-label="${title}">${i + 1}</button>`;
  }).join('');
}

function updateSidebar() {
  const total = quiz.questions.length;
  const answered = Object.keys(answers).length;
  const doubtful = doubtfulQuestions.size;
  const remaining = total - answered;

  document.getElementById('sb-answered').textContent = answered;
  document.getElementById('sb-doubtful').textContent = doubtful;
  document.getElementById('sb-remaining').textContent = remaining;
  
  renderSidebar();
}

function selectAnswer(qid, optionId) {
  answers[qid] = optionId;
  saveQuizState();
  renderQuestion();
}

function navigate(dir) {
  const next = currentIdx + dir;
  if (next < 0 || next >= quiz.questions.length) {
    if (dir > 0) confirmSubmit();
    return;
  }
  goTo(next);
}

function goTo(idx) {
  currentIdx = idx;
  saveQuizState();
  renderQuestion();
}

function confirmSubmit() {
  const answered = Object.keys(answers).length;
  const total = quiz.questions.length;
  document.getElementById('submitModalText').innerHTML = `Kamu sudah menjawab <strong>${answered}</strong> dari <strong>${total}</strong> soal. Yakin ingin mengumpulkan?`;
  document.getElementById('submitModal').style.display = 'flex';
}

async function submitQuiz() {
  clearInterval(timerInterval);
  window.isSubmitting = true; // Prevent beforeunload from saving state
  document.getElementById('submitModal').style.display = 'none';
  document.getElementById('submitBtn').disabled = true;
  document.getElementById('submitBtn').textContent = '⏳ Menyimpan...';

  const timeTaken = ((quiz.duration || 60) * 60) - timeLeft;
  try {
    const sb = initSupabase();
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) throw new Error('Sesi login tidak ditemukan.');

    const response = await fetch('/api/submit-quiz', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        quizId: quiz.id,
        answers,
        questionOrder: quiz.questions.map((question) => question.qid),
        timeTaken
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Gagal menyimpan hasil.');
    clearQuizState();
    window.location.href = `/result?id=${payload.attemptId}`;
  } catch (e) {
    console.error('Failed to save result:', e);
    alert(`Gagal menyimpan hasil! ${e.message}`);
    window.isSubmitting = false;
    document.getElementById('submitBtn').disabled = false;
    document.getElementById('submitBtn').textContent = '✅ Kumpulkan Jawaban';
  }
}

function showToast(msg, type = '') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function updateBugReportMeta() {
  const meta = document.getElementById('bugReportMeta');
  if (!meta || !quiz) return;
  const question = quiz.questions?.[currentIdx];
  meta.innerHTML = `
    <div><strong>Pelapor:</strong> ${escapeHTML(currentUser?.email || '-')}</div>
    <div><strong>Quiz:</strong> ${escapeHTML(quiz.title || '-')}</div>
    <div><strong>Posisi saat ini:</strong> Soal ${question?.num || currentIdx + 1}</div>
  `;
}

function openBugReportModal() {
  updateBugReportMeta();
  document.getElementById('bugReportModal').style.display = 'flex';
}

function closeBugReportModal() {
  document.getElementById('bugReportModal').style.display = 'none';
}

function handleBugReportImage(file) {
  if (!file) {
    clearBugReportImage();
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    bugReportImageDataUrl = String(event.target?.result || '');
    document.getElementById('bugReportPreviewImage').src = bugReportImageDataUrl;
    document.getElementById('bugReportPreview').style.display = bugReportImageDataUrl ? 'block' : 'none';
  };
  reader.readAsDataURL(file);
}

function clearBugReportImage() {
  bugReportImageDataUrl = '';
  document.getElementById('bugReportImageInput').value = '';
  document.getElementById('bugReportPreviewImage').src = '';
  document.getElementById('bugReportPreview').style.display = 'none';
}

async function submitBugReport() {
  const message = document.getElementById('bugReportMessage').value.trim();
  if (!message) {
    alert('Tulis dulu deskripsi bug yang ditemukan.');
    return;
  }

  const button = document.getElementById('sendBugReportBtn');
  button.disabled = true;
  button.textContent = 'Mengirim...';

  try {
    const sb = initSupabase();
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) throw new Error('Sesi login tidak ditemukan.');

    const question = quiz?.questions?.[currentIdx];
    const response = await fetch('/api/report-bug', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        quizId: quiz?.id || currentQuizId,
        quizTitle: quiz?.title || '',
        questionNum: question?.num || currentIdx + 1,
        pageUrl: window.location.href,
        message,
        screenshotDataUrl: bugReportImageDataUrl || null
      })
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Gagal mengirim laporan bug.');

    showToast('Laporan bug berhasil dikirim ke admin panel.', 'success');
    document.getElementById('bugReportMessage').value = '';
    clearBugReportImage();
    closeBugReportModal();
  } catch (error) {
    alert(`Gagal mengirim report bug: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Kirim Laporan';
  }
}

window.addEventListener('beforeunload', () => {
  if (!window.isSubmitting) {
    saveQuizState();
  }
});

init();

// --- Auto-exports to window ---
window.submitQuiz = submitQuiz;
window.shuffleArray = shuffleArray;
window.showToast = showToast;
window.updateBugReportMeta = updateBugReportMeta;
window.applyQuizState = applyQuizState;
window.renderQuestion = renderQuestion;
window.navigate = navigate;
window.submitBugReport = submitBugReport;
window.handleBugReportImage = handleBugReportImage;
window.selectAnswer = selectAnswer;
window.saveQuizState = saveQuizState;
window.renderSidebar = renderSidebar;
window.init = init;
window.openBugReportModal = openBugReportModal;
window.loadQuizState = loadQuizState;
window.reorderById = reorderById;
window.startTimer = startTimer;
window.updateSidebar = updateSidebar;
window.closeBugReportModal = closeBugReportModal;
window.startQuiz = startQuiz;
window.clearQuizState = clearQuizState;
window.getQuizStateKey = getQuizStateKey;
window.confirmSubmit = confirmSubmit;
window.clearBugReportImage = clearBugReportImage;
window.goTo = goTo;
window.toggleDoubt = toggleDoubt;
window.toggleQuizSidebar = toggleQuizSidebar;
