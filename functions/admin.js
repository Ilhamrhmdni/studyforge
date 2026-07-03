import { serveStaticPage } from './_page.js';

export async function onRequestGet(context) {
  return serveStaticPage(context, 'admin');
}
