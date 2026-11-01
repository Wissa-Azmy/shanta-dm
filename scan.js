/* ---------- barcode scanning ----------
   Products are linked to their barcode (EAN) on the purchase lines: dm receipts don't print barcodes,
   so the first scan of a product links it, and every later scan finds it.
   The camera uses the browser's own barcode reader where there is one (Chrome on Android) and the
   open-source ZXing reader otherwise (iPhone). Typing the number, or a Bluetooth scanner, always works. */
const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js';
/* UPC-A (12 digits) is the same product as the EAN-13 with a leading 0 */
const normEan = s => { const c = String(s || '').replace(/\D/g, ''); return c.length === 12 ? '0' + c : c; };
function eanOK(c) {
  if (!/^(\d{8}|\d{13,14})$/.test(c)) return false;
  const d = c.split('').map(Number), chk = d.pop();
  return (10 - d.reverse().reduce((a, x, i) => a + x * (i % 2 ? 1 : 3), 0) % 10) % 10 === chk;
}
const eanLines = code => db.purchases.filter(p => p.ean === code);
function loadZXing() {
  if (window.ZXingBrowser) return Promise.resolve();
  return loadZXing.p || (loadZXing.p = new Promise((ok, no) => {
    const s = document.createElement('script'); s.src = ZXING_URL; s.onload = ok;
    s.onerror = () => { loadZXing.p = null; s.remove(); no(); };
    document.head.appendChild(s);
  }));
}
function scanDlg(id) {
  let d = $('#' + id);
  if (!d) { d = document.createElement('dialog'); d.id = id; d.className = 'sdialog'; document.body.appendChild(d); }
  return d;
}

