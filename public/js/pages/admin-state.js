// Shared state and core helpers for the Admin dashboard modules.

export const adminState = {
  parsedQuestions: [],
  pageImages: {},
  pageCanvasEls: {},
  pageTextItems: {},
  pageViewports: {}
};

// Keep window.parsedQuestions in sync for inline HTML event handlers in the editor
Object.defineProperty(window, 'parsedQuestions', {
  get() {
    return adminState.parsedQuestions;
  },
  set(value) {
    adminState.parsedQuestions = Array.isArray(value) ? value : [];
  },
  configurable: true
});

export function adminApiFetch(path, options = {}) {
  return apiFetch(path, { ...options, requireAuth: true });
}

export function getAdminConfig() {
  try {
    return JSON.parse(sessionStorage.getItem('sf_config') || '{}');
  } catch {
    return {};
  }
}

export function saveConfig() {
  const geminiKey = document.getElementById('cfgGemini').value.trim();
  if (!geminiKey) {
    showToast('Masukkan Gemini API Key dulu!', 'error');
    return;
  }
  sessionStorage.setItem('sf_config', JSON.stringify({ geminiKey }));
  showToast('✅ Gemini API Key tersimpan untuk sesi ini!', 'success');
}

export function adminLog(msg) {
  const el = document.getElementById('parseLog');
  if (!el) return;
  const p = document.createElement('p');
  p.textContent = `→ ${msg}`;
  el.appendChild(p);
  el.scrollTop = el.scrollHeight;
}
