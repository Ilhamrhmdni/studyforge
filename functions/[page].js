const PAGE_MAP = new Set(['admin', 'quiz', 'result', 'login']);

export async function onRequestGet(context) {
  const page = context.params.page;
  if (!PAGE_MAP.has(page)) {
    return context.env.ASSETS.fetch(context.request);
  }

  const url = new URL(context.request.url);
  url.pathname = `/${page}.html`;
  return context.env.ASSETS.fetch(new Request(url.toString(), context.request));
}
