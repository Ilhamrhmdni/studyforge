import { getProfile } from './supabase.js';

export function extractBearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : '';
}

export async function getUserFromToken(env, accessToken) {
  if (!accessToken) return null;

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) return null;
  return response.json();
}

export async function requireAdmin(context) {
  const token = extractBearerToken(context.request);
  const user = await getUserFromToken(context.env, token);
  if (!user) return { ok: false, status: 401, message: 'Sesi login tidak valid.' };

  const profile = await getProfile(context.env, user.id);
  if (!profile || profile.role !== 'admin') {
    return { ok: false, status: 403, message: 'Akses admin diperlukan.' };
  }

  return { ok: true, user, profile };
}

export async function requireUser(context) {
  const token = extractBearerToken(context.request);
  const user = await getUserFromToken(context.env, token);
  if (!user) return { ok: false, status: 401, message: 'Sesi login tidak valid.' };
  
  const profile = await getProfile(context.env, user.id);
  return { ok: true, user, profile };
}
