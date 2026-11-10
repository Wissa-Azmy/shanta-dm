/* ---------- online shop: publish the catalog customers browse ----------
   The shop (the shop/ folder next to this app) never sees the ledger. Shanta writes a public copy of what
   can be sold: catalog/<product> with name, brand, price and how many are in Egypt, and shop/settings with
   the shop's name, WhatsApp number and the down payment on requests. One entry per product (its barcode,
   or name + brand when it has none). Products with nothing left in Egypt stay listed, so customers can
   request them. Price = the suggested price of the oldest units in Egypt (else of the latest purchase).
   Photos: dm's own photo for dm products (needs the dm search relay), else Open Beauty Facts / Open Food
   Facts, by barcode, looked up once and remembered. */
const SHOP_IMG_KEY = 'shanta-shop-img', SHOP_PUB_KEY = 'shanta-shop-pub';
const jsonLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } };
const ShopPub = { busy: false, again: false, msg: '', t: null, imgs: jsonLS(SHOP_IMG_KEY, {}), pub: jsonLS(SHOP_PUB_KEY, null) };
const shopUrl = () => new URL('shop/', location.href.split('#')[0]).href;
/* Firestore ids can't hold "/": barcodes stay as they are, names become a short hash */
const shopId = k => /^\d{6,14}$/.test(k) ? k : 'n' + [...k].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381).toString(36);
const shopSize = t => { const m = String(t || '').match(/(?<![\d.,])(\d+(?:[.,]\d+)?)\s?(kg|g|ml|l|stück|st\.?)(?![a-zäöü])/i); return m ? m[0].trim() : ''; };
/* 01012345678 → 201012345678 (Egypt), +49 151… → 49151… */
const waNumber = v => { const d = String(v || '').replace(/\D/g, ''); return /^01\d{9}$/.test(d) ? '2' + d : d.replace(/^00/, ''); };
function shopItems(R = calc()) {
  const hid = db.settings.shopHidden || [], m = new Map();
  const held = typeof shopHeld === 'function' ? shopHeld() : {};
  const where = l => { const s = db.shipments.find(x => x.id === l.p.shipmentId); return !s || s.status === 'Packing' ? 'de' : s.status === 'Delivered' ? 'eg' : 'way'; };
  Object.values(R.lots).forEach(l => {
    const k = l.p.ean || 'n:' + grpKey(l.p);
    const x = m.get(k) || m.set(k, { key: k, id: shopId(k), name: l.p.product, brand: l.p.brand || '', store: storeOf(l.p), category: l.p.category || '', ean: l.p.ean || '', eg: 0, way: 0, de: 0, lots: [] }).get(k);
    x.lots.push(l); if (l.left > 0) x[where(l)] += l.left;
  });
  return [...m.values()].map(x => {
    x.lots.sort((a, b) => (a.p.date || '').localeCompare(b.p.date || ''));
    const l = x.lots.find(l => l.left > 0 && where(l) === 'eg') || x.lots[x.lots.length - 1];
    x.price = suggestEGP(l); x.hidden = hid.includes(x.key);
    /* units in shop orders not yet turned into a sale are held, so two customers can't buy the last one */
    x.held = Math.min(x.eg, held[x.id] || 0); x.avail = x.eg - x.held;
    x.status = x.avail > 0 ? 'in' : x.way > 0 ? 'way' : 'request';
    return x;
  }).sort((a, b) => a.name.localeCompare(b.name));
}
const shopDoc = x => ({ name: x.name, brand: x.brand, store: x.store, category: x.category, size: shopSize(x.name), ean: x.ean, price: x.price, avail: x.avail, status: x.status, img: ShopPub.imgs[x.ean] || '' });
const shopSettingsDoc = () => { const s = db.settings;
  const pct = v => Math.max(0, Math.min(100, num(v)));
  return { name: String(s.shopName || 'Shanta').trim(), whatsapp: waNumber(s.shopWhatsapp), instapay: String(s.shopInstapay || '').trim(), reqDownPct: pct(s.shopReqDown),
    downCod: pct(s.shopDownCod), downInsta: pct(s.shopDownInsta ?? 100), deliveryFee: Math.max(0, num(s.shopDelivery)), googleClientId: String(s.shopGoogleId || '').trim(), open: s.shopOpen !== false, lowStock: num(s.lowStock), currency: 'EGP' }; };
