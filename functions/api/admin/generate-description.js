// functions/api/admin/generate-description.js
export async function onRequestPost(context) {
  try {
    // 1. Verify Auth
    const authHeader = context.request.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');
    const supabaseUrl = context.env.SUPABASE_URL;
    const supabaseKey = context.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ error: 'Server misconfiguration' }), { status: 500 });
    }

    const { user, error: userError } = await verifyToken(token, supabaseUrl, supabaseKey);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
    }

    const { role } = await getUserRole(user.id, supabaseUrl, supabaseKey);
    if (role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    }

    // 2. Parse request
    const { text } = await context.request.json();
    if (!text || text.length < 10) {
      return new Response(JSON.stringify({ error: 'Teks terlalu pendek' }), { status: 400 });
    }

    // 3. Check AI binding
    if (!context.env.AI) {
      return new Response(JSON.stringify({ error: 'Cloudflare AI binding not configured' }), { status: 501 });
    }

    // 4. Generate with CF AI
    const prompt = `Buatkan deskripsi singkat (maksimal 2 kalimat) yang menarik untuk paket soal berikut. Fokus pada topik utamanya. Jangan menggunakan awalan seperti "Deskripsi:" atau tanda kutip. Langsung tulis kalimatnya saja.\n\nSoal:\n${text.substring(0, 1500)}`;
    
    const response = await context.env.AI.run('@cf/meta/llama-3-8b-instruct', {
      messages: [
        { role: 'system', content: 'Kamu adalah asisten AI untuk platform edukasi StudyForge. Tugasmu membuat deskripsi singkat dan menarik untuk paket soal.' },
        { role: 'user', content: prompt }
      ]
    });

    const description = response.response?.trim() || '';

    return new Response(JSON.stringify({ description }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

async function verifyToken(token, supabaseUrl, supabaseKey) {
  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${token}`
    }
  });
  if (!res.ok) return { error: 'Invalid auth' };
  const user = await res.json();
  return { user };
}

async function getUserRole(userId, supabaseUrl, supabaseKey) {
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=role`, {
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}` // Service role key allows bypassing RLS
    }
  });
  if (!res.ok) return { role: 'user' };
  const data = await res.json();
  return { role: data[0]?.role || 'user' };
}
