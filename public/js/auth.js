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

async function requireAuth() {
  const user = await checkUserAuth();
  if (!user) {
    sessionStorage.setItem('sf_redirect', window.location.href);
    window.location.href = '/login.html';
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
async function updateNavForUser() {
  const user = await checkUserAuth();
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;
  
  if (user) {
    const rawName = user.user_metadata?.full_name || user.email.split('@')[0];
    const name = typeof escapeHTML === 'function' ? escapeHTML(rawName) : rawName;
    navLinks.innerHTML = `
      <a href="/">Beranda</a>
      <div style="display:inline-flex; align-items:center; gap:0.5rem; background:rgba(255,255,255,0.05); padding:0.4rem 0.8rem; border-radius:50px; font-size:0.85rem; border:1px solid var(--border);">
        <span style="font-weight:600; color:var(--primary);">${name}</span>
        <button onclick="logoutUser()" style="background:transparent; border:none; color:var(--danger); cursor:pointer; font-size:0.8rem; font-weight:700;">Keluar</button>
      </div>
    `;
  } else {
    navLinks.innerHTML = `
      <a href="/">Beranda</a>
      <a href="/login.html" class="btn btn-primary" style="padding:0.4rem 1rem; font-size:0.85rem;">Login</a>
    `;
  }
}
