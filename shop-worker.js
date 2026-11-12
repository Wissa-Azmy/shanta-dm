/* ---------- Shanta shop: order server (Cloudflare Worker) ----------
   What it does
   - POST /order   a signed-in customer places an order. In one Firestore transaction it checks the shop is
                   open, checks each product still has the units (in Egypt minus held), takes the prices, down
                   payment and credit from Firestore (never from the phone), writes the order and the request,
                   and holds the units (catalog.held). If someone just bought the last unit it answers 409.
   - every 15 min  (Cron trigger) lets go of held units: unpaid orders are cancelled 24 hours after ordering
                   (48 hours after the offer for a request that arrived), offers nobody confirmed within
                   24 hours go back to "requested", and orders that ended or became a sale stop holding.
   - GET /ping     used by Shanta's "Test" button.

   Setup (once)
   1. Firebase console → Project settings → Service accounts → Generate new private key (a .json file).
   2. Cloudflare → Workers & Pages → Create → Worker, name it e.g. shanta-shop, paste this file, Deploy.
   3. Worker → Settings → Variables and Secrets → Add → type Secret, name FIREBASE_SA, value: the whole
      .json file's text. Never put that key in GitHub or in this file.
   4. Worker → Settings → Trigger events → Add → Cron trigger → "Every 15 minutes".
   5. Shanta → Settings → Online shop → Order server address: the worker's address → Test → Publish now. */

const PROJECT = 'shanta-dm';
const ALLOWED = ['https://wissa-azmy.github.io'];
const DOCS = `projects/${PROJECT}/databases/(default)/documents`;
const API = `https://firestore.googleapis.com/v1/${DOCS}`;
const HOUR = 36e5;
const CODE_CH = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const cors = { 'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0], 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
    const out = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors) });
    if (origin && !ALLOWED.includes(origin)) return out({ error: 'This site is not allowed.' }, 403);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    try {
      if (path === '/ping') {
        const r = { ok: true, key: !!env.FIREBASE_SA, firestore: false };
        if (r.key) try { await getDocs(env, ['shop/settings']); r.firestore = true; } catch (e) { r.err = String(e.message || e).slice(0, 200); }
        return out(r);
      }
      if (path === '/order' && req.method === 'POST') {
        const user = await verifyUser(req.headers.get('Authorization'));
        const body = await req.json().catch(() => null);
        const r = await withRetry(() => placeOrder(env, user, body));
        return out(r.body, r.status);
      }
      return out({ error: 'Not found' }, 404);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(e);
      return out({ error: String(e.message || e).slice(0, 300), code: e.code || (status === 401 ? 'unauthenticated' : status >= 500 ? 'unavailable' : '') }, status);
    }
  },
  async scheduled(ev, env, ctx) {
    ctx.waitUntil(sweep(env));
  }
};

/* ---------- placing an order ---------- */
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const bad = (msg, status = 400, code = 'invalid-argument') => Object.assign(new Error(msg), { status, code });
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const newId = (n = 20, ch = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => ch[b % ch.length]).join('');
/* same rounding as the shop: up to the next 5 EGP, 100% means the whole total */
const downOf = (total, pct) => pct >= 100 ? total : Math.min(total, Math.ceil(total * pct / 100 / 5) * 5);

