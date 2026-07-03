// Logic to load some preview quizzes
async function loadPreviewQuizzes() {
  const grid = document.getElementById('previewQuizGrid');
  try {
    const res = await fetch('/api/quizzes');
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error || 'Gagal memuat');
    
    // Ambil maksimal 3 soal aja buat preview
    const quizzes = (payload.quizzes || []).slice(0, 3);
    
    if (quizzes.length === 0) {
      grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text3);">Belum ada soal tersedia.</p>';
      return;
    }

    grid.innerHTML = quizzes.map(q => `
      <div class="card quiz-card">
        <div class="card-header">
          <span class="subject-badge">${escapeHTML(q.subject)}</span>
        </div>
        <h3 class="quiz-title">${escapeHTML(q.title)}</h3>
        <p class="quiz-desc">${escapeHTML(q.description || 'Paket soal latihan interaktif.')}</p>
        <div class="quiz-meta">
          <span>📝 ${q.count} Soal</span>
          <span>⏱️ ${q.duration} Menit</span>
        </div>
        <a href="/login.html" class="btn btn-primary w-100" style="margin-top:1rem;text-align:center;">Mulai Kerjakan &rarr;</a>
      </div>
    `).join('');
  } catch(e) {
    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--text3);font-size:0.95rem;">Paket soal sedang dimuat. Silakan masuk ke dashboard untuk melihat koleksi lengkap.</p>';
  }
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[tag]));
}

// Cek apakah user udah login
async function setupLandingPage() {
  const user = await checkUserAuth();
  if (user) {
    // Kalo udah login, ganti semua CTA ngarah ke Dashboard
    const navBtn = document.getElementById('navLoginBtn');
    if (navBtn) {
      navBtn.href = '/dashboard.html';
      navBtn.textContent = 'Dashboard';
    }
    const navSignupBtn = document.getElementById('navSignupBtn');
    if (navSignupBtn) {
      navSignupBtn.style.display = 'none'; // Sembunyikan daftar gratis jika sudah login
    }
    const heroBtn = document.getElementById('heroCtaBtn');
    if (heroBtn) {
      heroBtn.href = '/dashboard.html';
      heroBtn.textContent = 'Lanjut Belajar';
    }
    const heroSecondaryBtn = document.getElementById('heroSecondaryBtn');
    if (heroSecondaryBtn) {
      heroSecondaryBtn.href = '/dashboard.html';
      heroSecondaryBtn.textContent = 'Buka Dashboard';
    }
    const bottomBtn = document.getElementById('bottomCtaBtn');
    if (bottomBtn) {
      bottomBtn.href = '/dashboard.html';
      bottomBtn.textContent = 'Buka Dashboard';
    }
    const bottomLoginBtn = document.getElementById('bottomLoginBtn');
    if (bottomLoginBtn) {
      bottomLoginBtn.style.display = 'none';
    }
    const moreBtn = document.getElementById('previewMoreBtn');
    if (moreBtn) {
      moreBtn.href = '/dashboard.html';
    }
  }

  
  loadPreviewQuizzes();
}

setupLandingPage();

// --- Auto-exports to window ---
window.setupLandingPage = setupLandingPage;
window.escapeHTML = escapeHTML;
window.loadPreviewQuizzes = loadPreviewQuizzes;
