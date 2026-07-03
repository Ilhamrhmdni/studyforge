async function loadQuizzes() {
  try {
    const sb = initSupabase();
    const quizRes = await fetch('/api/quizzes');
    const quizPayload = await quizRes.json();
    if (!quizRes.ok) throw new Error(quizPayload.error || 'Gagal memuat quiz.');
    const quizzes = quizPayload.quizzes || [];

    const user = await requireAuth();
    if (!user) return;
    let totalResults = 0;
    const { count, error: countErr } = await sb
        .from('quiz_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);
      if (!countErr) totalResults = count;

    window._allQuizzes = quizzes;
    renderQuizzes(window._allQuizzes);
    updateStats({ quizzes: window._allQuizzes, totalResults });
  } catch (e) {
    document.getElementById('quizGrid').innerHTML = `
      <div style="grid-column:1/-1;" class="empty-state">
        <div class="empty-icon">📭</div>
        <p>Belum ada paket soal tersedia.</p>
      </div>`;
  }
}

function updateStats(data) {
  document.getElementById('totalQuiz').textContent = data.quizzes?.length || 0;
  document.getElementById('totalQ').textContent = data.quizzes?.reduce((a, q) => a + (q.count || 0), 0) || 0;
  document.getElementById('totalResult').textContent = data.totalResults || 0;
}

function renderQuizzes(list, isPrivate = false) {
  const grid = document.getElementById('quizGrid');
  if (!list.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;" class="empty-state"><div class="empty-icon">📭</div><p>Belum ada paket soal.</p></div>`;
    return;
  }
  const tagColors = ['', 'purple', 'amber'];
  
  grid.innerHTML = list.map((q, i) => {
    let badgeHtml = '';
    let actionBtnHtml = `<a href="/quiz?id=${escapeHTML(q.id)}" class="btn btn-primary" style="width:100%;justify-content:center;">Mulai Kerjakan →</a>`;
    
    if (isPrivate) {
      if (q.review_status === 'draft') badgeHtml = `<span style="background:var(--card); color:var(--text2); border:1px solid var(--border); padding:0.2rem 0.5rem; border-radius:4px; font-size:0.75rem;">🔒 Draft</span>`;
      else if (q.review_status === 'pending') badgeHtml = `<span style="background:rgba(234, 179, 8, 0.1); color:#eab308; border:1px solid rgba(234, 179, 8, 0.2); padding:0.2rem 0.5rem; border-radius:4px; font-size:0.75rem;">⏳ Menunggu Review</span>`;
      else if (q.review_status === 'approved') badgeHtml = `<span style="background:rgba(34, 197, 94, 0.1); color:#22c55e; border:1px solid rgba(34, 197, 94, 0.2); padding:0.2rem 0.5rem; border-radius:4px; font-size:0.75rem;">✅ Disetujui (Publik)</span>`;
      else if (q.review_status === 'rejected') badgeHtml = `<span style="background:rgba(239, 68, 68, 0.1); color:#ef4444; border:1px solid rgba(239, 68, 68, 0.2); padding:0.2rem 0.5rem; border-radius:4px; font-size:0.75rem;">❌ Ditolak</span>`;
      
      if (q.review_status === 'draft' || q.review_status === 'rejected') {
        actionBtnHtml += `<button onclick="submitReview('${q.id}')" class="btn btn-outline" style="width:100%; justify-content:center; margin-top:0.5rem;">Ajukan Review Publik</button>`;
        if (q.rejection_reason) {
          actionBtnHtml += `<p style="font-size:0.8rem; color:var(--danger); margin-top:0.5rem;">Alasan ditolak: ${escapeHTML(q.rejection_reason)}</p>`;
        }
      }
    }

    return `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div class="card-tag ${tagColors[i % 3]}">${escapeHTML(q.subject || 'Umum')}</div>
        ${badgeHtml}
      </div>
      <h3 style="margin-top:1rem;">${escapeHTML(q.title)}</h3>
      <p>${escapeHTML(q.description || 'Paket soal latihan interaktif.')}</p>
      <div class="card-meta">
        <span>📝 ${q.count} Soal</span>
        <span>⏱️ ${q.duration || 60} Menit</span>
        <span>📅 ${new Date(q.created_at).toLocaleDateString('id-ID')}</span>
      </div>
      <br/>
      ${actionBtnHtml}
    </div>
  `}).join('');
}

window._currentTab = 'public';

async function switchDashboardTab(tab) {
  window._currentTab = tab;
  document.getElementById('tabPublic').style.color = tab === 'public' ? 'var(--primary)' : 'var(--text2)';
  document.getElementById('tabPublic').style.borderBottom = tab === 'public' ? '2px solid var(--primary)' : 'none';
  document.getElementById('tabPrivate').style.color = tab === 'private' ? 'var(--primary)' : 'var(--text2)';
  document.getElementById('tabPrivate').style.borderBottom = tab === 'private' ? '2px solid var(--primary)' : 'none';
  
  document.getElementById('quizGrid').innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:3rem;"><div class="loader" style="margin:0 auto 1rem;width:32px;height:32px;"></div>Memuat...</div>`;
  
  if (tab === 'public') {
    await loadQuizzes();
  } else {
    await loadPrivateQuizzes();
  }
}

async function loadPrivateQuizzes() {
  try {
    const user = await requireAuth();
    
    const token = localStorage.getItem('sf_token');
    const res = await fetch('/api/user/quizzes', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error);
    
    window._allQuizzes = payload.quizzes || [];
    renderQuizzes(window._allQuizzes, true);
  } catch (e) {
    document.getElementById('quizGrid').innerHTML = `
      <div style="grid-column:1/-1;" class="empty-state">
        <div class="empty-icon">📭</div>
        <p>Belum ada paket soal buatanmu sendiri.</p>
      </div>`;
  }
}

function filterQuizzes() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  const filtered = (window._allQuizzes || []).filter((x) =>
    (x.title || '').toLowerCase().includes(q) || (x.subject || '').toLowerCase().includes(q)
  );
  renderQuizzes(filtered, window._currentTab === 'private');
}

