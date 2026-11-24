// Admin management tabs: Manage Quizzes, Results, UGC, Analytics, Bug Reports, Insight.
import { adminApiFetch } from './admin-state.js';

export function switchTab(name, el) {
  document.querySelectorAll('.sidebar-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');

  const loaders = {
    manage: loadManage,
    results: loadResults,
    'bug-reports': loadBugReports,
    ugc: loadUGC,
    analytics: loadAnalytics,
    insight: loadInsight
  };
  if (loaders[name]) loaders[name]();
}

let _manageQuizzesMap = new Map();

export async function loadManage() {
  const el = document.getElementById('manageList');
  try {
    const payload = await adminApiFetch('/api/admin/quizzes');
    const data = payload.quizzes || [];
    _manageQuizzesMap = new Map(data.map((q) => [String(q.id), q]));
    if (!data.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">💭</div><p>Belum ada paket soal.</p></div>';
      return;
    }
    el.innerHTML = data.map((q) => `
      <div class="quiz-list-row" style="${q.is_hidden ? 'opacity: 0.6;' : ''}">
        <div class="name">
          ${q.is_hidden ? '🔒 [HIDDEN] ' : ''}${escapeHTML(q.title)}
        </div>
        <div class="meta">${escapeHTML(q.subject)} • ${q.count} soal${q.is_draft ? ' • Draft' : ''}</div>
        <button class="btn btn-outline" style="font-size:0.8rem;padding:0.3rem 0.8rem;" onclick="editQuizInfo('${escapeHTML(q.id)}')">✏️ Edit</button>
        <button class="btn btn-outline" style="font-size:0.8rem;padding:0.3rem 0.8rem;" onclick="toggleQuizVisibility('${escapeHTML(q.id)}', ${!!q.is_hidden})">${q.is_hidden ? '👁️ Tampilkan' : '🙈 Sembunyikan'}</button>
        <a href="/quiz?id=${encodeURIComponent(q.id)}" class="btn btn-outline" style="font-size:0.8rem;padding:0.3rem 0.8rem;">Preview</a>
        <button class="del-quiz-btn" onclick="deleteQuiz('${escapeHTML(q.id)}')">🗑️ Hapus</button>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = `<p style="color:var(--danger);padding:1rem;">Gagal memuat: ${escapeHTML(e.message)}</p>`;
  }
}

export async function editQuizInfo(id) {
  const existing = _manageQuizzesMap.get(String(id));
  const oldTitle = existing?.title || '';
  const oldSubject = existing?.subject || 'Umum';
  const newTitle = prompt('Ubah Judul Paket Soal:', oldTitle);
  if (newTitle === null) return;
  const newSubject = prompt('Ubah Mata Pelajaran:', oldSubject);
  if (newSubject === null) return;

  if (!newTitle.trim() || !newSubject.trim()) {
    alert('Judul dan Mata Pelajaran tidak boleh kosong.');
    return;
  }

  try {
    await adminApiFetch('/api/admin/quizzes', {
      method: 'PATCH',
      body: { id, title: newTitle.trim(), subject: newSubject.trim() }
    });
    showToast('Info paket soal berhasil diubah', 'success');
    loadManage();
  } catch (e) {
    console.error('editQuiz error:', e);
    alert(`Gagal mengubah info: ${e.message}`);
  }
}

export async function toggleQuizVisibility(id, currentlyHidden) {
  const newHiddenStatus = !currentlyHidden;
  const actionText = newHiddenStatus ? 'Sembunyikan' : 'Tampilkan';
  if (!confirm(`Yakin ingin ${actionText} paket soal ini dari murid?`)) return;

  try {
    await adminApiFetch('/api/admin/quizzes', {
      method: 'PATCH',
      body: { id, is_hidden: newHiddenStatus }
    });
    showToast(`Paket soal berhasil di-${actionText}`, 'success');
    loadManage();
  } catch (e) {
    console.error('toggle visibility error:', e);
    alert(`Gagal mengubah visibilitas: ${e.message}`);
  }
}

export async function deleteQuiz(id) {
  if (!confirm('Hapus paket soal ini? Tindakan ini tidak bisa dibatalkan.')) return;
  try {
    await adminApiFetch(`/api/admin/quizzes?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast('Paket soal dihapus', 'success');
    loadManage();
  } catch (e) {
    console.error('deleteQuiz error:', e);
    alert(`Gagal hapus: ${e.message}`);
  }
}

export async function loadResults() {
  const el = document.getElementById('resultsList');
  try {
    const payload = await adminApiFetch('/api/admin/results');
    const results = payload.results || [];
    if (!results.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><p>Belum ada hasil ujian.</p></div>';
      return;
    }

    el.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
        <thead><tr style="border-bottom:1px solid var(--border);color:var(--text2);">
          <th style="padding:0.8rem;text-align:left;">Nama</th>
          <th style="padding:0.8rem;text-align:left;">Paket Soal</th>
          <th style="padding:0.8rem;text-align:center;">Nilai</th>
          <th style="padding:0.8rem;text-align:center;">Benar</th>
          <th style="padding:0.8rem;text-align:right;">Waktu</th>
          <th style="padding:0.8rem;text-align:center;">Aksi</th>
        </tr></thead>
        <tbody>${results.map((r) => `
          <tr style="border-bottom:1px solid var(--border);">
            <td style="padding:0.8rem;font-weight:600;">${escapeHTML(r.full_name || r.email || 'Anonim')}</td>
            <td style="padding:0.8rem;color:var(--text2);">${escapeHTML(r.quiz_title || '-')}</td>
            <td style="padding:0.8rem;text-align:center;"><span style="background:rgba(79,142,247,0.1);color:var(--primary);padding:0.2rem 0.6rem;border-radius:50px;font-weight:700;">${r.score}%</span></td>
            <td style="padding:0.8rem;text-align:center;">${r.correct}/${r.total}</td>
            <td style="padding:0.8rem;text-align:right;color:var(--text3);">${new Date(r.submitted_at).toLocaleString('id-ID')}</td>
            <td style="padding:0.8rem;text-align:center;">
              <button class="del-quiz-btn" onclick="deleteResult('${r.id}')">🗑️</button>
            </td>
          </tr>
        `).join('')}</tbody>
      </table>`;
  } catch (e) {
    el.innerHTML = `<p style="color:var(--danger);padding:1rem;">${escapeHTML(e.message)}</p>`;
  }
}

export async function deleteResult(id) {
  if (!confirm('Hapus hasil ujian ini?')) return;
  try {
    await adminApiFetch(`/api/admin/results?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast('Hasil ujian dihapus', 'success');
    loadResults();
  } catch (e) {
    console.error('deleteResult error:', e);
    alert(`Error: ${e.message}`);
  }
}

export async function loadUGC() {
  const el = document.getElementById('ugcList');
  el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text3);">Memuat...</div>';
  try {
    const payload = await adminApiFetch('/api/admin/ugc-submissions');
    const quizzes = payload.quizzes || [];
    if (!quizzes.length) {
      el.innerHTML = '<div class="empty-state"><p>Tidak ada pengajuan kuis baru.</p></div>';
      return;
    }
    el.innerHTML = quizzes.map((q) => `
      <div class="quiz-list-row">
        <div class="name">${escapeHTML(q.title)} <span style="font-size:0.8rem; color:var(--text2); font-weight:normal;">(${q.count} soal)</span>
        <br><span style="font-size:0.8rem; color:var(--primary);">Oleh: ${escapeHTML(q.profiles?.full_name || 'Anonim')}</span></div>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <a href="/quiz?id=${encodeURIComponent(q.id)}" target="_blank" class="btn btn-outline" style="text-decoration:none;padding:0.4rem 0.8rem;font-size:0.82rem;">Preview</a>
          <button class="btn btn-primary" style="padding:0.4rem 0.8rem;font-size:0.82rem;" onclick="approveUGC('${q.id}')">Setujui</button>
          <button class="btn btn-outline" style="padding:0.4rem 0.8rem;font-size:0.82rem;" onclick="rejectUGC('${q.id}')">Tolak</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = '';
    const p = document.createElement('p');
    p.style.color = 'red';
    p.textContent = `Error: ${e.message || 'Gagal memuat UGC.'}`;
    el.appendChild(p);
  }
}

export async function approveUGC(id) {
  if (!confirm('Setujui kuis ini? (Akan menjadi publik)')) return;
  try {
    await adminApiFetch('/api/admin/approve-quiz', { method: 'POST', body: { quiz_id: id } });
    alert('Disetujui!');
    loadUGC();
  } catch (e) {
    alert(e.message);
  }
}

export async function rejectUGC(id) {
  const reason = prompt('Alasan penolakan?');
  if (reason === null) return;
  try {
    await adminApiFetch('/api/admin/reject-quiz', { method: 'POST', body: { quiz_id: id, reason } });
    alert('Ditolak!');
    loadUGC();
  } catch (e) {
    alert(e.message);
  }
}

export async function loadAnalytics() {
  try {
    const payload = await adminApiFetch('/api/admin/parser-analytics');
    const m = payload.metrics;
    if (!m) return;
    document.getElementById('an_total').textContent = m.total_processed || 0;
    document.getElementById('an_success').textContent = m.total_success || 0;
    document.getElementById('an_avg').textContent = m.avg_questions || 0;
    document.getElementById('an_fail').textContent = m.total_failed || 0;

    document.getElementById('an_errors').innerHTML =
      (m.top_errors || []).map((e) => `<div>• ${escapeHTML(e[0])}: <strong>${e[1]}</strong> kali</div>`).join('') ||
      'Belum ada error.';
    document.getElementById('an_feedback').innerHTML =
      (m.top_feedback || []).map((f) => `<div>• ${escapeHTML(f[0])}: <strong>${f[1]}</strong> kali</div>`).join('') ||
      'Belum ada feedback.';
  } catch (e) {
    console.error(e);
  }
}

export async function loadBugReports() {
  const el = document.getElementById('bugReportsList');
  if (!el) return;
  try {
    const payload = await adminApiFetch('/api/admin/bug-reports');
    const reports = payload.reports || [];
    if (!reports.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-icon">🐞</div><p>Belum ada laporan bug.</p></div>';
      return;
    }

    el.innerHTML = reports.map((report) => `
      <div style="border:1px solid var(--border);border-radius:14px;padding:1rem 1rem 0.9rem;background:rgba(255,255,255,0.02);margin-bottom:1rem;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;margin-bottom:0.8rem;">
          <div>
            <div style="font-weight:700;font-size:1rem;">${escapeHTML(report.reporter_name || report.reporter_email || 'User')}</div>
            <div style="font-size:0.85rem;color:var(--text2);">${escapeHTML(report.reporter_email || '-')}</div>
          </div>
          <div style="text-align:right;font-size:0.8rem;color:var(--text2);">
            <div>${new Date(report.created_at).toLocaleString('id-ID')}</div>
            <div>${escapeHTML(report.quiz_title || report.quiz_id || 'Quiz tidak diketahui')}</div>
            <div>Soal ${escapeHTML(String(report.question_num || '-'))}</div>
          </div>
        </div>
        <div style="white-space:pre-wrap;line-height:1.65;margin-bottom:0.85rem;">${escapeHTML(report.message || '')}</div>
        ${report.screenshot_data_url ? `<div style="margin-bottom:0.85rem;"><img src="${report.screenshot_data_url}" alt="Screenshot bug" style="max-width:100%;max-height:280px;border-radius:8px;border:1px solid var(--border);object-fit:contain;" /></div>` : ''}
        ${report.page_url ? `<div style="font-size:0.8rem;color:var(--text2);margin-bottom:0.8rem;word-break:break-all;"><strong>URL:</strong> ${escapeHTML(report.page_url)}</div>` : ''}
        <div style="display:flex;justify-content:flex-end;">
          <button class="del-quiz-btn" onclick="deleteBugReport('${report.id}')">Hapus</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = `<p style="color:var(--danger);padding:1rem;">${escapeHTML(e.message)}</p>`;
  }
}

export async function deleteBugReport(id) {
  if (!confirm('Hapus laporan bug ini?')) return;
  try {
    await adminApiFetch(`/api/admin/bug-reports?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    showToast('Laporan bug dihapus', 'success');
    loadBugReports();
  } catch (e) {
    alert(`Gagal hapus laporan bug: ${e.message}`);
  }
}

export async function loadInsight() {
  const list = document.getElementById('insightList');
  list.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text3);">Memuat insight...</td></tr>';

  try {
    const data = await adminApiFetch('/api/admin/insight-questions');
    const summary = data.summary || {};

    document.getElementById('ins_total').textContent = summary.total_questions || 0;
    document.getElementById('ins_prob').textContent = summary.problematic || 0;
    document.getElementById('ins_hard').textContent = summary.hard || 0;
    document.getElementById('ins_med').textContent = summary.medium || 0;
    document.getElementById('ins_easy').textContent = summary.easy || 0;

    const items = data.items || [];
    if (!items.length) {
      list.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--text3);">Belum ada data insight yang cukup.</td></tr>';
      return;
    }

    const statusBadgeMap = {
      Bermasalah: '<span style="color:var(--danger);font-weight:600;">⚠️ Bermasalah</span>',
      Sulit: '<span style="color:var(--warning);">Sulit</span>',
      Sedang: '<span style="color:var(--text);">Sedang</span>',
      Mudah: '<span style="color:var(--success);">Mudah</span>'
    };

    list.innerHTML = items.map((q) => {
      const statusHtml = statusBadgeMap[q.status] || '<span style="color:var(--text3);">Data Kurang</span>';
      const rateStr = q.status === 'Data Kurang' ? '-' : `${Math.round(q.correct_rate * 100)}%`;
      return `
        <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
          <td style="padding:0.8rem;">${escapeHTML(q.quiz_title)}<br><small style="color:var(--text3);">${escapeHTML(q.quiz_id)}</small></td>
          <td style="padding:0.8rem;">${escapeHTML(q.subject || '-')}</td>
          <td style="padding:0.8rem;"><strong>${q.question_num}</strong></td>
          <td style="padding:0.8rem;">${q.total_attempts}x</td>
          <td style="padding:0.8rem;">${rateStr}</td>
          <td style="padding:0.8rem;">${statusHtml}</td>
        </tr>`;
    }).join('');
  } catch (err) {
    list.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--danger);">Gagal memuat insight: ${escapeHTML(err.message)}</td></tr>`;
  }
}
