/* Shanta dm · dm product search relay (Cloudflare Worker)
   dm's product search doesn't answer web pages from other sites, so the app asks this Worker instead
   and the Worker asks dm. GET /search?query=…&pageSize=… → dm’s search result; GET /rossmann?ean=… → the
   product photo from rossmann.de.
   Only the app's own site may use it, and answers are cached for a day so dm is asked as little as possible.
   Paste this whole file into a new Worker on dash.cloudflare.com (Workers & Pages → Create → Worker →
   Edit code), press Deploy, and copy the Worker's address into the app: Settings → Barcode search. */

const ALLOWED = ['https://wissa-azmy.github.io'];   // sites that may use this relay
const DM = 'https://product-search.services.dmtech.com/de/search';

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const ok = ALLOWED.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': ok ? origin : ALLOWED[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };
    const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'GET') return json({ error: 'method' }, 405);
    if (!ok) return json({ error: 'site not allowed' }, 403);

    const u = new URL(req.url);
    if (u.pathname === '/' || u.pathname === '/ping') return json({ ok: true }, 200);
    if (u.pathname === '/rossmann') return rossmann(u, ctx, json);
    if (u.pathname !== '/search') return json({ error: 'not found' }, 404);
    const q = (u.searchParams.get('query') || '').trim().slice(0, 120);
    if (!q) return json({ error: 'no query' }, 400);
    const size = Math.min(24, Math.max(1, parseInt(u.searchParams.get('pageSize'), 10) || 12));
    const target = `${DM}?query=${encodeURIComponent(q)}&pageSize=${size}`;

    const cache = caches.default, key = new Request(target);
    let hit = await cache.match(key);
    if (!hit) {
      let up;
      try {
        up = await fetch(target, { headers: { 'Accept': 'application/json', 'Accept-Language': 'de-DE,de;q=0.9', 'User-Agent': 'Mozilla/5.0 (compatible; ShantaDm/1.0)' } });
      } catch (e) { return json({ error: 'dm unreachable' }, 502); }
      if (!up.ok) return json({ error: 'dm ' + up.status }, up.status === 429 ? 429 : 502);
      hit = new Response(await up.text(), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=86400' } });
      ctx.waitUntil(cache.put(key, hit.clone()));
    }
    return new Response(hit.body, { status: 200, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
  }
};

/* GET /rossmann?ean=… → { img, url } from rossmann.de. A search for one barcode opens that product's page;
   its photo is the page's og:image (or the first product photo on it). The barcode must appear on the page,
   so a product never gets another product's photo. Answers are cached for a week. */
async function rossmann(u, ctx, json) {
  const ean = (u.searchParams.get('ean') || '').replace(/\D/g, '');
  if (!/^\d{8,14}$/.test(ean)) return json({ error: 'no ean' }, 400);
  const target = `https://www.rossmann.de/de/search/?text=${ean}`;
  const cache = caches.default, key = new Request(`https://shanta-cache/rossmann/${ean}`);
  const hit = await cache.match(key);
  if (hit) return json(await hit.json(), 200);
  let page;
  try {
    page = await fetch(target, { redirect: 'follow', headers: { 'Accept': 'text/html', 'Accept-Language': 'de-DE,de;q=0.9', 'User-Agent': 'Mozilla/5.0 (compatible; ShantaDm/1.0)' } });
  } catch (e) { return json({ error: 'rossmann unreachable' }, 502); }
  if (!page.ok) return json({ error: 'rossmann ' + page.status }, page.status === 429 ? 429 : 502);
  const html = await page.text();
  let img = '';
  if (html.includes(ean)) {
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    const any = html.match(/https:\/\/[^"'\s)]*rossmann\.de\/[^"'\s)]*\.(?:jpe?g|png|webp)(?:\?[^"'\s)]*)?/i);
    img = (og && /rossmann\.de\//.test(og[1]) && !/logo|signet|og-default/i.test(og[1]) ? og[1] : any ? any[0] : '').replace(/&amp;/g, '&');
    if (img.startsWith('//')) img = 'https:' + img;
  }
  const body = { img, url: img ? page.url : '' };
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=604800' } })));
  return json(body, 200);
}