async function placeOrder(env, user, b) {
  if (!b || !Array.isArray(b.lines) || !b.lines.length || b.lines.length > 60) throw bad('No products in the order.');
  const want = new Map();
  for (const l of b.lines) {
    const id = String((l && l.id) || ''), qty = Math.floor(num(l && l.qty)), now = Math.floor(num(l && l.now));
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id) || qty < 1 || qty > 99 || now < 0 || now > qty) throw bad('A product line isn’t valid.');
    const w = want.get(id) || { id, qty: 0, now: 0 }; w.qty += qty; w.now += now; want.set(id, w);
  }
  const name = str(b.name, 80), address = str(b.address, 300), note = str(b.note, 500), lang = b.lang === 'ar' ? 'ar' : 'en';
  if (!name || !address) throw bad('Name and address are needed.');
  const verified = !!user.phone_number, phone = verified ? user.phone_number : str(b.phone, 20);
  if (!/^\+\d{10,15}$/.test(phone)) throw bad('The phone number isn’t valid.', 400, 'invalid-phone');
  const email = str(user.email, 200), uid = user.sub;

  const tx = await fs(env, ':beginTransaction', { options: { readWrite: {} } }).then(r => r.transaction);
  try {
    const ids = [...want.keys()];
    const got = await getDocs(env, ['shop/settings', `customers/${uid}`, ...ids.map(id => `catalog/${id}`)], tx);
    const set = got['shop/settings'];
    if (!set || set.data.open === false) { await rollback(env, tx); return { status: 403, body: { error: 'The shop is closed.', code: 'permission-denied', closed: true } }; }
    const S = set.data, cust = got[`customers/${uid}`], C = cust ? cust.data : null;

    const short = [], gone = [], o = [], r = [];
    for (const w of want.values()) {
      const doc = got[`catalog/${w.id}`];
      if (!doc) { gone.push(w.id); continue; }
      const p = Object.assign({ id: w.id }, doc.data), eg = p.eg !== undefined ? num(p.eg) : num(p.avail);
      const avail = Math.max(0, eg - num(p.held));
      if (w.now > avail) { short.push({ id: w.id, avail }); continue; }
      if (w.now) o.push({ p, q: w.now });
      if (w.qty - w.now) r.push({ p, q: w.qty - w.now });
    }
    if (short.length || gone.length) { await rollback(env, tx); return { status: 409, body: { error: 'Not enough stock.', short, gone } }; }

    /* money: the same rules as lines() in shop.js */
    const sum = a => a.reduce((s, x) => s + x.q * num(x.p.price), 0);
    const method = S.instapay && b.method === 'instapay' ? 'instapay' : 'cod';
    const fee = Math.max(0, num(S.deliveryFee)), credit = Math.max(0, num(C && C.credit));
    const pctOf = (v, d) => { const c = C && C.downPct; return c !== undefined && c !== null && c !== '' ? num(c) : num(v ?? d); };
    const og = sum(o), rg = sum(r), od = o.length ? fee : 0, rd = !o.length && r.length ? fee : 0;
    const oc = Math.min(credit, og + od), rc = o.length ? 0 : Math.min(credit, rg + rd);
    const ot = og + od - oc, rt = rg + rd - rc;
    const opct = pctOf(method === 'cod' ? S.downCod : S.downInsta, method === 'cod' ? 0 : 100), rpct = pctOf(S.reqDownPct, 20);
    const pack = a => a.map(x => ({ id: x.p.id, name: str(x.p.name, 200), brand: str(x.p.brand, 100), ean: str(x.p.ean, 40), price: num(x.p.price), qty: x.q }));

    const now = new Date().toISOString(), group = newId(6, CODE_CH);
    const base = { uid, phone, verified, email, name, address, note, lang, createdAt: now, updatedAt: now };
    const orders = [];
    if (o.length) orders.push(Object.assign({}, base, { kind: 'order', status: 'new', method, lines: pack(o), goods: og, delivery: od, creditUsed: oc, total: ot, downPct: opct, down: downOf(ot, opct), group, code: group, holding: true }));
    if (r.length) orders.push(Object.assign({}, base, { kind: 'request', status: 'requested', method, lines: pack(r), goods: rg, delivery: rd, creditUsed: rc, total: rt, downPct: rpct, down: downOf(rt, rpct), group, code: o.length ? newId(6, CODE_CH) : group }));

    const writes = orders.map(x => { x.id = newId(); return { update: { name: `${DOCS}/orders/${x.id}`, fields: fields(omit(x, 'id')) }, currentDocument: { exists: false } }; });
    for (const x of o) writes.push(setFields(`catalog/${x.p.id}`, { held: num(x.p.held) + x.q }, got[`catalog/${x.p.id}`].updateTime));
    if (!C) writes.push({ update: { name: `${DOCS}/customers/${uid}`, fields: fields({ name, phone, verified, email, address, createdAt: now, updatedAt: now }) }, currentDocument: { exists: false } });
    else if (C.name !== name || C.address !== address || (!verified && C.phone !== phone)) writes.push(setFields(`customers/${uid}`, Object.assign({ name, address, updatedAt: now }, verified ? {} : { phone })));
    await fs(env, ':commit', { writes, transaction: tx });
    return { status: 200, body: { ok: true, orders } };
  } catch (e) { await rollback(env, tx); throw e; }
}

