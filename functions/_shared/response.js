export function sendJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

export async function readJson(request) {
  const text = (await request.text()).trim();
  return text ? JSON.parse(text) : {};
}
