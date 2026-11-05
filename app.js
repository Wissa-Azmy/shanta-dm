/* ---------- shell ---------- */
const pre = o => `data-preset="${esc(JSON.stringify(o))}"`;
const NAV = [
  ['overview', '◎', 'Overview', 'Who owes whom, at a glance'],
  ['shipments', '✈', 'Shipments', 'Boxes from Germany to Egypt'],
  ['purchases', '🛒', 'Purchases', 'What was bought at dm'],
  ['stock', '▦', 'Stock', 'What is left and what to charge'],
  ['sales', '£', 'Sales', 'What was sold in Egypt'],
  ['customers', '☺', 'Customers', 'Who still owes what, and their payments'],
  ['expenses', '✉', 'Expenses', 'Shipping, customs and other costs'],
  ['transfers', '⇄', 'Transfers', 'Money between the two of you'],
  ['ledger', '☰', 'Ledger', 'Every movement: who, when, where, how much'],
  ['settings', '⚙', 'Settings', 'Names, split, rate and your data file']
];
const NEWBTN = { shipments: 'New shipment', purchases: 'Add purchase', sales: 'Record sale', customers: 'Credit payment', expenses: 'Add expense', transfers: 'Record transfer', stock: 'Record sale' };
let view = localStorage.getItem('shanta-view') || 'overview';

