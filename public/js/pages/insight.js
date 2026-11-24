// public/js/pages/insight.js

async function setupInsight() {
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

  await loadUserInsights();
}

async function loadUserInsights() {
  const wList = document.getElementById('weaknessList');
  const rList = document.getElementById('recommendationList');

  try {
    const token = await getAccessToken();
    if (!token) return;

    // Fetch weaknesses
    const weakRes = await fetch('/api/user/insight-weaknesses', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const weakData = await weakRes.json();

    // Fetch recommendations
    const recRes = await fetch('/api/user/insight-recommendations', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const recData = await recRes.json();

    if (weakData.error || recData.error) throw new Error(weakData.error || recData.error);

    // 1. Render Weaknesses
    if (weakData.empty) {
      wList.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text3);font-size:0.9rem;">
        <div style="font-size:3rem; margin-bottom:1rem; opacity:0.4;">📊</div>
        Belum cukup data untuk analisis. Kerjakan beberapa quiz agar StudyForge bisa membaca pola belajarmu.
      </div>`;
    } else {
      wList.innerHTML = weakData.items.map(w => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:1.2rem; border-bottom:1px solid rgba(255,255,255,0.05);">
          <div>
            <div style="font-weight:600; font-size:1.05rem; margin-bottom:0.2rem;">${escapeHTML(w.subject)}</div>
            <div style="font-size:0.8rem; color:var(--text2);">Total dijawab: ${w.total_answered} soal</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:1.4rem; font-weight:800; color:var(--danger);">${Math.round(w.accuracy_rate * 100)}%</div>
            <div style="font-size:0.75rem; color:var(--text3);">Akurasi</div>
          </div>
        </div>
      `).join('');
    }

    // 2. Render Recommendations
    if (!recData.items || recData.items.length === 0) {
      rList.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text3);font-size:0.9rem;">
        <div style="font-size:3rem; margin-bottom:1rem; opacity:0.4;">🎯</div>
        Belum ada rekomendasi latihan saat ini.
      </div>`;
    } else {
      let subjectLabel = recData.weakest_subject ? `<span style="background:var(--primary); color:#fff; padding:0.2rem 0.6rem; border-radius:4px; font-size:0.75rem; font-weight:600;">Fokus: ${escapeHTML(recData.weakest_subject)}</span>` : '';
      
      rList.innerHTML = recData.items.map(r => `
        <div style="padding:1.2rem; border-bottom:1px solid rgba(255,255,255,0.05); display:flex; flex-direction:column; gap:0.8rem;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <div style="font-weight:600; font-size:1.05rem; margin-bottom:0.3rem;">${escapeHTML(r.title)}</div>
              <div style="font-size:0.85rem; color:var(--text2);">${escapeHTML(r.description || 'Latihan soal khusus untukmu.')}</div>
            </div>
            ${subjectLabel}
          </div>
          <a href="/quiz?id=${escapeHTML(r.id)}&reset=1" class="btn btn-outline" style="padding:0.5rem 1rem; font-size:0.9rem; width:fit-content; margin-top:0.5rem;">Kerjakan Sekarang →</a>
        </div>
      `).join('');
    }

  } catch (err) {
    console.error('Failed to load insights:', err);
    wList.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--danger);">Gagal memuat insight: ${escapeHTML(err.message)}</div>`;
    rList.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--danger);">Gagal memuat rekomendasi.</div>`;
  }
}

setupInsight();
