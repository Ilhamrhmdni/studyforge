function getGrade(score) {
  if (score >= 85) return { label: 'A - Sangat Baik 🏆', cls: 'grade-A' };
  if (score >= 70) return { label: 'B - Baik 👍', cls: 'grade-B' };
  if (score >= 55) return { label: 'C - Cukup 📚', cls: 'grade-C' };
  return { label: 'D - Perlu Belajar Lebih Giat 💪', cls: 'grade-D' };
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

// Simpan attempt_id global untuk dipakai saat request AI
let _currentAttemptId = null;

window.onload = async () => {
  const user = await requireAuth();
  if (!user) return;

  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');

  if (!id) {
    document.getElementById('noResult').style.display = 'block';
    document.getElementById('resultContent').style.display = 'none';
    return;
  }

  _currentAttemptId = id;

  const sb = initSupabase();
  const { data: attempt, error: attemptErr } = await sb
    .from('quiz_attempts')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single();

  if (attemptErr || !attempt) {
    document.getElementById('noResult').style.display = 'block';
    document.getElementById('resultContent').style.display = 'none';
    return;
  }

  const { data: answersData } = await sb
    .from('quiz_attempt_answers')
    .select('*')
    .eq('attempt_id', id)
    .eq('user_id', user.id)
    .order('question_num');

  const r = {
    user_name: user.user_metadata?.full_name || user.email,
    score: attempt.score,
    quiz_title: attempt.quiz_title,
    submitted_at: attempt.submitted_at,
    correct: attempt.correct,
    total: attempt.total,
    time_taken: attempt.time_taken,
    answers: (answersData || []).map((a) => ({
      isCorrect: a.is_correct,
      question: a.question_text,
      options: Array.isArray(a.options) ? a.options : [],
      correctAnswer: a.correct_answer,
      userAnswer: a.user_answer,
      questionNum: a.question_num
    }))
  };
  const grade = getGrade(r.score);

  const circle = document.getElementById('scoreCircle');
  if (r.score >= 85) circle.style.borderColor = 'var(--success)';
  else if (r.score >= 70) circle.style.borderColor = 'var(--primary)';
  else if (r.score >= 55) circle.style.borderColor = 'var(--accent)';
  else circle.style.borderColor = 'var(--danger)';

  document.getElementById('congrats').textContent = r.score >= 70 ? `🎉 Selamat, ${r.user_name}!` : `💪 Tetap semangat, ${r.user_name}!`;
  document.getElementById('scoreNum').textContent = r.score;
  document.getElementById('gradeBadge').textContent = grade.label;
  document.getElementById('gradeBadge').className = `grade-badge ${grade.cls}`;
  document.getElementById('resultTitle').textContent = r.quiz_title;
  document.getElementById('resultMeta').textContent = `Dikerjakan pada ${new Date(r.submitted_at).toLocaleString('id-ID')}`;
  document.getElementById('correctNum').textContent = String(r.correct);
  document.getElementById('wrongNum').textContent = String(r.total - r.correct);
  document.getElementById('timeNum').textContent = formatTime(r.time_taken || 0);

  document.getElementById('reviewList').innerHTML = r.answers.map((a, i) => `
    <div class="review-item" id="review-item-${a.questionNum || i + 1}">
      <div class="review-header">
        <strong style="font-size:0.85rem;">Soal ${i + 1}</strong>
        <span class="review-badge ${a.isCorrect ? 'correct' : 'wrong'}">${a.isCorrect ? '✅ Benar' : '❌ Salah'}</span>
        ${!a.userAnswer ? '<span style="color:var(--text3);font-size:0.8rem;">Tidak dijawab</span>' : ''}
      </div>
      <div class="review-body">
        <p style="margin-bottom:0.8rem;font-weight:500;">${escapeHTML(a.question)}</p>
        <div style="display:flex;flex-direction:column;gap:0.4rem;">
          ${a.options.map((o) => {
            let style = '';
            if (o.key === a.correctAnswer) style = 'color:var(--success);font-weight:600;';
            if (o.key === a.userAnswer && o.key !== a.correctAnswer) style = 'color:var(--danger);text-decoration:line-through;';
            return `<div style="${style};font-size:0.85rem;"><strong>${escapeHTML(o.key)}.</strong> ${escapeHTML(o.text)} ${o.key === a.correctAnswer ? ' ✓' : ''}${o.key === a.userAnswer && o.key !== a.correctAnswer ? ' ✗' : ''}</div>`;
          }).join('')}
        </div>
        ${!a.isCorrect ? `<div style="margin-top:0.6rem;font-size:0.8rem;color:var(--success);">Jawaban benar: <strong>${escapeHTML(a.correctAnswer)}</strong></div>` : ''}
        
        <!-- Tombol AI Pembahasan -->
        <div style="margin-top:1rem;">
          <button
            id="ai-btn-${a.questionNum || i + 1}"
            onclick="explainQuestion(${a.questionNum || i + 1})"
            style="
              display:inline-flex; align-items:center; gap:0.4rem;
              padding:0.4rem 0.9rem; border-radius:8px; border:1px solid var(--primary);
              background:transparent; color:var(--primary); cursor:pointer;
              font-size:0.8rem; font-weight:600; transition:all 0.2s ease;
            "
            onmouseover="this.style.background='var(--primary)';this.style.color='white';"
            onmouseout="this.style.background='transparent';this.style.color='var(--primary)';"
          >
            ✨ Jelaskan dengan AI
          </button>
        </div>
        
        <!-- Area pembahasan AI -->
        <div id="ai-explanation-${a.questionNum || i + 1}" style="display:none; margin-top:1rem;"></div>
      </div>
    </div>
  `).join('');
};

// Fungsi panggil AI pembahasan soal
async function explainQuestion(questionNum) {
  const btn = document.getElementById(`ai-btn-${questionNum}`);
  const explanationEl = document.getElementById(`ai-explanation-${questionNum}`);

  if (!btn || !explanationEl || !_currentAttemptId) return;

  // Tampilkan loading
  btn.disabled = true;
  btn.textContent = '⏳ AI sedang berpikir...';
  explanationEl.style.display = 'block';
  explanationEl.innerHTML = `
    <div style="
      padding:1rem; border-radius:10px;
      border:1px solid var(--border);
      background:linear-gradient(135deg, rgba(99,102,241,0.05), rgba(139,92,246,0.05));
      font-size:0.85rem; color:var(--text2);
      animation: pulse 1.5s ease-in-out infinite;
    ">
      ✨ AI sedang menyiapkan pembahasan...
    </div>
  `;

  try {
    const token = await getAccessToken();
    const res = await fetch('/api/ai/explain-question', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        attempt_id: _currentAttemptId,
        question_number: questionNum
      })
    });

    const data = await res.json();

    if (!res.ok) {
      explanationEl.innerHTML = `
        <div style="
          padding:0.8rem 1rem; border-radius:10px;
          border:1px solid var(--danger);
          background:rgba(239,68,68,0.08);
          font-size:0.85rem; color:var(--danger);
        ">
          ⚠️ ${escapeHTML(data.error || 'Gagal mendapatkan pembahasan. Coba lagi nanti.')}
        </div>
      `;
      btn.disabled = false;
      btn.textContent = '✨ Jelaskan dengan AI';
      return;
    }

    // Tampilkan pembahasan dengan format markdown sederhana
    const formatted = escapeHTML(data.explanation)
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');

    explanationEl.innerHTML = `
      <div style="
        padding:1rem 1.2rem; border-radius:10px;
        border:1px solid rgba(99,102,241,0.3);
        background:linear-gradient(135deg, rgba(99,102,241,0.06), rgba(139,92,246,0.06));
        font-size:0.85rem; line-height:1.7;
      ">
        <div style="
          display:flex; align-items:center; gap:0.5rem;
          margin-bottom:0.8rem; font-weight:700; color:var(--primary);
          font-size:0.8rem; text-transform:uppercase; letter-spacing:0.05em;
        ">
          ✨ Pembahasan AI
          ${data.usage ? `<span style="margin-left:auto; font-weight:400; color:var(--text3); text-transform:none; letter-spacing:0;">${data.usage.used}/${data.usage.limit} hari ini</span>` : ''}
        </div>
        <div style="color:var(--text1);">${formatted}</div>
      </div>
    `;

    // Ganti tombol jadi "Sembunyikan"
    btn.disabled = false;
    btn.textContent = '🙈 Sembunyikan Pembahasan';
    btn.onclick = () => {
      explanationEl.style.display = explanationEl.style.display === 'none' ? 'block' : 'none';
      btn.textContent = explanationEl.style.display === 'none' ? '✨ Tampilkan Pembahasan' : '🙈 Sembunyikan Pembahasan';
    };

  } catch (err) {
    explanationEl.innerHTML = `
      <div style="
        padding:0.8rem 1rem; border-radius:10px;
        border:1px solid var(--danger);
        background:rgba(239,68,68,0.08);
        font-size:0.85rem; color:var(--danger);
      ">
        ⚠️ Koneksi gagal. Pastikan Anda terhubung ke internet dan coba lagi.
      </div>
    `;
    btn.disabled = false;
    btn.textContent = '✨ Jelaskan dengan AI';
  }
}

function toggleReview() {
  const el = document.getElementById('reviewSection');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// --- Auto-exports to window ---
window.getGrade = getGrade;
window.formatTime = formatTime;
window.toggleReview = toggleReview;
window.explainQuestion = explainQuestion;
