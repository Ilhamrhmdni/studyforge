export function getServiceConfigError(env) {
  if (!env.SUPABASE_URL) return 'SUPABASE_URL belum diset.';
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return 'SUPABASE_SERVICE_ROLE_KEY belum diset.';
  if (!env.QUIZ_ENCRYPTION_SECRET) return 'QUIZ_ENCRYPTION_SECRET belum diset.';
  return '';
}

export function getSupabaseConfigError(env) {
  if (!env.SUPABASE_URL) return 'SUPABASE_URL belum diset.';
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return 'SUPABASE_SERVICE_ROLE_KEY belum diset.';
  return '';
}

export async function supabaseFetch(env, path, options = {}) {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = data && typeof data === 'object' && data.message
      ? data.message
      : `Supabase error ${response.status}`;
    throw new Error(message);
  }

  return data;
}

export async function getProfile(env, userId) {
  const params = new URLSearchParams({
    select: 'id,email,full_name,role',
    id: `eq.${userId}`
  });
  const rows = await supabaseFetch(env, `/rest/v1/profiles?${params.toString()}`);
  return rows[0] || null;
}