/* ---------- every 15 minutes: let go of held units ---------- */
function decide(o, t) {
  const st = o.status;
  if (['cancelled', 'declined', 'confirmed', 'out', 'delivered', 'requested'].includes(st)) return {};   // ended, became a sale (Shanta lowers the stock), or the offer was withdrawn
  if (st === 'new' && num(o.down) > 0 && !o.downPaid && !o.proof) {
    const due = Date.parse(o.offeredAt || o.createdAt) + (o.offeredAt ? 48 : 24) * HOUR;     // same as payDeadline() in shop.js
    if (Number.isFinite(due) && t > due) return { status: 'cancelled', cancelledBy: 'timer', cancelledAt: new Date(t).toISOString() };
  }
  if (st === 'offered') {
    const due = Date.parse(o.offeredAt) + 24 * HOUR;
    if (Number.isFinite(due) && t > due) return { status: 'requested', offerExpired: true, offeredAt: '' };
  }
  return null;   // keep holding
}
async function sweep(env) {
  const rows = await fs(env, ':runQuery', { structuredQuery: { from: [{ collectionId: 'orders' }], where: { fieldFilter: { field: { fieldPath: 'holding' }, op: 'EQUAL', value: { booleanValue: true } } }, limit: 300 } });
  const t = Date.now();
  for (const row of rows) {
    if (!row.document) continue;
    const id = row.document.name.split('/').pop(), o = decode(row.document.fields);
    if (!decide(o, t)) continue;
    try { await withRetry(() => release(env, id)); } catch (e) { console.error('release', id, e); }
  }
}
async function release(env, id) {
  const tx = await fs(env, ':beginTransaction', { options: { readWrite: {} } }).then(r => r.transaction);
  try {
    const got = await getDocs(env, [`orders/${id}`], tx), od = got[`orders/${id}`];
    const o = od && od.data, change = o && o.holding === true ? decide(o, Date.now()) : null;
    if (!change) { await rollback(env, tx); return; }
    const per = {}; (o.lines || []).forEach(l => { if (l && l.id) per[l.id] = (per[l.id] || 0) + num(l.qty); });
    const cat = Object.keys(per).length ? await getDocs(env, Object.keys(per).map(x => `catalog/${x}`), tx) : {};
    const writes = [setFields(`orders/${id}`, Object.assign({ holding: false, updatedAt: new Date().toISOString() }, change), od.updateTime)];
    for (const [pid, q] of Object.entries(per)) { const c = cat[`catalog/${pid}`]; if (c) writes.push(setFields(`catalog/${pid}`, { held: Math.max(0, num(c.data.held) - q) }, c.updateTime)); }
    await fs(env, ':commit', { writes, transaction: tx });
  } catch (e) { await rollback(env, tx); throw e; }
}