function submitReview(quizId) {
  if (!confirm('Ajukan kuis ini ke Admin agar bisa diakses semua orang?')) return;
  const token = localStorage.getItem('sf_token');
  fetch('/api/user/submit-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ quiz_id: quizId })
  }).then(r => r.json()).then(res => {
    if (res.error) return alert(res.error);
    alert('Berhasil diajukan!');
    loadPrivateQuizzes();
  });
}

async function loadHistory() {
  const user = await requireAuth();
  if (!user) return; // requireAuth will redirect


  try {
    const sb = initSupabase();
    const { data, error } = await sb.from('quiz_attempts')
      .select('id, quiz_title, score, correct, total, time_taken, submitted_at')
      .eq('user_id', user.id)
      .order('submitted_at', { ascending: false })
      .limit(4);

    if (error) throw error;

    if (data && data.length > 0) {
      document.getElementById('history-section').style.display = 'block';
      document.getElementById('historyGrid').innerHTML = data.map((h) => `
        <div style="border: 1px solid var(--border); border-left: 3px solid var(--primary); border-radius: 8px; padding: 1rem; background: var(--bg);">
          <h4 style="font-size:0.95rem; margin-bottom:0.3rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(h.quiz_title)}</h4>
          <div style="color:var(--text2); font-size:0.75rem; margin-bottom:0.8rem;">
            📅 ${new Date(h.submitted_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.8rem;">
            <div style="font-size:1.2rem; font-weight:800; color:${h.score >= 70 ? 'var(--success)' : 'var(--danger)'};">${h.score} <span style="font-size:0.7rem; color:var(--text3); font-weight:500;">Nilai</span></div>
            <div style="font-size:0.75rem; color:var(--text2); text-align:right;">✅ ${h.correct} / ${h.total} Benar</div>
          </div>
          <a href="/result?id=${h.id}" class="btn btn-outline" style="width:100%; justify-content:center; padding:0.4rem; font-size:0.8rem;">📖 Review</a>
        </div>
      `).join('');
    } else {
      document.getElementById('history-section').style.display = 'block';
      document.getElementById('historyGrid').innerHTML = '<p style="color:var(--text3); font-size:0.85rem; text-align:center; padding: 2rem 0;">Belum ada riwayat ujian.<br>Kerjakan soal untuk melihat evaluasi.</p>';
    }
  } catch (e) {
    console.error('History load error:', e);
  }
}

updateNavForUser();
loadHistory();
loadQuizzes();

// --- Auto-exports to window ---
window.loadHistory = loadHistory;
window.submitReview = submitReview;
window.switchDashboardTab = switchDashboardTab;
window.renderQuizzes = renderQuizzes;
window.loadPrivateQuizzes = loadPrivateQuizzes;
window.loadQuizzes = loadQuizzes;
window.updateStats = updateStats;
window.filterQuizzes = filterQuizzes;
