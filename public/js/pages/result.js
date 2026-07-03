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
      userAnswer: a.user_answer
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
  document.getElementById('correctNum').textContent = r.correct;
  document.getElementById('wrongNum').textContent = r.total - r.correct;
  document.getElementById('timeNum').textContent = formatTime(r.time_taken || 0);

  document.getElementById('reviewList').innerHTML = r.answers.map((a, i) => `
    <div class="review-item">
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
      </div>
    </div>
  `).join('');
};

function toggleReview() {
  const el = document.getElementById('reviewSection');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// --- Auto-exports to window ---
window.getGrade = getGrade;
window.formatTime = formatTime;
window.toggleReview = toggleReview;
