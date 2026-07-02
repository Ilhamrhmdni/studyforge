// ── STUDYFORGE SITE CONFIG ────────────────────────────────────────────────────
// Konfigurasi publik yang dibaca oleh semua halaman (index, quiz, admin).
// Anon key aman untuk ditaruh di sini — tidak bisa digunakan untuk write/delete data
// karena diproteksi Row Level Security (RLS) di Supabase.

const SITE_CONFIG = {
  // ── Supabase Database ──
  supabaseUrl:        'https://wsmclqrqfhrzysxgmfdj.supabase.co',
  supabaseAnonKey:    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzbWNscXJxZmhyenlzeGdtZmRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjkwOTUsImV4cCI6MjA5ODI0NTA5NX0.l1lne-ZObuFd0gu9PbWz9rRm7e6y8V3KXgDTTxD8atE',

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
