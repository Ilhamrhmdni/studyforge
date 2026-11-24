// public/js/pages/history.js

async function setupHistory() {
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

  await loadHistory();
}

async function loadHistory() {
  const user = await requireAuth();
  if (!user) return; 

  const grid = document.getElementById('historyGrid');

  try {
    const sb = initSupabase();
    const { data, error } = await sb.from('quiz_attempts')
      .select('id, quiz_title, score, correct, total, time_taken, submitted_at')
      .eq('user_id', user.id)
      .order('submitted_at', { ascending: false });

    if (error) throw error;

    if (data && data.length > 0) {
      grid.innerHTML = data.map((h) => `
        <div style="border: 1px solid var(--border); border-left: 4px solid var(--primary); border-radius: 8px; padding: 1.5rem; background: var(--bg); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
          <div style="flex:1; min-width:200px;">
            <h4 style="font-size:1.1rem; margin-bottom:0.4rem;">${escapeHTML(h.quiz_title)}</h4>
            <div style="color:var(--text2); font-size:0.85rem;">
              📅 ${new Date(h.submitted_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          <div style="display:flex; gap:2rem; align-items:center;">
            <div style="text-align:right;">
              <div style="font-size:1.5rem; font-weight:800; color:${h.score >= 70 ? 'var(--success)' : 'var(--danger)'};">${h.score}</div>
              <div style="font-size:0.75rem; color:var(--text3); font-weight:500;">Skor Akhir</div>
            </div>
            <div style="text-align:right; color:var(--text2); font-size:0.85rem;">
              ✅ ${h.correct} / ${h.total} Benar
            </div>
            <a href="/result?id=${h.id}" class="btn btn-outline" style="padding:0.5rem 1rem; font-size:0.9rem;">Review Jawaban</a>
          </div>
        </div>
      `).join('');
    } else {
      grid.innerHTML = `<div style="text-align:center;padding:4rem;color:var(--text3);font-size:0.95rem;">
        <div style="font-size:3rem; margin-bottom:1rem; opacity:0.4;">🕒</div>
        Belum ada riwayat ujian.<br>Kerjakan soal untuk melihat evaluasimu di sini.
      </div>`;
    }
  } catch (e) {
    console.error('History load error:', e);
    grid.innerHTML = `<div style="text-align:center;padding:4rem;color:var(--danger);">Gagal memuat riwayat.</div>`;
  }
}

setupHistory();