function counts() { return { shipments: db.shipments.length, purchases: db.purchases.length, sales: db.sales.length, customers: Object.values(calc().book.customers).filter(c => c.balanceEGP > 0.005).length, expenses: db.expenses.length, transfers: db.transfers.length }; }
function renderFile() {
  const box = $('#filebox'); if (!box) return;
  let dot = 'bad', st = 'Only in this browser', p = 'Not saved to a file yet. Click “Save as…” to pick a file on your disk.', btns = `<button class="btn sm" data-act="saveas">Save as…</button><button class="btn sm ghost" data-act="open">Open</button>`;
  if (fileHandle && !filePerm) { dot = ''; st = 'File needs permission'; p = `Linked to ${esc(fileName)}. Click to allow saving again.`; btns = `<button class="btn sm" data-act="reconnect">Reconnect</button><button class="btn sm ghost" data-act="open">Open other</button>`; }
  else if (fileHandle) {
    dot = dirty ? '' : 'ok'; st = dirty ? 'Unsaved changes' : 'Saved to disk';
    p = `${esc(fileName)}${db.meta.savedAt ? ' · ' + new Date(db.meta.savedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}`;
    btns = `<button class="btn sm" data-act="save">Save</button><button class="btn sm ghost" data-act="saveas">Save as…</button><button class="btn sm ghost" data-act="open">Open</button>`;
  } else if (!canFS()) {
    st = dirty ? 'Download a backup' : 'Backup downloaded'; dot = dirty ? 'bad' : 'ok';
    p = 'This browser can’t write files directly. Download a backup after changes.';
    btns = `<button class="btn sm" data-act="download">Download</button><button class="btn sm ghost" data-act="import">Restore from file</button>`;
  }
  box.innerHTML = `<div class="st"><span class="dot ${dot}"></span>${st}</div><p>${p}</p><div class="row">${btns}</div>` + Cloud.statusHTML();
}
function render() {
  const c = counts();
  $('#nav').innerHTML = NAV.map(([k, i, l]) => `<button class="${k === view ? 'on' : ''}" data-go="${k}"><i>${i}</i>${l}${c[k] ? `<span class="cnt">${c[k]}</span>` : ''}</button>`).join('');
  const n = NAV.find(x => x[0] === view) || NAV[0];
  $('#eyebrow').textContent = n[3]; $('#vtitle').textContent = n[2];
  $('#topact').innerHTML = NEWBTN[view] ? `${view === 'purchases' ? `<button class="btn ghost" data-scan="">${SCANICON} Scan barcode</button>${(typeof noEanGroups === 'function' ? noEanGroups().length : db.purchases.some(p => !p.ean)) ? '<button class="btn ghost" data-obffind="">Find barcodes</button>' : ''}` : ''}${view === 'stock' ? `<button class="btn ghost" data-scanfind="">${SCANICON} Find by scan</button>${typeof cntBoxes === 'function' && cntBoxes().length ? `<button class="btn ghost" data-count="">${SCANICON} Count Egypt stock</button>` : ''}` : ''}${view === 'sales' || view === 'stock' ? `<button class="btn ghost" data-scansell="">${SCANICON} Scan to sell</button>` : ''}${view === 'purchases' || view === 'shipments' ? `<button class="btn ghost" data-receipt="">${RCPTICON} Import receipt</button>` : ''}<button class="btn" data-new="${view === 'stock' ? 'sales' : view === 'customers' ? 'payments' : view}">+ ${NEWBTN[view]}</button>` :
    view === 'overview' && db.purchases.length ? `<button class="btn ghost" data-new="purchases">+ Purchase</button><button class="btn ghost" data-new="expenses">+ Expense</button><button class="btn" data-new="sales">+ Sale</button>` : '';
  if (chart) { chart.destroy(); chart = null; }
  const R = calc();
  $("#view").innerHTML = Cloud.bannerHTML() + (Cloud.loading() ? Cloud.loadingHTML() : V[view](R));
  document.querySelectorAll("[data-mixed]").forEach(c => c.indeterminate = true);
  document.body.classList.toggle("hassel", !!$("#view .selbar")); placeBars();
  V[view].after && V[view].after();
  renderFile();
  document.title = 'Shanta dm · ' + n[2];
}
function go(v) { view = v; UI.q = ''; UI.type = ''; localStorage.setItem('shanta-view', v); render(); window.scrollTo(0, 0); }

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-go],[data-new],[data-edit],[data-del],[data-act]'); if (!t) return;
  if (t.dataset.go) return go(t.dataset.go);
  if (t.dataset.new) return openForm(t.dataset.new, null, t.dataset.preset ? JSON.parse(t.dataset.preset) : null);
  if (t.dataset.edit) { const [c, id] = t.dataset.edit.split(':'); return openForm(c, id); }
  if (t.dataset.del) { const [c, id] = t.dataset.del.split(':'); return deleteRec(c, id); }
  const [a, arg] = t.dataset.act.split(':');
  if (a === 'advance') { const s = db.shipments.find(x => x.id === arg); if (s) { const i = OPT.status.indexOf(s.status); s.status = OPT.status[Math.min(i + 1, OPT.status.length - 1)]; if (s.status === 'Delivered') s.deliveredOn = today(); commit(); toast(s.name + ': ' + s.status); } }
  if (a === 'save') saveFile(false);
  if (a === 'saveas') saveFile(true);
  if (a === 'open') openFile();
  if (a === 'reconnect') reconnect();
  if (a === 'download') downloadJSON();
  if (a === 'import') $('#fileInput').click();
  if (a === 'csv') V.ledger.csv();
  if (a === 'filtersreset') { t.dataset.keys.split(',').forEach(k => UI[k] = FILTER_DEFAULT[k]); render(); }
  if (a === 'setpack') { db.settings.packagingPct = num(arg); commit(); toast('Packaging set to ' + num(arg) + '%'); }
  if (a === 'fillw') { const m = missingW(); m.forEach(p => p.netG = parseWeightG(p.product)); commit(); toast(m.length + ' weights filled in'); }
  if (a === 'fx') { t.textContent = 'Fetching…'; updateRate(true); }
  if (a === 'selclear') { SEL.clear(); render(); }
  if (a === 'sellsel') { const ids = [...SEL]; SEL.clear(); render(); openOrder(null, { purchaseIds: ids }); }
  if (a === 'movesel') { const ids = [...SEL]; SEL.clear(); render(); openMove(ids); }
  if (a === 'ratesel') { const ids = [...SEL]; openRate(ids, ids.length + ' selected product' + (ids.length === 1 ? '' : 's')); }
});
/* Stock: pick products to sell together */
/* a tap anywhere on a row with units left picks or unpicks it; its buttons, links and fields keep working as usual */
document.addEventListener('click', e => {
  const r = e.target.closest('tr[data-pickrow]');
  if (!r || e.target.closest('button,a,input,select,textarea,label,[data-act],[data-edit],[data-del]')) return;
  if (String(getSelection && getSelection()).trim()) return;
  const id = r.dataset.pickrow; SEL.has(id) ? SEL.delete(id) : SEL.add(id); render();
});
document.addEventListener('change', e => {
  const c = e.target;
  if (c.dataset.sel) { c.checked ? SEL.add(c.dataset.sel) : SEL.delete(c.dataset.sel); render(); }
  else if (c.dataset.selall) { const ids = [...document.querySelectorAll('[data-sel]')].map(x => x.dataset.sel); ids.forEach(id => c.checked ? SEL.add(id) : SEL.delete(id)); render(); }
});
document.addEventListener('input', e => {
  const u = e.target.dataset.ui;
  if (u) {
    UI[u] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    const pos = e.target.selectionStart, had = document.activeElement === e.target; render();
    if (u === 'q' && had) { const el = $('[data-ui="q"]'); el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) { } }
    return;
  }
  const k = e.target.dataset.set;
  if (k) {
    db.settings[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.dataset.num ? num(e.target.value) : e.target.value;
    if (k === 'meShare') db.settings.meShare = Math.max(0, Math.min(100, db.settings.meShare));
    if (k === 'rate') db.settings.rateManual = today();
    clearTimeout(render._s); render._s = setTimeout(() => { const id = document.activeElement && document.activeElement.dataset.set; commit(); if (id) { const el = $(`[data-set="${id}"]`); if (el) { el.focus(); if (el.type === 'text') el.setSelectionRange(el.value.length, el.value.length); } } }, 500);
  }
});
$('#fileInput').addEventListener('change', e => { const f = e.target.files[0]; if (f) importFromInput(f); e.target.value = ''; });
window.addEventListener('beforeunload', e => { if (dirty && (fileHandle || !canFS())) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); fileHandle ? saveFile(false) : saveFile(true); } });

