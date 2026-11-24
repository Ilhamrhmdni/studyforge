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
    let redirect = sessionStorage.getItem('sf_redirect') || '/paket-soal';
    
    // Redirect admin ke admin panel jika tujuan awalnya dashboard
    const redirectPath = new URL(redirect, window.location.origin).pathname;
    if (data.user && (redirectPath === '/dashboard.html' || redirectPath === '/paket-soal')) {
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

async function handleForgotPassword(e) {
  e.preventDefault();
  const email = document.getElementById('f_email').value.trim();
  const btn = e.target.querySelector('button[type="submit"]');

  btn.disabled = true;
  btn.textContent = 'Mengirim...';

  const sb = initSupabase();
  const redirectTo = `${window.location.origin}/login?type=recovery`;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });

  btn.disabled = false;
  btn.textContent = 'Kirim Tautan Reset';

  if (error) {
    showMsg(error.message, true);
  } else {
    showMsg('Tautan reset password sudah dikirim ke email Anda. Cek inbox atau folder spam.');
  }
}

async function handleResetPassword(e) {
  e.preventDefault();
  const newPassword = document.getElementById('new_password').value;
  const confirmPassword = document.getElementById('confirm_password').value;
  const btn = e.target.querySelector('button[type="submit"]');

  if (newPassword !== confirmPassword) {
    showMsg('Konfirmasi password tidak cocok.', true);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  const sb = initSupabase();
  const { error } = await sb.auth.updateUser({ password: newPassword });

  if (error) {
    showMsg(error.message, true);
    btn.disabled = false;
    btn.textContent = 'Simpan Password Baru';
  } else {
    showMsg('Password berhasil diubah! Mengalihkan...');
    setTimeout(() => { window.location.href = '/paket-soal'; }, 1200);
  }
}

window.onload = async () => {
  const path = window.location.pathname.toLowerCase();
  const search = window.location.search.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  const isRecovery = search.includes('type=recovery') || hash.includes('type=recovery');

  const sb = initSupabase();
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      switchTab('reset');
    }
  });

  if (isRecovery) {
    switchTab('reset');
    return;
  }

  const user = await checkUserAuth();
  if (user) {
    window.location.href = '/paket-soal';
    return;
  }

  // Otomatis buka tab daftar jika user membuka /daftar atau ada hash #register / parameter tab=register
  if (path.includes('/daftar') || search.includes('tab=register') || hash === '#register' || hash === '#daftar') {
    switchTab('register');
  }
};

// --- Auto-exports to window ---
window.handleRegister = handleRegister;
window.switchTab = switchTab;
window.handleLogin = handleLogin;
window.handleForgotPassword = handleForgotPassword;
window.handleResetPassword = handleResetPassword;
window.showMsg = showMsg;