/* a product photo by barcode: dm's own photo for dm products (through the dm search relay), else
   Open Beauty Facts / Open Food Facts. Nothing is remembered when offline, so it is tried again next time */
const SHOP_DMI_KEY = 'shanta-shop-dmimg';
ShopPub.dmTried = jsonLS(SHOP_DMI_KEY, {});
const isDmImg = u => /dm-static\.com|dmtech\.com/.test(u || '');
async function dmImg(ean) {
  if (typeof FSRC === 'undefined' || !dmRelay()) return null;   // dm only answers through the relay (Settings → Barcode search)
  try { const r = await fetch(FSRC.dm.url(ean)); if (!r.ok) return null;
    const hit = FSRC.dm.map(await r.json()).find(x => x.code === ean && x.img);
    return hit ? hit.img : '';
  } catch (e) { return null; }
}
async function shopImg(x) {
  const ean = x.ean;
  if (x.store === 'dm' && !ShopPub.dmTried[ean]) {
    const u = await dmImg(ean);
    if (u !== null) { ShopPub.dmTried[ean] = 1; try { localStorage.setItem(SHOP_DMI_KEY, JSON.stringify(ShopPub.dmTried)); } catch (e) { } }
    if (u) { ShopPub.imgs[ean] = u; try { localStorage.setItem(SHOP_IMG_KEY, JSON.stringify(ShopPub.imgs)); } catch (e) { } return; }
    if (ean in ShopPub.imgs) return;                 // dm has none: keep the photo found before
  }
  let u = '';
  for (const site of ['openbeautyfacts', 'openfoodfacts']) {
    try { const r = await fetch(`https://world.${site}.org/api/v2/product/${encodeURIComponent(ean)}?fields=image_front_small_url,image_front_url`);
      if (r.ok) { const p = (await r.json()).product || {}; u = p.image_front_small_url || p.image_front_url || ''; } } catch (e) { return; }
    if (u) break;
  }
  ShopPub.imgs[ean] = u; try { localStorage.setItem(SHOP_IMG_KEY, JSON.stringify(ShopPub.imgs)); } catch (e) { }
}
const shopRulesMsg = 'The shop can’t be published yet: the Firestore rules need the shop part. Open Settings → Shared online ledger → Admin, type both emails, copy the rules, paste them in Firebase → Firestore Database → Rules and press Publish.';
Object.assign(ShopPub, {
  note(m) { this.msg = m; const e = $('#shop_msg'); if (e) { e.textContent = m; e.hidden = !m; } },
  async publish(manual) {
    if (this.busy) { this.again = true; return; }
    if (!Cloud.on() || Cloud.isBackup()) { if (manual) toast('⚠ Sign in to the shared ledger (the live one, not a backup) to publish the shop.'); return; }
    this.busy = true; this.again = false;
    const btn = $('[data-act="shop-pub"]'); if (btn) { btn.disabled = true; btn.textContent = 'Publishing…'; }
    try {
      await fb(); const S = F.S;
      /* "Publish now" reads what the shop has, so it fixes anything another device left behind */
      if (manual || !this.pub) {
        const q = await within(S.getDocs(S.collection(F.fs, 'catalog')), 20000, offlineMsg), st = await within(S.getDoc(S.doc(F.fs, 'shop', 'settings')), 20000, offlineMsg);
        this.pub = { cat: {}, set: '' };
        q.forEach(d => { const v = d.data(); this.pub.cat[d.id] = stable(v); if (v.ean && v.img && !this.imgs[v.ean]) this.imgs[v.ean] = v.img; });
        if (st.exists()) { const v = Object.assign({}, st.data()); delete v.updatedAt; this.pub.set = stable(v); }
      }
      const items = shopItems().filter(x => !x.hidden);
      /* dm products get dm's photo once (replacing an older Open Beauty Facts one); others only when missing */
      const need = items.filter(x => x.ean && (!(x.ean in this.imgs) || (x.store === 'dm' && typeof dmRelay === 'function' && dmRelay() && !this.dmTried[x.ean] && !isDmImg(this.imgs[x.ean]))));
      for (let i = 0; i < need.length; i++) { if (manual) this.note(`Looking up product photos… ${i + 1} of ${need.length}`); await shopImg(need[i]); if (i < need.length - 1) await sleep(650); }
      const next = {}; items.forEach(x => next[x.id] = shopDoc(x));
      const st = shopSettingsDoc(), ops = [];
      Object.entries(next).forEach(([id, d]) => { if (this.pub.cat[id] !== stable(d)) ops.push(b => b.set(S.doc(F.fs, 'catalog', id), d)); });
      Object.keys(this.pub.cat).forEach(id => { if (!(id in next)) ops.push(b => b.delete(S.doc(F.fs, 'catalog', id))); });
      const catOps = ops.length;
      if (catOps || this.pub.set !== stable(st)) ops.push(b => b.set(S.doc(F.fs, 'shop', 'settings'), Object.assign({ updatedAt: new Date().toISOString() }, st)));
      if (ops.length) await Cloud.writeAll(ops);
      this.pub = { cat: {}, set: stable(st) }; Object.entries(next).forEach(([id, d]) => this.pub.cat[id] = stable(d));
      try { localStorage.setItem(SHOP_PUB_KEY, JSON.stringify(this.pub)); } catch (e) { }
      this.note('');
      const eg = items.filter(x => x.status === 'in').length;
      if (catOps || !db.settings.shopPublished) { db.settings.shopPublished = { at: new Date().toISOString(), n: items.length, eg }; commit(); }
      if (manual) toast(`✓ Shop updated: ${items.length} products, ${eg} in stock`);
    } catch (e) {
      console.warn(e);
      const m = e && e.code === 'permission-denied' ? shopRulesMsg : (e && e.message) || fsMsg(e);
      this.note(m); if (manual) toast('⚠ ' + m);
    } finally {
      this.busy = false;
      const b = $('[data-act="shop-pub"]'); if (b) { b.disabled = false; b.textContent = 'Publish now'; }
      if (this.again) this.auto();
    }
  },
  /* after a change: update the shop a few seconds later, once it has been published */
  auto() {
    if (!db.settings.shopAuto || !db.settings.shopPublished || !Cloud.ready || Cloud.isBackup()) return;
    clearTimeout(this.t); this.t = setTimeout(() => this.publish(false), 5000);
  }
});
{ const sch = Cloud.schedule.bind(Cloud); Cloud.schedule = () => { sch(); ShopPub.auto(); }; }
Cloud.whenReady(60000).then(() => ShopPub.auto());