const Scan = {
  /* opens the camera and resolves with the barcode, or null when cancelled.
     With onEach the camera stays on: every code is passed to onEach, which returns a message to show,
     or null to stop scanning */
  read(title, onEach) {
    try { const AC = window.AudioContext || window.webkitAudioContext; if (AC) { this.ac = this.ac || new AC(); this.ac.resume(); } } catch (e) { }
    if (this.res) this.finish(null);
    return new Promise(res => {
      this.res = res; this.last = ""; this.each = onEach || null; this.pause = 0;
      const d = scanDlg('scandlg');
      d.innerHTML = `<div class="scanbox"><h2>${esc(title || 'Scan a barcode')}</h2>
        <div class="scanview"><video playsinline muted autoplay></video><div class="scanframe"></div>
        <button type="button" class="btn sm scantorch" data-sc="torch" hidden>Torch</button></div>
        <p class="scanmsg">Starting the camera…</p>
        <form class="scantype" data-sc="type"><input inputmode="numeric" autocomplete="off" placeholder="…or type the number under the barcode"><button class="btn sm">Use</button></form>
        <div class="mact"><button type="button" class="btn ghost" data-sc="cancel">${onEach ? "Done" : "Cancel"}</button></div></div>`;
      if (!d.dataset.wired) {
        d.dataset.wired = 1;
        /* the close event arrives a moment later: ignore it if the next scan has already opened */
        d.addEventListener('close', () => { if (!d.open) this.finish(null); });
        d.addEventListener('click', e => { const b = e.target.closest('[data-sc]'); if (!b) return; if (b.dataset.sc === 'cancel') d.close(); if (b.dataset.sc === 'torch') this.torch(); });
        d.addEventListener('submit', e => {
          e.preventDefault();
          const c = normEan(d.querySelector('.scantype input').value);
          if (eanOK(c)) this.done(c); else this.msg('That number doesn’t look like a barcode. Check the digits.');
        });
      }
      d.showModal(); this.start(d);
    });
  },
  msg(t) { const m = $('#scandlg .scanmsg'); if (m) m.textContent = t; },
  async start(d) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      return this.msg(window.isSecureContext ? 'This browser can’t use the camera. Type the number instead.' : 'The camera only works in the hosted app (https). Type the number instead.');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }); }
    catch (e) { return this.msg(e.name === 'NotAllowedError' ? 'Camera access was blocked. Allow it in the browser settings, or type the number.' : 'No camera found. Type the number instead.'); }
    if (!this.res || !d.open) return stream.getTracks().forEach(t => t.stop());
    this.stream = stream;
    const v = d.querySelector('video'); v.srcObject = stream; v.play().catch(() => { });
    const track = stream.getVideoTracks()[0], cap = track.getCapabilities ? track.getCapabilities() : {};
    if (cap.torch) d.querySelector('.scantorch').hidden = false;
    this.msg('Hold the barcode inside the frame.');
    let formats = [];
    if ('BarcodeDetector' in window) formats = await BarcodeDetector.getSupportedFormats().catch(() => []);
    if (formats.includes('ean_13')) {
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'].filter(f => formats.includes(f)) });
      const tick = async () => {
        if (this.stream !== stream) return;
        try { if (v.readyState >= 2) { const r = await det.detect(v); if (r[0]) this.hit(r[0].rawValue); } } catch (e) { }
        if (this.stream === stream) this.timer = setTimeout(tick, 120);
      };
      tick();
    } else {
      try { await loadZXing(); } catch (e) { return this.msg('The scanner couldn’t load (it needs an internet connection). Type the number instead.'); }
      if (this.stream !== stream) return;
      const reader = new ZXingBrowser.BrowserMultiFormatOneDReader();
      try { this.ctl = await reader.decodeFromStream(stream, v, r => r && this.hit(r.getText())); }
      catch (e) { this.msg('The scanner couldn’t start. Type the number instead.'); }
      if (this.stream !== stream && this.ctl) { this.ctl.stop(); this.ctl = null; }
    }
  },
  /* accept a code once it is read twice in a row with a valid check digit */
  hit(raw) {
    const c = normEan(raw); if (!eanOK(c) || Date.now() < this.pause) return;
    if (this.last === c) this.done(c); else this.last = c;
  },
  done(code) {
    try { navigator.vibrate && navigator.vibrate(60); } catch (e) { }
    try { const a = this.ac, o = a.createOscillator(), g = a.createGain(); o.frequency.value = 1100; g.gain.value = .08; o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + .09); } catch (e) { }
    if (!this.each) return this.finish(code);
    const r = this.each(code); if (r === null) return this.finish(null);
    this.msg(r); this.last = ""; this.pause = Date.now() + 1500;
    const i = $("#scandlg .scantype input"); if (i) i.value = "";
  },
  finish(code) {
    clearTimeout(this.timer);
    if (this.ctl) { try { this.ctl.stop(); } catch (e) { } this.ctl = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    this.torchOn = false; this.each = null;
    const res = this.res; this.res = null;
    const d = $('#scandlg'); if (d && d.open) d.close();
    res && res(code);
  },
  torch() {
    const t = this.stream && this.stream.getVideoTracks()[0]; if (!t) return;
    this.torchOn = !this.torchOn; t.applyConstraints({ advanced: [{ torch: this.torchOn }] }).catch(() => { });
  }
};
/* ---------- what a scan finds, and linking unknown barcodes ---------- */
const SCANICON = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M7 8v8M10 8v8M13 8v8M16.5 8v8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
/* after: set while selling, so a newly linked barcode goes straight into the sale */
const SX = { code: '', q: '', box: '', groups: [], after: null };
const grpKey = p => (p.product || '').trim().toLowerCase() + '|' + (p.brand || '').trim().toLowerCase();
/* purchase lines without a barcode, one entry per product (same name and brand) */
function unlinkedGroups() {
  const R = calc(), g = {};
  db.purchases.forEach(p => {
    if (p.ean) return;
    const k = grpKey(p), x = g[k] || (g[k] = { product: p.product, brand: p.brand || '', ids: [], left: 0, date: '', boxes: new Set() });
    x.ids.push(p.id); x.left += Math.max(0, (R.lots[p.id] || {}).left || 0);
    if ((p.date || '') > x.date) x.date = p.date || '';
    x.boxes.add(db.shipments.some(s => s.id === p.shipmentId) ? p.shipmentId : 'none');
  });
  return Object.values(g).sort((a, b) => (b.left > 0) - (a.left > 0) || b.date.localeCompare(a.date) || a.product.localeCompare(b.product));
}
/* barcode already known for a product with this name: same name and brand first, then the same name
   ignoring brand, case, spaces and punctuation. Only used when that name has exactly one barcode. */
const nameKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '');
function eanFor(product, brand) {
  const k = grpKey({ product, brand }), n = nameKey(product), a = new Set(), b = new Set();
  if (!n) return '';
  db.purchases.forEach(p => { if (!p.ean) return; if (grpKey(p) === k) a.add(p.ean); if (nameKey(p.product) === n) b.add(p.ean); });
  return a.size === 1 ? [...a][0] : !a.size && b.size === 1 ? [...b][0] : '';
}
/* gives the barcode to the chosen lines and to every other line of the same product still without one */
function linkEan(ids, code, noCommit) {
  const keys = new Set(db.purchases.filter(p => ids.includes(p.id)).map(grpKey));
  db.purchases.forEach(p => { if (ids.includes(p.id) || (!p.ean && keys.has(grpKey(p)))) p.ean = code; });
  if (!noCommit) commit();
}
function showCode(code, after) {
  Object.assign(SX, { code, q: '', box: '', after: after || null });
  const d = scanDlg('lookdlg');
  eanLines(code).length ? drawKnown() : drawLink();
  if (!d.open) d.showModal();
}
const scanNext = () => Scan.read().then(c => c && showCode(c));

function drawKnown() {
  const R = calc(), ls = eanLines(SX.code).sort((a, b) => (b.date || '').localeCompare(a.date || '')), p = ls[0];
  const left = ls.reduce((a, x) => a + Math.max(0, (R.lots[x.id] || {}).left || 0), 0);
  scanDlg('lookdlg').innerHTML = `<div class="sdbody"><div class="eyebrow">Barcode <span class="mono notr">${SX.code}</span></div>
    <h2>${esc(p.product)}</h2><p class="lead">${esc(p.brand || '')}${p.brand ? ' · ' : ''}<b>${left} left</b> in stock</p>
    <div class="tablewrap"><table class="t"><thead><tr><th>Shipment</th><th>Bought</th><th class="num">Qty</th><th class="num">Left</th><th class="num">Cost incl. shipping</th></tr></thead><tbody>
    ${ls.map(x => { const l = R.lots[x.id] || {}; return `<tr><td>${x.shipmentId ? esc(shipName(x.shipmentId)) : '<span class="pill warn">Not shipped</span>'}${x.product !== p.product ? `<span class="sub">${esc(x.product)}</span>` : ''}</td>
      <td>${fDate(x.date)}</td><td class="num">${x.qty}</td><td class="num"><b>${Math.max(0, l.left || 0)}</b></td><td class="num">${l.landed ? fEGP(eur2egp(l.landed)) : '—'}</td></tr>`; }).join('')}
    </tbody></table></div>
    <div class="mact"><button type="button" class="btn ghost" data-lx="close">Close</button><button type="button" class="btn ghost" data-lx="more">Link more lines</button>
    <button type="button" class="btn ghost" data-lx="buy">+ Add purchase</button>${left ? '<button type="button" class="btn ghost" data-lx="sell">Sell</button>' : ''}<button type="button" class="btn" data-lx="again">${SCANICON} Scan another</button></div></div>`;
}
function drawLink() {
  SX.groups = unlinkedGroups();
  const known = eanLines(SX.code).length, boxes = db.shipments.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const o = (v, l) => `<option value="${v}"${SX.box === v ? ' selected' : ''}>${esc(l)}</option>`;
  scanDlg('lookdlg').innerHTML = `<div class="sdbody"><div class="eyebrow">Barcode <span class="mono notr">${SX.code}</span></div>
    <h2>${known ? 'Link more lines' : 'New barcode'}</h2>
    <p class="lead">${known ? 'Pick another product line that has this barcode, e.g. the same product named differently on another receipt.' : 'This barcode isn’t linked to a product yet. Pick the product it belongs to; all its lines get the barcode, so the next scan finds it.'}</p>
    <div class="toolbar"><input type="search" data-lxq placeholder="Search product or brand" value="${esc(SX.q)}" autocomplete="off">
    <select data-lxbox>${o('', 'All boxes')}${boxes.map(s => o(s.id, s.name)).join('')}${o('none', 'Not in a box')}</select></div>
    <ul class="linklist" id="lxlist">${linkListHTML()}</ul>
    <div class="mact"><button type="button" class="btn ghost" data-lx="${known ? 'back' : 'close'}">${known ? 'Back' : 'Cancel'}</button>${SX.after ? '' : '<button type="button" class="btn ghost" data-lx="new">+ Add as a new purchase</button>'}</div></div>`;
}
function linkListHTML() {
  const q = SX.q.trim().toLowerCase();
  const rows = SX.groups.map((g, i) => [g, i]).filter(([g]) => (!SX.box || g.boxes.has(SX.box)) && (!q || (g.product + ' ' + g.brand).toLowerCase().includes(q)));
  return rows.slice(0, 80).map(([g, i]) => `<li><button type="button" data-lx="link:${i}"><b>${esc(g.product)}</b>
    <span class="sub">${[g.brand && esc(g.brand), [...g.boxes].map(b => b === 'none' ? 'Not shipped' : esc(shipName(b))).join(', '), `${g.left} left`].filter(Boolean).join(' · ')}</span></button></li>`).join('')
    || `<li class="empty">${SX.groups.length ? 'No product without a barcode matches.' : 'Every product already has a barcode.'}</li>`;
}

