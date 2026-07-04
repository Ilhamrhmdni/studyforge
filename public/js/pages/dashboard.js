// public/js/pages/dashboard.js

let _allQuizzes = [];
let _currentTab = 'public';

async function setupDashboard() {
  const user = await requireAuth();
  if (!user) return;

  // Cek admin role
  const sb = initSupabase();
  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (profile && profile.role === 'admin') {
    const adminLink = document.getElementById('navAdmin');
    if (adminLink) adminLink.style.display = 'flex';
  }

  // Setup mobile menu
  const menuBtn = document.getElementById('mobileMenuBtn');
  const sidebar = document.getElementById('appSidebar');
  if (menuBtn && sidebar) {
    menuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });
  }

  // Cek hash untuk navigasi tab
  window.addEventListener('hashchange', handleHashNav);
  handleHashNav();
}

async function handleHashNav() {
  const hash = window.location.hash;
  
  // Reset active classes
  document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('active'));
  
  if (hash === '#private') {
    _currentTab = 'private';
    const navItem = document.getElementById('navPrivate');
    if (navItem) navItem.classList.add('active');
    
    document.getElementById('pageTitle').textContent = 'Koleksi Pribadi';
    document.getElementById('pageDesc').textContent = 'Daftar paket soal yang kamu buat sendiri.';
    const btnCreate = document.getElementById('btnCreateQuiz');
    if (btnCreate) btnCreate.style.display = 'inline-flex';
    
    await loadPrivateQuizzes();
  } else {
    _currentTab = 'public';
    // Default to Paket Soal
    const navItem = document.querySelector('.sidebar-btn[href="/dashboard.html"]');
    if (navItem) navItem.classList.add('active');
    
    document.getElementById('pageTitle').textContent = 'Paket Soal Tersedia';
    document.getElementById('pageDesc').textContent = 'Telusuri koleksi try out dan latihan yang siap dikerjakan.';
    const btnCreate = document.getElementById('btnCreateQuiz');
    if (btnCreate) btnCreate.style.display = 'none';

    await loadQuizzes();
  }
}

async function loadQuizzes() {
  const grid = document.getElementById('quizGrid');
  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:4rem;"><div class="loader" style="margin:0 auto 1rem;width:32px;height:32px;"></div><p>Memuat paket soal...</p></div>`;
  
  try {
    const res = await fetch('/api/quizzes');
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Gagal memuat quiz.');
    
    _allQuizzes = payload.quizzes || [];
    renderQuizzes(_allQuizzes, false);
  } catch (e) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;" class="empty-state">
        <div class="empty-icon">📭</div>
        <p>Tersedia segera. Admin belum menambahkan paket soal.</p>
      </div>`;
  }
}

async function loadPrivateQuizzes() {
  const grid = document.getElementById('quizGrid');
  grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:4rem;"><div class="loader" style="margin:0 auto 1rem;width:32px;height:32px;"></div><p>Memuat koleksi...</p></div>`;
  
  try {
    const token = await getAccessToken();
    const res = await fetch('/api/user/quizzes', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error);
    
    _allQuizzes = payload.quizzes || [];
    renderQuizzes(_allQuizzes, true);
  } catch (e) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;" class="empty-state">
        <div class="empty-icon">📭</div>
        <p>Belum ada paket soal buatanmu sendiri.</p>
      </div>`;
  }
}

function renderQuizzes(list, isPrivate = false) {
  const grid = document.getElementById('quizGrid');
  if (!list.length) {
    const emptyMsg = isPrivate ? 'Belum ada paket soal buatanmu sendiri.' : 'Tersedia segera. Admin belum menambahkan paket soal.';
    grid.innerHTML = `<div style="grid-column:1/-1;" class="empty-state"><div class="empty-icon">📭</div><p>${emptyMsg}</p></div>`;
    return;
  }
  
  const tagColors = ['', 'purple', 'amber'];
  
  grid.innerHTML = list.map((q, i) => {
    let badgeHtml = '';
    let actionBtnHtml = `<a href="/quiz?id=${escapeHTML(q.id)}&reset=1" class="btn btn-primary" style="width:100%;justify-content:center;">Mulai Kerjakan →</a>`;
    
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
      </div>
      <br/>
      ${actionBtnHtml}
    </div>
  `}).join('');
}

function filterQuizzes() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  const filtered = _allQuizzes.filter((x) =>
    (x.title || '').toLowerCase().includes(q) || (x.subject || '').toLowerCase().includes(q)
  );
  renderQuizzes(filtered, _currentTab === 'private');
}

async function submitReview(quizId) {
  if (!confirm('Ajukan kuis ini ke Admin agar bisa diakses semua orang?')) return;
  const token = await getAccessToken();
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

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag]));
}

setupDashboard();

window.filterQuizzes = filterQuizzes;
window.submitReview = submitReview;
