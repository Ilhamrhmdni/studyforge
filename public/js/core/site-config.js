// ── STUDYFORGE SITE CONFIG ────────────────────────────────────────────────────
// Konfigurasi publik yang dibaca oleh semua halaman (index, quiz, admin).
// Anon key aman untuk ditaruh di sini — tidak bisa digunakan untuk write/delete data
// karena diproteksi Row Level Security (RLS) di Supabase.

const SITE_CONFIG = {
  // ── Supabase Database ──
  supabaseUrl:        'https://seklyplqvawnnajzlpgm.supabase.co',
  supabaseAnonKey:    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNla2x5cGxxdmF3bm5hanpscGdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ3MjA4NTEsImV4cCI6MjExMDI5Njg1MX0.bDByOIADiLvCqAPD9rPrqpn8G4ZnXTcJS0hgZ2EA8bI',

  // ── App Info ──
  siteName:    'StudyForge',
  siteTagline: 'Platform Latihan Soal Terbaik',
};

function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

// --- Auto-exports to window ---
window.escapeHTML = escapeHTML;