/* ---------- sample data ---------- */
function demoData() {
  const d = DEFAULT_DB(); d.settings.meName = 'Me'; d.settings.friendName = 'Mona'; d.settings.rate = 55;
  const ago = n => { const x = new Date(); x.setDate(x.getDate() - n); return x.toISOString().slice(0, 10); };
  const s1 = { id: uid(), name: 'Box #1', date: ago(70), status: 'Delivered', carrier: 'DHL', tracking: 'JD0146000', weight: 9.5, deliveredOn: ago(58) };
  const s2 = { id: uid(), name: 'Box #2', date: ago(12), status: 'In customs', carrier: 'Aramex', tracking: 'AX88123', weight: 7 };
  d.shipments.push(s1, s2);
  const P = (n, date, product, brand, category, qty, unitCost, sh, receipt, paidBy = 'me') => { const p = { id: uid(), date: ago(date), product, brand, category, qty, unitCost, paidBy, method: 'Card', place: 'dm, Berlin', shipmentId: sh.id, receipt }; d.purchases.push(p); return p; };
  const a = P(1, 72, 'Hyaluron Serum', 'Balea', 'Skin care', 10, 3.95, s1, '4471');
  const b = P(1, 72, 'Sun Fluid SPF 50+', 'Sundance', 'Skin care', 12, 4.45, s1, '4471');
  const c = P(1, 72, 'Urea Hand Cream', 'Balea Med', 'Body care', 15, 1.95, s1, '4471');
  const e = P(1, 71, 'Vitamin C Ampoules', 'Balea', 'Skin care', 8, 4.95, s1, '4502');
  const f = P(1, 71, 'Mascara Lash Sensational', 'Maybelline', 'Make-up', 6, 9.95, s1, '4502');
  P(1, 14, 'Hyaluron Serum', 'Balea', 'Skin care', 12, 3.95, s2, '5120');
  P(1, 14, 'Retinol Night Cream', 'Balea', 'Skin care', 8, 5.45, s2, '5120');
  P(1, 13, 'Dry Shampoo', 'Batiste', 'Hair care', 10, 2.75, s2, '5133');
  d.expenses.push(
    { id: uid(), date: ago(70), category: 'Shipping', description: 'DHL parcel 10 kg', amount: 54.99, currency: 'EUR', rate: 55, paidBy: 'me', method: 'Card', place: 'DHL, Berlin', shipmentId: s1.id },
    { id: uid(), date: ago(58), category: 'Customs & duties', description: 'Customs fee at pickup', amount: 1150, currency: 'EGP', rate: 54.5, paidBy: 'friend', method: 'Cash', place: 'Cairo', shipmentId: s1.id, onDelivery: true },
    { id: uid(), date: ago(57), category: 'Packaging', description: 'Gift bags & tissue', amount: 300, currency: 'EGP', rate: 54.5, paidBy: 'friend', method: 'Cash', place: 'Cairo', shipmentId: '' },
    { id: uid(), date: ago(12), category: 'Shipping', description: 'Aramex, pay on delivery', amount: 2900, currency: 'EGP', rate: 55, paidBy: 'friend', method: 'Cash', place: 'Cairo', shipmentId: s2.id, onDelivery: true });
  const S = (date, lot, qty, price, customer, paid = true, kind = 'sale') => d.sales.push({ id: uid(), date: ago(date), kind, purchaseId: lot.id, qty, unitPrice: kind === 'sale' ? price : 0, currency: 'EGP', rate: 54.5, customer, place: 'Cairo', receivedBy: 'friend', method: 'InstaPay', paid: kind === 'sale' && paid });
  S(55, a, 3, 450, 'Nour'); S(54, b, 4, 500, 'Salma'); S(52, c, 6, 220, 'Dina'); S(50, e, 2, 550, 'Nour');
  S(45, f, 2, 950, 'Hana'); S(40, a, 4, 450, 'Yara'); S(33, b, 5, 520, 'Office order'); S(30, c, 5, 220, 'Dina');
  S(25, e, 3, 550, 'Salma'); S(20, f, 2, 950, 'Rana', false); S(18, a, 1, 0, 'Sample for Mona’s sister', false, 'gift'); S(9, b, 1, 0, '', false, 'damaged');
  d.transfers.push({ id: uid(), date: ago(35), from: 'friend', to: 'me', amount: 8000, currency: 'EGP', rate: 54.8, method: 'InstaPay', notes: 'First payback' });
  d.meta.updatedAt = new Date().toISOString();
  return d;
}

