// Temporary debug endpoint - REMOVE after debugging
export async function onRequestGet(context) {
  return new Response(JSON.stringify({
    has_SUPABASE_URL: !!context.env.SUPABASE_URL,
    has_SUPABASE_SERVICE_ROLE_KEY: !!context.env.SUPABASE_SERVICE_ROLE_KEY,
    has_QUIZ_ENCRYPTION_SECRET: !!context.env.QUIZ_ENCRYPTION_SECRET,
    supabase_url_type: typeof context.env.SUPABASE_URL,
    env_keys: Object.keys(context.env).filter(k => !k.startsWith('__')),
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
