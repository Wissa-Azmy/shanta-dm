/* ---------- Shanta Shop: what customers see ----------
   Reads the public catalog that Shanta publishes (catalog/<product>, shop/settings) and nothing else.
   Products in Egypt go in the cart as an order; products that aren't in Egypt can be requested. The cart
   stays on the phone. For now an order is sent as a WhatsApp message to the shop; sign-in, InstaPay
   and orders inside Shanta come in the next release. */
const FB_VER = '13.1.0', FB = s => `https://www.gstatic.com/firebasejs/${FB_VER}/firebase-${s}.js`;
const CFG = { apiKey: 'AIzaSyAa9fTvt1RxGFDGf1rWFLBB_gvVlaOkphM', authDomain: 'shanta-dm.firebaseapp.com', projectId: 'shanta-dm' };
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? d; } catch (e) { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
const REQ_MAX = 10;

/* ---- words ---- */
let LANG = localStorage.getItem('shop-lang') || (/^ar/i.test(navigator.language || '') ? 'ar' : 'en');
const W = {
  en: {
    tag: 'German dm & Rossmann, in Egypt', search: 'Search products or brands', all: 'All', inStock: 'In stock', canReq: 'To request',
    allCats: 'All categories', allBrands: 'All brands', sortName: 'A–Z', sortLow: 'Price: low to high', sortHigh: 'Price: high to low',
    left: n => `Only ${n} left`, avail: 'In stock', way: 'On the way from Germany', soldOut: 'Sold out · you can request it',
    add: 'Add to cart', request: 'Request it', more: 'One more', less: 'One less', nothing: 'No products match.', clear: 'Show all',
    loading: 'Loading products…', loadErr: 'Couldn’t load the shop. Check your internet connection.', retry: 'Try again',
    empty: 'The shop is being stocked. Check back soon.', closed: 'The shop isn’t taking orders right now. You can still look around.',
    cart: 'Your cart', cartEmpty: 'Your cart is empty.', keepShopping: 'Keep shopping', order: 'Order', orderSub: 'In Egypt, delivered to you',
    requests: 'Requests', reqSub: 'Not in Egypt now; we bring them with the next box', total: 'Total', reqTotal: 'Requests total',
    down: p => `Down payment ${p}%`, downNote: p => `We confirm requests on WhatsApp first. The ${p}% down payment is paid by InstaPay after we confirm; the rest when it arrives.`,
    pay: 'Pay on delivery, or by InstaPay; we send the details on WhatsApp.', reqOnly: (n, a) => `${n} in stock, the rest as a request`,
    gone: 'No longer in the shop', remove: 'Remove', details: 'Your details', name: 'Name', phone: 'Mobile number', address: 'Area and address',
    note: 'Note (optional)', send: 'Send on WhatsApp', noWa: 'Ordering opens soon.', need: 'Please fill in your name, mobile number and address.',
    sent: 'Sent your order? Clear the cart', cleared: 'Cart cleared', added: 'Added to the cart', requested: 'Added as a request',
    items: n => n === 1 ? '1 item' : `${n} items`, view: 'View cart', close: 'Close',
    msgHead: shop => `New order · ${shop}`, msgOrder: 'Order (in Egypt)', msgReq: p => `Requests (not in Egypt, ${p}% down payment)`,
    msgTotal: 'Total', msgDown: 'Down payment', msgName: 'Name', msgPhone: 'Mobile', msgAddr: 'Address', msgNote: 'Note'
  },
  ar: {
    tag: 'منتجات dm وRossmann الألمانية، في مصر', search: 'ابحث عن منتج أو ماركة', all: 'الكل', inStock: 'متوفر', canReq: 'بالطلب',
    allCats: 'كل الفئات', allBrands: 'كل الماركات', sortName: 'أ–ي', sortLow: 'السعر: من الأقل', sortHigh: 'السعر: من الأعلى',
    left: n => `متبقٍ ${n} فقط`, avail: 'متوفر', way: 'في الطريق من ألمانيا', soldOut: 'نفد · يمكنك طلبه',
    add: 'أضف إلى السلة', request: 'اطلبه', more: 'واحد زيادة', less: 'واحد أقل', nothing: 'لا توجد منتجات مطابقة.', clear: 'اعرض الكل',
    loading: 'جارٍ تحميل المنتجات…', loadErr: 'تعذّر تحميل المتجر. تحقق من اتصال الإنترنت.', retry: 'حاول مرة أخرى',
    empty: 'نجهّز المتجر الآن. عُد قريبًا.', closed: 'المتجر لا يستقبل طلبات حاليًا. يمكنك التصفح.',
    cart: 'سلتك', cartEmpty: 'سلتك فارغة.', keepShopping: 'تابع التسوق', order: 'الطلب', orderSub: 'موجود في مصر، يصلك بالتوصيل',
    requests: 'طلبات المنتجات', reqSub: 'غير موجود في مصر الآن؛ نحضره مع الشحنة القادمة', total: 'الإجمالي', reqTotal: 'إجمالي الطلبات',
    down: p => `العربون ${p}%`, downNote: p => `نؤكد طلبات المنتجات على واتساب أولًا. يُدفع العربون ${p}% عبر InstaPay بعد التأكيد، والباقي عند الوصول.`,
    pay: 'الدفع عند الاستلام أو عبر InstaPay؛ نرسل التفاصيل على واتساب.', reqOnly: (n, a) => `${n} متوفر، والباقي كطلب`,
    gone: 'لم يعد في المتجر', remove: 'إزالة', details: 'بياناتك', name: 'الاسم', phone: 'رقم الموبايل', address: 'المنطقة والعنوان',
    note: 'ملاحظة (اختياري)', send: 'أرسل على واتساب', noWa: 'الطلب متاح قريبًا.', need: 'من فضلك اكتب الاسم ورقم الموبايل والعنوان.',
    sent: 'أرسلت طلبك؟ أفرغ السلة', cleared: 'تم إفراغ السلة', added: 'أُضيف إلى السلة', requested: 'أُضيف كطلب',
    items: n => n === 1 ? 'منتج واحد' : `${n} منتجات`, view: 'اعرض السلة', close: 'إغلاق',
    msgHead: shop => `طلب جديد · ${shop}`, msgOrder: 'الطلب (موجود في مصر)', msgReq: p => `طلبات المنتجات (غير موجودة في مصر، عربون ${p}%)`,
    msgTotal: 'الإجمالي', msgDown: 'العربون', msgName: 'الاسم', msgPhone: 'الموبايل', msgAddr: 'العنوان', msgNote: 'ملاحظة'
  }
};
const t = (k, ...a) => { const v = W[LANG][k] ?? W.en[k] ?? k; return typeof v === 'function' ? v(...a) : v; };
const money = n => LANG === 'ar' ? `${Math.round(n).toLocaleString('en-US')} ج.م` : `EGP ${Math.round(n).toLocaleString('en-US')}`;

/* ---- state ---- */
let CAT = [], BY = {}, SET = { name: 'Shanta', reqDownPct: 20, open: true, lowStock: 2 }, STATE = 'loading';
const CART = ls('shop-cart', {});           // product id → units
const ME = ls('shop-me', {});               // name, phone, address, note
const UI = { q: '', avail: '', cat: '', brand: '', sort: 'name' };

async function load() {
  STATE = 'loading'; draw();
  try {
    const [A, S] = await Promise.all([import(FB('app')), import(FB('firestore-lite'))]);
    const app = A.getApps().length ? A.getApp() : A.initializeApp(CFG), fs = S.getFirestore(app);
    const [cat, st] = await Promise.all([S.getDocs(S.collection(fs, 'catalog')), S.getDoc(S.doc(fs, 'shop', 'settings'))]);
    CAT = []; cat.forEach(d => CAT.push(Object.assign({ id: d.id }, d.data())));
    BY = {}; CAT.forEach(p => BY[p.id] = p);
    if (st.exists()) SET = Object.assign(SET, st.data());
    STATE = 'ok';
  } catch (e) { console.warn(e); STATE = 'error'; }
  draw();
}

/* ---- cart: units in Egypt go in the order, the rest is a request ---- */
const maxFor = p => p.status === 'in' ? Math.max(0, p.avail | 0) : REQ_MAX;
function lines() {
  const o = [], r = [], gone = [];
  Object.entries(CART).forEach(([id, q]) => {
    const p = BY[id]; q = q | 0; if (q <= 0) return;
    if (!p) { gone.push(id); return; }
    const ord = p.status === 'in' ? Math.min(q, p.avail | 0) : 0;
    if (ord) o.push({ p, q: ord });
    if (q - ord) r.push({ p, q: q - ord, split: ord > 0 });
  });
  const sum = a => a.reduce((s, x) => s + x.q * (+x.p.price || 0), 0);
  const pct = Math.max(0, Math.min(100, +SET.reqDownPct || 0)), rt = sum(r);
  return { o, r, gone, ot: sum(o), rt, pct, down: Math.ceil(rt * pct / 100 / 5) * 5, n: Object.values(CART).reduce((s, q) => s + (q | 0), 0) };
}
function setQty(id, q) {
  const p = BY[id]; q = Math.max(0, q | 0);
  if (p) q = Math.min(q, maxFor(p));
  if (q) CART[id] = q; else delete CART[id];
  save('shop-cart', CART);
}

/* ---- drawing ---- */
const initials = p => esc(String(p.brand || p.name || '?').trim().slice(0, 2).toUpperCase());
const stockLine = p => p.status === 'in' ? ((p.avail | 0) <= (+SET.lowStock || 2) ? `<span class="st low">${t('left', p.avail | 0)}</span>` : `<span class="st ok">${t('avail')}</span>`)
  : p.status === 'way' ? `<span class="st way">${t('way')}</span>` : `<span class="st req">${t('soldOut')}</span>`;
function stepper(p) {
  const q = CART[p.id] | 0, max = maxFor(p);
  if (!q) return p.status === 'in' ? `<button type="button" class="btn" data-add="${esc(p.id)}">${t('add')}</button>` : `<button type="button" class="btn req" data-add="${esc(p.id)}">${t('request')}</button>`;
  return `<div class="step"><button type="button" data-q="${esc(p.id)}:-1" aria-label="${t('less')}">−</button><b>${q}</b><button type="button" data-q="${esc(p.id)}:1" aria-label="${t('more')}"${q >= max ? ' disabled' : ''}>+</button></div>`;
}
function card(p) {
  return `<article class="pc" data-id="${esc(p.id)}">
    <div class="ph">${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ini',textContent:this.dataset.i}))" data-i="${initials(p)}">` : `<span class="ini">${initials(p)}</span>`}
      <span class="stag ${p.store === 'Rossmann' ? 'ross' : 'dm'}">${esc(p.store || 'dm')}</span></div>
    <div class="pb"><small dir="auto">${esc(p.brand || '')}</small><h3 dir="auto">${esc(p.name)}</h3>
      <div class="pr"><b>${money(+p.price || 0)}</b>${p.size ? `<span dir="ltr">${esc(p.size)}</span>` : ''}</div>
      ${stockLine(p)}${stepper(p)}</div></article>`;
}
function filtersHTML() {
  const uniq = k => [...new Set(CAT.map(p => String(p[k] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const opt = (v, l, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`;
  const chip = (v, l) => `<button type="button" class="chip${UI.avail === v ? ' on' : ''}" data-avail="${v}">${l}</button>`;
  const cats = uniq('category'), brands = uniq('brand');
  return `<input type="search" id="q" value="${esc(UI.q)}" placeholder="${t('search')}" autocomplete="off">
    <div class="frow">${chip('', t('all'))}${chip('in', t('inStock'))}${chip('req', t('canReq'))}
      ${cats.length > 1 ? `<select data-f="cat">${opt('', t('allCats'), UI.cat)}${cats.map(c => opt(c, c, UI.cat)).join('')}</select>` : ''}
      ${brands.length > 1 ? `<select data-f="brand">${opt('', t('allBrands'), UI.brand)}${brands.map(c => opt(c, c, UI.brand)).join('')}</select>` : ''}
      <select data-f="sort">${opt('name', t('sortName'), UI.sort)}${opt('low', t('sortLow'), UI.sort)}${opt('high', t('sortHigh'), UI.sort)}</select></div>`;
}
function shown() {
  const q = UI.q.trim().toLowerCase();
  const rank = p => p.status === 'in' ? 0 : p.status === 'way' ? 1 : 2;
  return CAT.filter(p => (!q || `${p.name} ${p.brand} ${p.category} ${p.ean}`.toLowerCase().includes(q))
    && (!UI.avail || (UI.avail === 'in' ? p.status === 'in' : p.status !== 'in'))
    && (!UI.cat || p.category === UI.cat) && (!UI.brand || p.brand === UI.brand))
    .sort((a, b) => UI.sort === 'low' ? a.price - b.price : UI.sort === 'high' ? b.price - a.price : rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
}
function drawGrid() {
  const g = $('#grid');
  if (STATE === 'loading') { g.innerHTML = `<p class="msg"><span class="spin"></span>${t('loading')}</p>`; return; }
  if (STATE === 'error') { g.innerHTML = `<p class="msg">${t('loadErr')}<br><button type="button" class="btn ghost" data-act="retry">${t('retry')}</button></p>`; return; }
  if (!CAT.length) { g.innerHTML = `<p class="msg">${t('empty')}</p>`; return; }
  const list = shown();
  g.innerHTML = list.map(card).join('') || `<p class="msg">${t('nothing')}<br><button type="button" class="btn ghost" data-act="clear">${t('clear')}</button></p>`;
}
function drawBar() {
  const L = lines(), b = $('#cartbar');
  $('#cartn').textContent = L.n ? L.n : ''; $('#cartn').hidden = !L.n;
  b.innerHTML = L.n ? `<button type="button" class="cb" data-act="cart"><span>${t('items', L.n)}</span><b>${money(L.ot + L.rt)}</b><span class="go">${t('view')}</span></button>` : '';
  document.body.classList.toggle('hasbar', !!L.n);
}
function draw() {
  document.documentElement.lang = LANG; document.documentElement.dir = LANG === 'ar' ? 'rtl' : 'ltr';
  $('#langbtn').textContent = LANG === 'ar' ? 'English' : 'العربية';
  $('#sname').textContent = SET.name || 'Shanta'; $('#stag').textContent = t('tag');
  document.title = (SET.name || 'Shanta') + (LANG === 'ar' ? ' · المتجر' : ' Shop');
  if (STATE === 'ok' && CAT.length) { const f = $('#filters'), had = document.activeElement && document.activeElement.id === 'q'; f.innerHTML = filtersHTML(); if (had) { const i = $('#q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
  else $('#filters').innerHTML = '';
  $('#banner').innerHTML = STATE === 'ok' && SET.open === false ? `<p class="banner">${t('closed')}</p>` : '';
  drawGrid(); drawBar();
  if ($('#cart').open) drawCart();
}
function lineHTML(x, req) {
  return `<li><div class="li"><b dir="auto">${esc(x.p.name)}</b><small dir="auto">${esc(x.p.brand || '')} · ${money(+x.p.price || 0)}${x.split ? ' · ' + t('reqOnly', x.p.avail | 0) : ''}</small></div>
    ${x.split ? `<b class="lq">× ${x.q}</b>` : `<div class="step sm"><button type="button" data-q="${esc(x.p.id)}:-1" aria-label="${t('less')}">−</button><b>${x.q}</b><button type="button" data-q="${esc(x.p.id)}:1" aria-label="${t('more')}"${(CART[x.p.id] | 0) >= maxFor(x.p) ? ' disabled' : ''}>+</button></div>`}
    <b class="lt">${money(x.q * (+x.p.price || 0))}</b></li>`;
}
function drawCart() {
  const L = lines(), can = SET.open !== false && !!SET.whatsapp;
  const f = (k, l, type, extra) => `<label class="fl"><span>${l}</span><input data-me="${k}" type="${type}" value="${esc(ME[k] || '')}" ${extra || ''}></label>`;
  $('#cartbody').innerHTML = `<div class="dh"><h2>${t('cart')}</h2><button type="button" class="x" data-act="close" aria-label="${t('close')}">×</button></div>
    ${!L.n ? `<p class="msg">${t('cartEmpty')}</p><button type="button" class="btn full" data-act="close">${t('keepShopping')}</button>` : `
    ${L.o.length ? `<section><h3>${t('order')}<small>${t('orderSub')}</small></h3><ul class="cl">${L.o.map(x => lineHTML(x)).join('')}</ul><p class="tot"><span>${t('total')}</span><b>${money(L.ot)}</b></p><p class="note">${t('pay')}</p></section>` : ''}
    ${L.r.length ? `<section class="rq"><h3>${t('requests')}<small>${t('reqSub')}</small></h3><ul class="cl">${L.r.map(x => lineHTML(x, 1)).join('')}</ul><p class="tot"><span>${t('reqTotal')}</span><b>${money(L.rt)}</b></p>${L.pct ? `<p class="tot down"><span>${t('down', L.pct)}</span><b>${money(L.down)}</b></p><p class="note">${t('downNote', L.pct)}</p>` : ''}</section>` : ''}
    ${L.gone.length ? `<p class="note">${t('gone')}: ${L.gone.length} <button type="button" class="linkbtn" data-act="dropgone">${t('remove')}</button></p>` : ''}
    <section><h3>${t('details')}</h3><div class="fg">${f('name', t('name'), 'text', 'autocomplete="name"')}${f('phone', t('phone'), 'tel', 'autocomplete="tel" dir="ltr" inputmode="tel"')}${f('address', t('address'), 'text', 'autocomplete="street-address"')}${f('note', t('note'), 'text')}</div></section>
    <p class="err" id="cerr" hidden></p>
    ${can ? `<button type="button" class="btn full wa" data-act="send">${t('send')}</button>` : `<p class="banner">${SET.open === false ? t('closed') : t('noWa')}</p>`}
    ${ME.sentAt ? `<button type="button" class="linkbtn" data-act="clearcart">${t('sent')}</button>` : ''}`}`;
}
function message(L) {
  const o = W[LANG], ln = x => `- ${x.q} × ${x.p.name}${x.p.brand ? ` (${x.p.brand})` : ''} · ${money(x.q * (+x.p.price || 0))}`;
  const out = [o.msgHead(SET.name || 'Shanta'), ''];
  if (L.o.length) out.push(o.msgOrder + ':', ...L.o.map(ln), `${o.msgTotal}: ${money(L.ot)}`, '');
  if (L.r.length) out.push(o.msgReq(L.pct) + ':', ...L.r.map(ln), `${o.msgTotal}: ${money(L.rt)}`, ...(L.pct ? [`${o.msgDown}: ${money(L.down)}`] : []), '');
  out.push(`${o.msgName}: ${ME.name}`, `${o.msgPhone}: ${ME.phone}`, `${o.msgAddr}: ${ME.address}`);
  if (String(ME.note || '').trim()) out.push(`${o.msgNote}: ${ME.note}`);
  return out.join('\n');
}
function toast(m) { const e = $('#toast'); e.textContent = m; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 2200); }

/* ---- events ---- */
document.addEventListener('click', e => {
  const a = e.target.closest('[data-add]');
  if (a) { const p = BY[a.dataset.add]; if (!p) return; setQty(p.id, 1); toast(p.status === 'in' ? t('added') : t('requested')); return draw(); }
  const s = e.target.closest('[data-q]');
  if (s) { const [id, d] = s.dataset.q.split(':'); setQty(id, (CART[id] | 0) + +d); return draw(); }
  const c = e.target.closest('[data-avail]'); if (c) { UI.avail = c.dataset.avail; return draw(); }
  if (e.target.closest('#langbtn')) { LANG = LANG === 'ar' ? 'en' : 'ar'; localStorage.setItem('shop-lang', LANG); return draw(); }
  if (e.target.closest('#cartbtn')) { drawCart(); return $('#cart').showModal(); }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act;
  if (act === 'retry') load();
  if (act === 'clear') { Object.assign(UI, { q: '', avail: '', cat: '', brand: '' }); draw(); }
  if (act === 'cart') { drawCart(); $('#cart').showModal(); }
  if (act === 'close') $('#cart').close();
  if (act === 'dropgone') { lines().gone.forEach(id => delete CART[id]); save('shop-cart', CART); draw(); }
  if (act === 'clearcart') { Object.keys(CART).forEach(k => delete CART[k]); delete ME.sentAt; save('shop-cart', CART); save('shop-me', ME); toast(t('cleared')); draw(); }
  if (act === 'send') {
    const L = lines(), err = $('#cerr');
    if (!String(ME.name || '').trim() || String(ME.phone || '').replace(/\D/g, '').length < 8 || !String(ME.address || '').trim()) { err.textContent = t('need'); err.hidden = false; return; }
    ME.sentAt = new Date().toISOString(); save('shop-me', ME);
    window.open(`https://wa.me/${encodeURIComponent(SET.whatsapp)}?text=${encodeURIComponent(message(L))}`, '_blank', 'noopener');
    drawCart();
  }
});
document.addEventListener('input', e => {
  if (e.target.id === 'q') { UI.q = e.target.value; drawGrid(); return; }
  const k = e.target.dataset.me; if (k) { ME[k] = e.target.value; save('shop-me', ME); const err = $('#cerr'); if (err) err.hidden = true; }
});
document.addEventListener('change', e => { const k = e.target.dataset.f; if (k) { UI[k] = e.target.value; draw(); } });
$('#cart').addEventListener('click', e => { if (e.target === $('#cart')) $('#cart').close(); });
/* coming back to the tab: fresh stock and prices */
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && STATE === 'ok' && Date.now() - (load.at || 0) > 120000) { load.at = Date.now(); load(); } });
load.at = Date.now(); load();
