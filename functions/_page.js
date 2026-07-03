export async function serveStaticPage(context, page) {
  const url = new URL(context.request.url);
  url.pathname = `/${page}.html`;
  return context.env.ASSETS.fetch(new Request(url.toString(), context.request));
}
