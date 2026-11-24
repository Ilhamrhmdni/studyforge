// ── AUTHENTICATION ENGINE ───────────────────────────────────────────────────
// Handles Supabase Auth client initialization and session management.

let supabaseClient = null;

function initSupabase() {
  if (supabaseClient) return supabaseClient;
  if (typeof supabase === 'undefined') {
    console.warn('Supabase JS library not loaded.');
    return null;
  }
  const { supabaseUrl, supabaseAnonKey } = SITE_CONFIG;
  supabaseClient = supabase.createClient(supabaseUrl, supabaseAnonKey);
  return supabaseClient;
}

async function checkUserAuth() {
  const sb = initSupabase();
  if (!sb) return null;
  const { data: { session } } = await sb.auth.getSession();
  return session ? session.user : null;
}

async function getAccessToken() {
  const sb = initSupabase();
  if (!sb) return '';
  const { data: { session } } = await sb.auth.getSession();
  return session?.access_token || '';
}

async function requireAuth() {
  const user = await checkUserAuth();
  if (!user) {
    sessionStorage.setItem('sf_redirect', window.location.href);
    window.location.href = '/masuk';
    return null;
  }
  return user;
}

async function logoutUser() {
  const sb = initSupabase();
  if (sb) await sb.auth.signOut();
  window.location.href = '/';
}

// ── UI HELPERS ──
window.toggleUserDropdown = function() {
  const dropdown = document.getElementById('userDropdownContent');
  if (dropdown) dropdown.classList.toggle('show');
};
window.toggleMobileNav = function() {
  const navLinks = document.querySelector('.nav-links');
  if (navLinks) navLinks.classList.toggle('show');
};

async function updateNavForUser() {
  const user = await checkUserAuth();
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;
  
  // Add hamburger if not exists
  const nav = document.querySelector('.navbar');
  if (nav && !document.getElementById('mobileHamburger')) {
    const hamburger = document.createElement('button');
    hamburger.id = 'mobileHamburger';
    hamburger.className = 'hamburger-btn';
    hamburger.innerHTML = '☰';
    hamburger.onclick = window.toggleMobileNav;
    nav.insertBefore(hamburger, navLinks);
  }
  
  if (user) {
    const sb = initSupabase();
    const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single();
    const isAdmin = profile?.role === 'admin';

    const rawName = user.user_metadata?.full_name || user.email.split('@')[0];
    const name = typeof escapeHTML === 'function' ? escapeHTML(rawName) : rawName;
    
    let adminLink = isAdmin ? `<a href="/admin">Admin Panel</a>` : '';

    navLinks.innerHTML = `
      <a href="/paket-soal">Paket Soal</a>
      <a href="/creator" style="color: var(--accent);">✨ Creator Studio</a>
      ${adminLink}
      <div class="user-dropdown">
        <button class="user-dropdown-btn" onclick="toggleUserDropdown()">
          ${name} ▼
        </button>
        <div class="user-dropdown-content" id="userDropdownContent">
          <a href="/paket-soal">Paket Soal</a>
          <a href="/koleksi">Koleksi Pribadi</a>
          <a href="/riwayat">Riwayat Ujian</a>
          <a href="#" class="text-danger" onclick="logoutUser(); return false;">Keluar</a>
        </div>
      </div>
    `;
  } else {
    navLinks.innerHTML = `
      <a href="/">Beranda</a>
      <a href="/masuk" class="btn btn-primary" style="padding:0.4rem 1rem; font-size:0.85rem;">Masuk</a>
    `;
  }
}

async function apiFetch(path, options = {}) {
  const token = await getAccessToken();
  if (options.requireAuth && !token) {
    throw new Error('Sesi login tidak ditemukan.');
  }

  const hasBody = options.body !== undefined;
  const bodyPayload = hasBody && typeof options.body !== 'string'
    ? JSON.stringify(options.body)
    : options.body;

  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    body: bodyPayload
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) {
    const error = new Error(payload.error || `Request gagal (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showToast(msg, type = '') {
  const toast = document.createElement('div');
  toast.className = type ? `toast ${type}` : 'toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// --- Auto-exports to window ---
window.initSupabase = initSupabase;
window.updateNavForUser = updateNavForUser;
window.logoutUser = logoutUser;
window.checkUserAuth = checkUserAuth;
window.requireAuth = requireAuth;
window.getAccessToken = getAccessToken;
window.apiFetch = apiFetch;
window.showToast = showToast;
