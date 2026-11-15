// public/js/pages/dashboard.js

let _allQuizzes = [];
let _currentTab = 'public';
let _selectedCategory = 'Semua';

async function setupDashboard() {
  const user = await requireAuth();
  if (!user) return;

  // Set personalized greeting in hero
  const greetingEl = document.getElementById('welcomeUserTitle');
  const userDisplayName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Mahasiswa';
  if (greetingEl) {
    greetingEl.textContent = `Halo, ${userDisplayName}! 👋`;
  }

  // Set user profile at bottom of sidebar
  const userBox = document.getElementById('sidebarUserBox');
  const userAvatar = document.getElementById('sidebarUserAvatar');
  const userName = document.getElementById('sidebarUserName');
  const userEmail = document.getElementById('sidebarUserEmail');
  if (userBox) {
    userBox.style.display = 'flex';
    if (userAvatar) userAvatar.textContent = userDisplayName.charAt(0).toUpperCase();
    if (userName) userName.textContent = userDisplayName;
    if (userEmail) userEmail.textContent = user.email || '';
  }

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
  const path = window.location.pathname;
  const isPrivatePath = path === '/koleksi';
  
  // Reset active classes
  document.querySelectorAll('.sidebar-btn').forEach(btn => btn.classList.remove('active'));
  _selectedCategory = 'Semua';
  const searchEl = document.getElementById('searchInput');
  if (searchEl) searchEl.value = '';

  if (hash === '#private' || isPrivatePath) {
    _currentTab = 'private';
    const navItem = document.getElementById('navPrivate');
    if (navItem) navItem.classList.add('active');
    
    document.getElementById('pageTitle').textContent = 'Koleksi Pribadi';
    document.getElementById('pageDesc').textContent = 'Daftar paket try out yang kamu buat mandiri lewat Creator Studio.';
    const btnCreate = document.getElementById('btnCreateQuiz');
    if (btnCreate) btnCreate.style.display = 'inline-flex';
    
    await loadPrivateQuizzes();
  } else {
    _currentTab = 'public';
    // Default to Paket Soal
    const navItem = document.querySelector('.sidebar-btn[href="/paket-soal"]');
    if (navItem) navItem.classList.add('active');
    
    document.getElementById('pageTitle').textContent = 'Paket Soal Tersedia';
    document.getElementById('pageDesc').textContent = 'Pilih paket try out di bawah atau gunakan AI Parser untuk latihan dari modul kuliah kamu.';
    const btnCreate = document.getElementById('btnCreateQuiz');
    if (btnCreate) btnCreate.style.display = 'none';

    await loadQuizzes();
  }
}

function updateHeroStats(list) {
  const statQuizzes = document.getElementById('statTotalQuizzes');
  const statQuestions = document.getElementById('statTotalQuestions');
  if (statQuizzes) statQuizzes.textContent = String(list.length);
  if (statQuestions) {
    const totalQ = list.reduce((acc, q) => acc + (Number(q.count) || 0), 0);
    statQuestions.textContent = String(totalQ);
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
    updateHeroStats(_allQuizzes);
    renderCategoryPills(_allQuizzes);
    renderQuizzes(_allQuizzes, false);
  } catch (e) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;" class="empty-state">
        <div class="empty-icon">📭</div>
        <p>Tersedia segera. Admin belum menambahkan paket soal.</p>
      </div>`;
    updateHeroStats([]);
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
    updateHeroStats(_allQuizzes);
    renderCategoryPills(_allQuizzes);
    renderQuizzes(_allQuizzes, true);
  } catch (e) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;" class="empty-state">
        <div class="empty-icon">📭</div>
        <p>Belum ada paket soal buatanmu sendiri.</p>
      </div>`;
    updateHeroStats([]);
  }
}

function renderCategoryPills(list) {
  const container = document.getElementById('categoryPills');
  if (!container) return;

  const subjectCounts = {};
  list.forEach(q => {
    const subj = q.subject || 'Umum';
    subjectCounts[subj] = (subjectCounts[subj] || 0) + 1;
  });

  const subjects = Object.keys(subjectCounts).sort();
  let html = `<button class="category-pill ${_selectedCategory === 'Semua' ? 'active' : ''}" data-category="Semua" onclick="selectCategory('Semua')">Semua (${list.length})</button>`;
  subjects.forEach(subj => {
    const active = _selectedCategory === subj ? 'active' : '';
    html += `<button class="category-pill ${active}" data-category="${escapeHTML(subj)}" onclick="selectCategory('${escapeHTML(subj)}')">${escapeHTML(subj)} (${subjectCounts[subj]})</button>`;
  });

  container.innerHTML = html;
}

function selectCategory(category) {
  _selectedCategory = category;
  document.querySelectorAll('.category-pill').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-category') === category);
  });
  filterQuizzes();
}

function renderQuizzes(list, isPrivate = false) {
  const grid = document.getElementById('quizGrid');
  const countBadge = document.getElementById('quizCountBadge');
  if (countBadge) {
    countBadge.textContent = `${list.length} paket`;
  }

  if (!list.length) {
    const emptyMsg = isPrivate
      ? 'Belum ada paket soal buatanmu sendiri.'
      : 'Tidak ditemukan paket soal yang sesuai dengan pencarian atau filter kategori.';
    grid.innerHTML = `
      <div style="grid-column:1/-1;" class="empty-state">
        <div class="empty-icon">📭</div>
        <p>${emptyMsg}</p>
        ${isPrivate ? '<a href="/creator" class="btn btn-primary" style="margin-top:1rem;">✨ Buat Soal Sekarang</a>' : ''}
      </div>`;
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
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div class="card-tag ${tagColors[i % 3]}">${escapeHTML(q.subject || 'Umum')}</div>
          ${badgeHtml}
        </div>
        <h3 class="card-title" title="${escapeHTML(q.title)}">${escapeHTML(q.title)}</h3>
        <p class="card-desc">${escapeHTML(q.description || 'Paket latihan try out mandiri dan persiapan ujian.')}</p>
      </div>
      <div>
        <div class="card-meta-chips">
          <span class="meta-chip">📝 ${q.count} Soal</span>
          <span class="meta-chip">⏱️ ${q.duration || 60} Menit</span>
        </div>
        ${actionBtnHtml}
      </div>
    </div>
  `}).join('');
}

function filterQuizzes() {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const filtered = _allQuizzes.filter((x) => {
    const matchCat = (_selectedCategory === 'Semua') || ((x.subject || 'Umum') === _selectedCategory);
    const matchQuery = !q || (x.title || '').toLowerCase().includes(q) || (x.subject || '').toLowerCase().includes(q) || (x.description || '').toLowerCase().includes(q);
    return matchCat && matchQuery;
  });
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
window.selectCategory = selectCategory;
window.submitReview = submitReview;