document.addEventListener('click', e => {
  if (!e.target.closest('[data-scanfind]')) return;
  Scan.read('Find a product').then(c => {
    if (!c) return;
    if (!eanLines(c).length) return showCode(c);
    /* show every box of it, sold out ones too, so "0 left" is visible */
    UI.q = c; UI.box = ''; UI.stockStatus = 'all'; render();
  });
});
document.addEventListener('click', e => {
  const s = e.target.closest('[data-scan],[data-scanrow],[data-scanfield],[data-lx]'); if (!s) return;
  if (s.dataset.scan !== undefined) return scanNext();
  if (s.dataset.scanfield) {
    readForm(); const k = s.dataset.scanfield;
    return Scan.read().then(c => { if (c && modal) { modal.v[k] = c; drawForm(); } });
  }
  if (s.dataset.scanrow) {
    const p = db.purchases.find(x => x.id === s.dataset.scanrow); if (!p) return;
    return Scan.read('Scan the barcode of ' + p.product).then(c => {
      if (!c) return;
      const other = eanLines(c).find(x => grpKey(x) !== grpKey(p));
      if (other && !confirm(`This barcode is already linked to “${other.product}”.\nLink it to this product too?`)) return;
      linkEan([p.id], c); toast(`Barcode linked to “${p.product}”`);
    });
  }
  const a = s.dataset.lx, d = $('#lookdlg');
  if (a === 'close') d.close();
  else if (a === 'again') scanNext();
  else if (a === 'more') drawLink();
  else if (a === 'back') drawKnown();
  else if (a === 'new') { d.close(); openForm('purchases', null, { ean: SX.code }); }
  else if (a === 'sell') { d.close(); sellCode(SX.code); }
  else if (a === 'buy') {
    const p = eanLines(SX.code).sort((x, y) => (y.date || '').localeCompare(x.date || ''))[0]; d.close();
    openForm('purchases', null, { product: p.product, brand: p.brand, category: p.category, netG: p.netG, ean: SX.code });
  } else if (a.startsWith('link:')) {
    const g = SX.groups[+a.slice(5)]; if (!g) return;
    linkEan(g.ids, SX.code); toast(`Barcode linked to “${g.product}”`);
    if (SX.after) { const f = SX.after; SX.after = null; d.close(); f(SX.code); } else drawKnown();
  }
});
document.addEventListener('input', e => { if (e.target.matches('[data-lxq]')) { SX.q = e.target.value; $('#lxlist').innerHTML = linkListHTML(); } });
document.addEventListener('change', e => { if (e.target.matches('[data-lxbox]')) { SX.box = e.target.value; $('#lxlist').innerHTML = linkListHTML(); } });
