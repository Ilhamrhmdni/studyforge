function switchTab(tab, triggerEl = null) {
  document.querySelectorAll('.auth-tab').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach((f) => f.classList.remove('active'));

  const activeTab = triggerEl || document.querySelector(`.auth-tab[onclick*="'${tab}'"]`);
  if (activeTab) activeTab.classList.add('active');
  document.getElementById(`form-${tab}`).classList.add('active');
  document.getElementById('authMsg').style.display = 'none';
}

function showMsg(text, isError = false) {
  const el = document.getElementById('authMsg');
  el.textContent = text;
  el.className = `form-msg ${isError ? 'error' : 'success'}`;
  el.style.display = 'block';
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('l_email').value;
  const password = document.getElementById('l_password').value;
  const btn = e.target.querySelector('button');

  btn.disabled = true;
  btn.textContent = 'Memproses...';

  const sb = initSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    showMsg(error.message, true);
    btn.disabled = false;
    btn.textContent = 'Masuk';
  } else {
    let redirect = sessionStorage.getItem('sf_redirect') || '/dashboard.html';
    
    // Redirect admin ke admin panel jika tujuan awalnya dashboard
    if (data.user && redirect === '/dashboard.html') {
      const { data: profile } = await sb.from('profiles').select('role').eq('id', data.user.id).single();
      if (profile && profile.role === 'admin') {
        redirect = '/admin.html';
      }
    }

    sessionStorage.removeItem('sf_redirect');
    showMsg('Berhasil masuk! Mengalihkan...');
    setTimeout(() => { window.location.href = redirect; }, 1000);
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const name = document.getElementById('r_name').value;
  const email = document.getElementById('r_email').value;
  const password = document.getElementById('r_password').value;
  const btn = e.target.querySelector('button');

  btn.disabled = true;
  btn.textContent = 'Memproses...';

  const sb = initSupabase();
  const { error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name }
    }
  });

  if (error) {
    showMsg(error.message, true);
    btn.disabled = false;
    btn.textContent = 'Buat Akun';
  } else {
    showMsg('Akun berhasil dibuat! Silakan masuk.');
    setTimeout(() => {
      document.getElementById('l_email').value = email;
      switchTab('login');
    }, 1500);
  }
}

window.onload = async () => {
  const user = await checkUserAuth();
  if (user) window.location.href = '/dashboard.html';
};

// --- Auto-exports to window ---
window.handleRegister = handleRegister;
window.switchTab = switchTab;
window.handleLogin = handleLogin;
window.showMsg = showMsg;
