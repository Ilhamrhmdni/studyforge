// Logic to load some preview quizzes
async function loadPreviewQuizzes(isLoggedIn = false) {
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

    const tagColors = ['', 'purple', 'amber'];
    grid.innerHTML = quizzes.map((q, i) => `
      <div class="card">
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span class="card-tag ${tagColors[i % 3]}">${escapeHTML(q.subject || 'Umum')}</span>
          </div>
          <h3 class="card-title" title="${escapeHTML(q.title)}">${escapeHTML(q.title)}</h3>
          <p class="card-desc">${escapeHTML(q.description || 'Paket latihan try out mandiri dan persiapan ujian.')}</p>
        </div>
        <div>
          <div class="card-meta-chips">
            <span class="meta-chip">📝 ${q.count} Soal</span>
            <span class="meta-chip">⏱️ ${q.duration || 60} Menit</span>
          </div>
          <a href="${isLoggedIn ? `/quiz?id=${escapeHTML(q.id)}&reset=1` : '/masuk'}" class="btn btn-primary" style="width:100%;justify-content:center;">Mulai Kerjakan →</a>
        </div>
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
      navBtn.href = '/paket-soal';
      navBtn.textContent = 'Paket Soal';
    }
    const navSignupBtn = document.getElementById('navSignupBtn');
    if (navSignupBtn) {
      navSignupBtn.style.display = 'none'; // Sembunyikan daftar gratis jika sudah login
    }
    const heroBtn = document.getElementById('heroCtaBtn');
    if (heroBtn) {
      heroBtn.href = '/paket-soal';
      heroBtn.textContent = 'Lanjut Belajar';
    }
    const heroSecondaryBtn = document.getElementById('heroSecondaryBtn');
    if (heroSecondaryBtn) {
      heroSecondaryBtn.href = '/paket-soal';
      heroSecondaryBtn.textContent = 'Buka Paket Soal';
    }
    const bottomBtn = document.getElementById('bottomCtaBtn');
    if (bottomBtn) {
      bottomBtn.href = '/paket-soal';
      bottomBtn.textContent = 'Buka Paket Soal';
    }
    const bottomLoginBtn = document.getElementById('bottomLoginBtn');
    if (bottomLoginBtn) {
      bottomLoginBtn.style.display = 'none';
    }
    const moreBtn = document.getElementById('previewMoreBtn');
    if (moreBtn) {
      moreBtn.href = '/paket-soal';
    }
  }

  
  loadPreviewQuizzes(!!user);
}

setupLandingPage();

// --- Auto-exports to window ---
window.setupLandingPage = setupLandingPage;
window.escapeHTML = escapeHTML;
window.loadPreviewQuizzes = loadPreviewQuizzes;