/* ---------- live EUR → EGP rate (free APIs, no key) ---------- */
async function fetchRate() {
  const sources = [
    ['https://open.er-api.com/v6/latest/EUR', j => j && j.rates && j.rates.EGP, 'exchangerate-api.com'],
    ['https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json', j => j && j.eur && j.eur.egp, 'currency-api (jsDelivr)']
  ];
  for (const [url, pick, name] of sources) {
    try {
      const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) continue;
      const v = num(pick(await r.json()));
      if (v > 1) return { rate: Math.round(v * 100) / 100, source: name };
    } catch (e) { }
  }
  throw new Error('Couldn’t get the live rate. Check your internet connection; you can still type the rate yourself.');
}
async function updateRate(manual) {
  try {
    const { rate: r, source } = await fetchRate(), s = db.settings, same = num(s.rate) === r;
    Object.assign(s, { rate: r, rateSource: source, rateAt: new Date().toISOString(), rateManual: '' });
    commit();
    if (manual) toast(`Live rate: €1 = ${r} EGP${same ? ' (unchanged)' : ''}`);
  } catch (e) { if (manual) { toast(e.message); render(); } }
}
function fxHint() {
  const s = db.settings, tail = ' Used as the default for new entries; old entries keep their own rate.';
  if (s.rateManual) return `Typed in by hand on ${fDate(s.rateManual)}.` + tail;
  if (s.rateAt) return `Live rate from ${esc(s.rateSource || 'the internet')}, ${new Date(s.rateAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. You can still type your own.` + tail;
  return 'Used as the default for new entries and to show € amounts in EGP. Old entries keep their own rate.';
}

/* ---------- start ---------- */
(async () => {
  render();
  const h = await IDB.get('handle');
  if (Cloud.on()) Cloud.start();
  if (h && h.queryPermission) { fileHandle = h; fileName = h.name; filePerm = await verifyPerm(h, false); renderFile(); }
  setTimeout(() => { const s = db.settings; if (s.rateAuto !== false && (s.rateAt || '').slice(0, 10) !== today() && s.rateManual !== today()) updateRate(false); }, 4000);
})();

