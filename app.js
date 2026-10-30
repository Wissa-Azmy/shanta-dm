/* ---------- shell ---------- */
const pre = o => `data-preset="${esc(JSON.stringify(o))}"`;
const NAV = [
  ['overview', '◎', 'Overview', 'Who owes whom, at a glance'],
  ['shipments', '✈', 'Shipments', 'Boxes from Germany to Egypt'],
  ['purchases', '🛒', 'Purchases', 'What was bought at dm'],
  ['stock', '▦', 'Stock', 'What is left and what to charge'],
  ['sales', '£', 'Sales', 'What was sold in Egypt'],
  ['expenses', '✉', 'Expenses', 'Shipping, customs and other costs'],
  ['transfers', '⇄', 'Transfers', 'Money between the two of you'],
  ['ledger', '☰', 'Ledger', 'Every movement: who, when, where, how much'],
  ['settings', '⚙', 'Settings', 'Names, split, rate and your data file']
];
const NEWBTN = { shipments: 'New shipment', purchases: 'Add purchase', sales: 'Record sale', expenses: 'Add expense', transfers: 'Record transfer', stock: 'Record sale' };
let view = localStorage.getItem('shanta-view') || 'overview';

function counts() { return { shipments: db.shipments.length, purchases: db.purchases.length, sales: db.sales.length, expenses: db.expenses.length, transfers: db.transfers.length }; }
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
  $('#topact').innerHTML = NEWBTN[view] ? `${view === 'purchases' || view === 'shipments' ? '<button class="btn ghost" data-receipt="">⇪ Import dm receipt</button>' : ''}<button class="btn" data-new="${view === 'stock' ? 'sales' : view}">+ ${NEWBTN[view]}</button>` :
    view === 'overview' && db.purchases.length ? `<button class="btn ghost" data-new="purchases">+ Purchase</button><button class="btn ghost" data-new="expenses">+ Expense</button><button class="btn" data-new="sales">+ Sale</button>` : '';
  if (chart) { chart.destroy(); chart = null; }
  const R = calc();
  $("#view").innerHTML = Cloud.bannerHTML() + V[view](R);
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
  if (a === 'setpack') { db.settings.packagingPct = num(arg); commit(); toast('Packaging set to ' + num(arg) + '%'); }
  if (a === 'fillw') { const m = missingW(); m.forEach(p => p.netG = parseWeightG(p.product)); commit(); toast(m.length + ' weights filled in'); }
  if (a === 'fx') { t.textContent = 'Fetching…'; updateRate(true); }
});
document.addEventListener('input', e => {
  const u = e.target.dataset.ui;
  if (u) {
    UI[u] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    const pos = e.target.selectionStart; render();
    if (u === 'q') { const el = $('[data-ui="q"]'); el.focus(); try { el.setSelectionRange(pos, pos); } catch (x) { } }
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
  if (Cloud.on()) { Cloud.sync(); Cloud.startPolling(); }
  if (h && h.queryPermission) { fileHandle = h; fileName = h.name; filePerm = await verifyPerm(h, false); renderFile(); }
  setTimeout(() => { const s = db.settings; if (s.rateAuto !== false && (s.rateAt || '').slice(0, 10) !== today() && s.rateManual !== today()) updateRate(false); }, 4000);
})();