function shopCardHTML() {
  const s = db.settings, p = s.shopPublished, url = shopUrl();
  const f = (k, l, t, extra, hint) => `<div class="f"><label>${l}</label><input data-set="${k}" type="${t === 'number' ? 'text' : t}"${t === 'number' ? ' inputmode="decimal" data-num="1"' : ''} value="${esc(s[k] ?? '')}" ${extra || ''}>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
  const items = shopItems(), shown = items.filter(x => !x.hidden);
  const stt = { in: ['In Egypt', 'ok'], way: ['On the way', 'warn'], request: ['Request only', ''] };
  return `<div class="card" id="shopcard"><h3>Online shop</h3>
    <p class="note">Customers browse the shop at this address:</p><p class="note"><a href="${esc(url)}" target="_blank" rel="noopener" class="notr" dir="ltr">${esc(url)}</a></p><p class="note">The shop only gets names, prices and how many are in Egypt; costs, profit and partners never leave this app.</p>
    <div class="fgrid">${f('shopName', 'Shop name', 'text')}${f('shopWhatsapp', 'WhatsApp for questions', 'tel', 'dir="ltr" placeholder="01012345678"', 'Customers can message you here from the shop.')}</div>
    <div class="fgrid">${f('shopInstapay', 'InstaPay address', 'text', 'dir="ltr" placeholder="name@instapay"', 'Shown to customers who pay a down payment or pay by InstaPay.')}${f('shopDelivery', 'Delivery fee (EGP)', 'number', 'step="5" min="0"', '0 = free delivery. Added to every order.')}</div>
    ${f('shopGoogleId', 'Google sign-in client ID', 'text', 'dir="ltr" placeholder="1234567890-abc….apps.googleusercontent.com" autocomplete="off"', 'Firebase → Authentication → Sign-in method → Google → Web SDK configuration → Web client ID. Without it, Google sign-in may not work in browsers that block third-party cookies.')}
    <div class="fgrid">${f('shopDownCod', 'Down payment, cash on delivery (%)', 'number', 'step="1" min="0" max="100"', 'Paid by InstaPay before you confirm; the rest to the courier.')}${f('shopDownInsta', 'Down payment, InstaPay orders (%)', 'number', 'step="1" min="0" max="100"', '100 = paid in full upfront.')}</div>
    ${f('shopReqDown', 'Down payment on requests (%)', 'number', 'step="1" min="0" max="100"', 'Asked when a customer requests a product that isn’t in Egypt. A change applies to new requests only.')}
    <div class="f chk"><input type="checkbox" id="sh_open" data-set="shopOpen"${s.shopOpen !== false ? ' checked' : ''}><label for="sh_open">Shop is open for orders</label></div>
    <div class="f chk"><input type="checkbox" id="sh_auto" data-set="shopAuto"${s.shopAuto !== false ? ' checked' : ''}><label for="sh_auto">Update the shop after every change (sales, counts, moves, prices)</label></div>
    <p class="note">${p ? `Last published ${esc(fDateTime(p.at))} · ${p.n} products, ${p.eg} in stock` : 'Not published yet.'}</p>
    <div class="err" id="shop_msg"${ShopPub.msg ? '' : ' hidden'}>${esc(ShopPub.msg)}</div>
    <div class="topact"><button type="button" class="btn" data-act="shop-pub">Publish now</button><a class="btn ghost" href="${esc(url)}" target="_blank" rel="noopener">Open the shop ↗</a></div>
    <details class="howto"><summary>Products in the shop (${shown.length} of ${items.length})</summary><div class="howto-b">
      <p class="note">Untick a product to hide it from the shop. Prices follow the suggested price (today’s rate + ${num(s.targetMargin)}% markup).</p>
      <ul class="mini shoplist">${items.map(x => `<li><label class="shrow"><input type="checkbox" data-shophide="${esc(x.key)}"${x.hidden ? '' : ' checked'}><span><b class="notr">${esc(x.name)}</b><span class="sub"><span class="notr">${esc(x.brand)}</span> · ${fEGP(x.price)}${x.eg ? ` · ${x.eg} in Egypt` : ''}</span></span></label><span class="pill ${stt[x.status][1]}">${stt[x.status][0]}</span></li>`).join('') || '<li class="note">No products yet.</li>'}</ul>
      <p class="note">${typeof dmRelay === 'function' && dmRelay() ? 'dm products show dm’s own photo; other products use Open Beauty Facts.' : 'To show dm’s own photos, add the dm search relay in Settings → Barcode search.'}</p>
      <button type="button" class="btn sm ghost" data-act="shop-imgs">Look for missing photos again</button></div></details>
    <p class="note">First time only: the Firestore rules need the shop part. In Shared online ledger → Admin, type both emails, copy the rules and publish them in Firebase.</p></div>`;
}
{ const vs = V.settings, mark = '<div class="card"><h3>Barcode search</h3>';
  V.settings = Object.assign(R => { const h = vs(R); return h.includes(mark) ? h.replace(mark, shopCardHTML() + mark) : h + shopCardHTML(); }, { after: vs.after }); }

document.addEventListener('click', e => {
  const t = e.target.closest('[data-act="shop-pub"],[data-act="shop-imgs"]'); if (!t) return;
  if (t.dataset.act === 'shop-imgs') {
    Object.keys(ShopPub.imgs).forEach(k => { if (!ShopPub.imgs[k]) { delete ShopPub.imgs[k]; delete ShopPub.dmTried[k]; } });
    try { localStorage.setItem(SHOP_DMI_KEY, JSON.stringify(ShopPub.dmTried)); } catch (x) { }
    try { localStorage.setItem(SHOP_IMG_KEY, JSON.stringify(ShopPub.imgs)); } catch (x) { }
  }
  ShopPub.publish(true);
});
document.addEventListener('change', e => {
  const c = e.target.closest && e.target.closest('[data-shophide]'); if (!c) return;
  const k = c.dataset.shophide, h = new Set(db.settings.shopHidden || []);
  c.checked ? h.delete(k) : h.add(k); db.settings.shopHidden = [...h]; commit();
});