/* ---------- back to top: shown once the page is scrolled down a screen ---------- */
(() => {
  const b = document.createElement('button');
  b.type = 'button'; b.id = 'totop'; b.title = 'Back to top'; b.setAttribute('aria-label', 'Back to top');
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  b.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  document.body.appendChild(b);
  const upd = () => b.classList.toggle('on', window.scrollY > Math.max(500, window.innerHeight * 0.8));
  window.addEventListener('scroll', upd, { passive: true }); upd();
})();

/* ---------- app version, and a notice when a newer one has been pushed ---------- */
(() => {
  const r = $('.rail'); if (!r) return;
  const v = document.createElement('div'); v.className = 'ver';
  v.innerHTML = `<span>Version</span> <b class="notr">${APP_VERSION}</b>`;
  r.appendChild(v);
  let lastCheck = 0;
  const check = async () => {
    if (Date.now() - lastCheck < 60000) return; lastCheck = Date.now();
    try {
      const t = await (await fetch('core.js?check=' + Date.now(), { cache: 'no-store' })).text();
      const m = t.match(/const APP_VERSION = "([^"]+)"/);
      if (!m || m[1] === APP_VERSION || $('#newver')) return;
      const b = document.createElement('div'); b.id = 'newver';
      b.innerHTML = `<span>A new version is available (<b class="notr">${esc(m[1])}</b>).</span><button type="button" class="btn sm" data-act="reload">Reload</button>`;
      document.body.appendChild(b); document.body.classList.add('hasnew'); placeBars();
    } catch (e) { }
  };
  /* a plain reload takes the scripts from the browser's cache (GitHub Pages lets it keep them for
     10 minutes), so the old version would come back: fetch every file of the app fresh first */
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-act="reload"]'); if (!b) return;
    b.disabled = true; b.textContent = 'Updating…';
    const files = [location.href.split('#')[0], ...[...document.querySelectorAll('script[src],link[rel=stylesheet][href]')].map(x => x.src || x.href)]
      .filter(u => u.startsWith(location.origin));
    await Promise.all(files.map(u => fetch(u, { cache: 'reload' }).catch(() => { })));
    location.reload();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  setTimeout(check, 3000);
})();
/* Ledger: all movements, or what each of you paid */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-lview]'); if (!b) return;
  UI.lview = b.dataset.lview; localStorage.setItem('shanta-lview', UI.lview); render();
});
/* a receipt on a box card: Purchases filtered to that box and receipt */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-rcpt]'); if (!b) return;
  Object.assign(UI, { person: '', store: '', box: b.dataset.rbox }); go('purchases'); UI.q = b.dataset.rcpt; render();
});
/* search fields: the × clears the text and runs the search again, like the built-in button on desktop */
document.addEventListener('pointerdown', e => { if (e.target.closest('[data-srchx]')) e.preventDefault(); });
document.addEventListener('click', e => {
  const x = e.target.closest('[data-srchx]'); if (!x) return;
  const i = x.parentNode.querySelector('input'); if (!i) return;
  i.value = ''; x.hidden = true; i.dispatchEvent(new Event('input', { bubbles: true }));
});
document.addEventListener('input', e => {
  const w = e.target.closest && e.target.closest('.srch'); if (!w) return;
  const x = w.querySelector('[data-srchx]'); if (x) x.hidden = !e.target.value;
}, true);
/* the barcode finder lives in find.js: if it isn't running (index.html doesn't load it, the file is
   missing on the site, or it stopped on an error), load a fresh copy on the tap on Find, and say what
   went wrong instead of doing nothing */
let findLoading = false;
document.addEventListener('click', e => {
  const o = e.target.closest('[data-obffind]'); if (!o || typeof openFind === 'function') return;
  e.preventDefault(); if (findLoading) return;
  const ids = o.dataset.obffind ? [o.dataset.obffind] : null;
  findLoading = true; toast('Loading the barcode finder…');
  const s = document.createElement('script'); s.src = 'find.js?v=' + APP_VERSION + '&t=' + Date.now();
  s.onload = () => { findLoading = false;
    if (typeof openFind !== 'function') return toast('⚠ The barcode finder has an error. Send a screenshot of this message.');
    render(); openFind(ids); };
  s.onerror = () => { findLoading = false; s.remove(); toast('⚠ find.js couldn’t be loaded. Check it is uploaded to the site, next to index.html.'); };
  document.body.appendChild(s);
});