/* ---------- Firestore REST ---------- */
async function fs(env, op, body) {
  const r = await fetch(API + op, { method: 'POST', headers: { Authorization: 'Bearer ' + await saToken(env), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = (Array.isArray(d) ? d[0] : d).error || {}; throw Object.assign(new Error(e.message || 'Firestore ' + r.status), { status: r.status === 409 ? 503 : 502, code: 'unavailable', fsStatus: e.status }); }
  return d;
}
async function getDocs(env, paths, tx) {
  const res = await fs(env, ':batchGet', Object.assign({ documents: paths.map(p => `${DOCS}/${p}`) }, tx ? { transaction: tx } : {}));
  const out = {};
  for (const x of res) if (x.found) out[x.found.name.slice(DOCS.length + 1)] = { data: decode(x.found.fields), updateTime: x.found.updateTime };
  return out;
}
const rollback = (env, tx) => fs(env, ':rollback', { transaction: tx }).catch(() => {});
/* contention: another write touched the same products; try again a couple of times */
async function withRetry(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (i >= 2 || !/ABORTED|FAILED_PRECONDITION/.test(e.fsStatus || '')) throw e; await new Promise(ok => setTimeout(ok, 150 * (i + 1) + Math.random() * 200)); }
  }
}
/* change only these fields (like update() in the app); fails if the document changed or is gone */
const setFields = (path, data, updateTime) => ({ update: { name: `${DOCS}/${path}`, fields: fields(data) }, updateMask: { fieldPaths: Object.keys(data) },
  currentDocument: updateTime ? { updateTime } : { exists: true } });
const omit = (o, k) => { const c = Object.assign({}, o); delete c[k]; return c; };
const fields = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, enc(v)]));
function enc(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: fields(v) } };
}
function dec(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v) return decode(v.mapValue.fields);
  return null;
}
const decode = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, dec(v)]));

/* ---------- Google sign-in for the worker itself (service account → access token) ---------- */
let SA_TOKEN = { tok: '', exp: 0 };
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uStr = s => b64u(new TextEncoder().encode(s));
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function saToken(env) {
  if (SA_TOKEN.tok && Date.now() < SA_TOKEN.exp) return SA_TOKEN.tok;
  if (!env.FIREBASE_SA) throw Object.assign(new Error('The FIREBASE_SA secret is missing.'), { status: 503, code: 'unavailable' });
  const sa = JSON.parse(env.FIREBASE_SA), iat = Math.floor(Date.now() / 1000);
  const der = unb64u(sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '').replace(/\+/g, '-').replace(/\//g, '_'));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const unsigned = b64uStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + b64uStr(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }));
  const jwt = unsigned + '.' + b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw Object.assign(new Error('Google refused the service-account key: ' + (d.error_description || d.error || r.status)), { status: 503, code: 'unavailable' });
  SA_TOKEN = { tok: d.access_token, exp: Date.now() + (num(d.expires_in) - 120) * 1000 };
  return SA_TOKEN.tok;
}

/* ---------- checking the customer's Firebase sign-in ---------- */
let JWKS = { keys: {}, exp: 0 };
async function verifyUser(h) {
  const tok = /^Bearer (.+)$/.exec(h || '');
  if (!tok) throw bad('Please sign in again.', 401, 'unauthenticated');
  const [h64, p64, s64] = tok[1].split('.');
  if (!s64) throw bad('Please sign in again.', 401, 'unauthenticated');
  const head = JSON.parse(new TextDecoder().decode(unb64u(h64))), pay = JSON.parse(new TextDecoder().decode(unb64u(p64)));
  if (head.alg !== 'RS256') throw bad('Please sign in again.', 401, 'unauthenticated');
  if (Date.now() > JWKS.exp || !JWKS.keys[head.kid]) {
    const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    const d = await r.json(), age = /max-age=(\d+)/.exec(r.headers.get('Cache-Control') || '');
    JWKS = { keys: Object.fromEntries((d.keys || []).map(k => [k.kid, k])), exp: Date.now() + (age ? num(age[1]) : 3600) * 1000 };
  }
  const jwk = JWKS.keys[head.kid];
  if (!jwk) throw bad('Please sign in again.', 401, 'unauthenticated');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64u(s64), new TextEncoder().encode(h64 + '.' + p64));
  const t = Math.floor(Date.now() / 1000);
  if (!ok || pay.aud !== PROJECT || pay.iss !== `https://securetoken.google.com/${PROJECT}` || !pay.sub || num(pay.exp) < t || num(pay.iat) > t + 300)
    throw bad('Please sign in again.', 401, 'unauthenticated');
  return pay;
}
