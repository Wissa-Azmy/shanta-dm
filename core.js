/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);
const num = x => +x || 0;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fEUR = x => (x < 0 ? '−' : '') + '€' + Math.abs(x).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
const fEGP = x => (x < 0 ? '−' : '') + 'EGP ' + Math.round(Math.abs(x)).toLocaleString('en-US');
const fAmt = (a, cur) => cur === 'EUR' ? fEUR(num(a)) : fEGP(num(a));
const fDate = d => d ? new Date(d + 'T00:00').toLocaleDateString('en-GB', {day: 'numeric', month: 'short', year: 'numeric'}) : '—';
const PEOPLE = ['me', 'friend'];
const pname = p => p === 'friend' ? db.settings.friendName : db.settings.meName;
const pill = p => `<span class="pill ${p === 'friend' ? 'friend' : 'me'}">${esc(pname(p))}</span>`;
const rate = () => num(db.settings.rate) || 1;
const toEUR = (amount, cur, r) => cur === 'EUR' ? num(amount) : num(amount) / (num(r) || rate());
const toEGP = (amount, cur, r) => cur === 'EGP' ? num(amount) : num(amount) * (num(r) || rate());
const eur2egp = x => x * rate();
const both = x => `${fEUR(x)}<span class="sub">${fEGP(eur2egp(x))}</span>`;

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2800);
}

/* ---------- data ---------- */
const DEFAULT_DB = () => ({
  app: 'shanta-ledger', version: 1,
  settings: { meName: 'Me', friendName: 'Friend', meShare: 50, rate: 55, targetMargin: 35, lowStock: 2, autosave: true, cityDE: 'dm, Germany', cityEG: 'Cairo' },
  shipments: [], purchases: [], sales: [], expenses: [], transfers: [],
  meta: { created: new Date().toISOString(), updatedAt: null, savedAt: null }
});
let db;
try { db = JSON.parse(localStorage.getItem('shanta-db')) || DEFAULT_DB(); } catch (e) { db = DEFAULT_DB(); }
function normalize(d) {
  const base = DEFAULT_DB();
  d = Object.assign(base, d || {});
  d.settings = Object.assign(DEFAULT_DB().settings, d.settings || {});
  ['shipments', 'purchases', 'sales', 'expenses', 'transfers'].forEach(k => { if (!Array.isArray(d[k])) d[k] = []; });
  d.meta = Object.assign(DEFAULT_DB().meta, d.meta || {});
  return d;
}
db = normalize(db);

/* ---------- core accounting ----------
   Settlement rule (cash basis, paid sales only):
   1. Every unit that leaves stock (paid sale, gift, damaged) gives its buyer back its cost.
      Shipment-linked costs (shipping, customs) are given back pro rata as that shipment's goods leave stock.
      Unlinked expenses are given back in full straight away.
   2. What remains of collected revenue is profit, split by the share in Settings.
   3. Whoever holds more collected money than they are entitled to owes the difference. */
function calc() {
  const s = db.settings;
  const R = { lots: {}, ship: {}, person: {}, rev: 0, revEGP: 0, unpaidEUR: 0, unpaidEGP: 0, stockEUR: 0, unpaidCostEUR: 0, spent: 0, lossEUR: 0 };
  PEOPLE.forEach(p => R.person[p] = { outlay: 0, recovered: 0, received: 0, tin: 0, tout: 0 });
  db.purchases.forEach(p => R.lots[p.id] = { p, qty: num(p.qty), unit: num(p.unitCost), sold: 0, paidQty: 0, unpaid: 0, lost: 0, revEGP: 0, revEUR: 0 });
  db.sales.forEach(x => {
    const l = R.lots[x.purchaseId]; if (!l) return;
    const q = num(x.qty);
    if (x.kind === 'sale') {
      l.sold += q; if (x.paid) l.paidQty += q; else l.unpaid += q;
      l.revEGP += toEGP(q * num(x.unitPrice), x.currency, x.rate);
      l.revEUR += toEUR(q * num(x.unitPrice), x.currency, x.rate);
    } else l.lost += q;
  });
  db.shipments.forEach(sh => R.ship[sh.id] = { goods: 0, costs: 0, consumed: 0, units: 0, items: 0 });
  Object.values(R.lots).forEach(l => {
    l.left = l.qty - l.sold - l.lost;
    l.consumed = l.paidQty + l.lost;
    const sh = R.ship[l.p.shipmentId];
    if (sh) { sh.goods += l.qty * l.unit; sh.consumed += l.consumed * l.unit; sh.units += l.qty; sh.items++; }
  });
  db.expenses.forEach(e => {
    const sh = R.ship[e.shipmentId];
    if (sh) sh.costs += toEUR(e.amount, e.currency, e.rate);
  });
  Object.values(R.lots).forEach(l => {
    const sh = R.ship[l.p.shipmentId];
    l.landed = l.unit + (sh && sh.goods > 0 ? sh.costs * l.unit / sh.goods : 0);
    R.stockEUR += Math.max(0, l.left) * l.landed;
    R.unpaidCostEUR += l.unpaid * l.landed;
    R.lossEUR += l.lost * l.landed;
  });
  const P = k => R.person[k] || R.person.me;
  db.purchases.forEach(p => {
    const l = R.lots[p.id];
    P(p.paidBy).outlay += l.qty * l.unit;
    P(p.paidBy).recovered += l.consumed * l.unit;
  });
  db.expenses.forEach(e => {
    const eur = toEUR(e.amount, e.currency, e.rate), sh = R.ship[e.shipmentId];
    P(e.paidBy).outlay += eur;
    P(e.paidBy).recovered += sh && sh.goods > 0 ? eur * sh.consumed / sh.goods : eur;
  });
  db.sales.forEach(x => {
    if (x.kind !== 'sale') return;
    const eur = toEUR(num(x.qty) * num(x.unitPrice), x.currency, x.rate);
    const egp = toEGP(num(x.qty) * num(x.unitPrice), x.currency, x.rate);
    if (!x.paid) { R.unpaidEUR += eur; R.unpaidEGP += egp; return; }
    R.rev += eur; R.revEGP += egp;
    (R.person[x.receivedBy] || R.person.friend).received += eur;
  });
  db.transfers.forEach(t => {
    const eur = toEUR(t.amount, t.currency, t.rate);
    if (R.person[t.from]) R.person[t.from].tout += eur;
    if (R.person[t.to]) R.person[t.to].tin += eur;
  });
  const rec = PEOPLE.reduce((a, k) => a + R.person[k].recovered, 0);
  R.spent = PEOPLE.reduce((a, k) => a + R.person[k].outlay, 0);
  R.profit = R.rev - rec;
  const share = { me: num(s.meShare) / 100, friend: 1 - num(s.meShare) / 100 };
  PEOPLE.forEach(k => {
    const p = R.person[k];
    p.shareRatio = share[k];
    p.share = share[k] * R.profit;
    p.entitled = p.recovered + p.share;
    p.actual = p.received + p.tin - p.tout;
    p.owes = p.actual - p.entitled;
    p.invested = p.outlay - p.recovered;
  });
  return R;
}

/* ---------- persistence: browser copy + real file on disk ---------- */
let fileHandle = null, fileName = null, dirty = false, filePerm = false, saveTimer = null;
const IDB = {
  db: null,
  open() { return new Promise((res, rej) => { if (this.db) return res(this.db); const r = indexedDB.open('shanta', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(this.db = r.result); r.onerror = () => rej(r.error); }); },
  async get(k) { try { const d = await this.open(); return await new Promise(r => { const q = d.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => r(q.result); q.onerror = () => r(null); }); } catch (e) { return null; } },
  async set(k, v) { try { const d = await this.open(); d.transaction('kv', 'readwrite').objectStore('kv').put(v, k); } catch (e) { } },
  async del(k) { try { const d = await this.open(); d.transaction('kv', 'readwrite').objectStore('kv').delete(k); } catch (e) { } }
};
const canFS = () => 'showSaveFilePicker' in window;

function persistLocal() { try { localStorage.setItem('shanta-db', JSON.stringify(db)); } catch (e) { } }
function commit() {
  db.meta.updatedAt = new Date().toISOString();
  persistLocal(); dirty = true;
  if (typeof Cloud !== 'undefined' && Cloud.on()) Cloud.schedule();
  if (fileHandle && filePerm && db.settings.autosave) { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveFile(false, true), 700); }
  render();
}
async function verifyPerm(h, ask) {
  const o = { mode: 'readwrite' };
  try {
    if ((await h.queryPermission(o)) === 'granted') return true;
    if (ask && (await h.requestPermission(o)) === 'granted') return true;
  } catch (e) { }
  return false;
}
async function writeTo(h) {
  db.meta.savedAt = new Date().toISOString();
  const w = await h.createWritable();
  await w.write(JSON.stringify(db, null, 2)); await w.close();
  persistLocal();
}
async function saveFile(saveAs, silent) {
  if (!canFS()) { downloadJSON(); return; }
  try {
    if (saveAs || !fileHandle) {
      fileHandle = await window.showSaveFilePicker({ suggestedName: fileName || 'shanta-ledger.json', types: [{ description: 'Shanta ledger', accept: { 'application/json': ['.json'] } }] });
      fileName = fileHandle.name; IDB.set('handle', fileHandle);
    }
    filePerm = await verifyPerm(fileHandle, !silent);
    if (!filePerm) { renderFile(); return; }
    await writeTo(fileHandle);
    dirty = false; renderFile();
    if (!silent) toast('Saved to ' + fileName);
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.warn(e);
    toast('This window can’t write files directly, so a copy was downloaded instead');
    downloadJSON();
  }
}
async function openFile() {
  if (!canFS()) { $('#fileInput').click(); return; }
  try {
    const [h] = await window.showOpenFilePicker({ types: [{ description: 'Shanta ledger', accept: { 'application/json': ['.json'] } }] });
    const data = JSON.parse(await (await h.getFile()).text());
    if (!confirmReplace()) return;
    fileHandle = h; fileName = h.name; IDB.set('handle', h);
    filePerm = await verifyPerm(h, true);
    db = normalize(data); persistLocal(); dirty = false;
    toast('Opened ' + fileName); render();
  } catch (e) {
    if (e.name === 'AbortError') return;
    console.warn(e); $('#fileInput').click();
  }
}
async function reconnect() {
  if (!fileHandle) return;
  filePerm = await verifyPerm(fileHandle, true);
  if (!filePerm) { toast('Permission was not granted'); return; }
  try {
    const data = normalize(JSON.parse(await (await fileHandle.getFile()).text()));
    const fileT = data.meta.updatedAt || data.meta.savedAt || '', localT = db.meta.updatedAt || '';
    if (fileT > localT) { db = data; persistLocal(); toast('Loaded latest data from ' + fileName); }
    else { await writeTo(fileHandle); toast('File updated with your latest changes'); }
    dirty = false;
  } catch (e) { console.warn(e); toast('Could not read the file, try Open file'); }
  render();
}
function confirmReplace() {
  const has = db.purchases.length + db.sales.length + db.expenses.length + db.transfers.length;
  return !has || confirm('Replace the data currently in the app with the file you picked?');
}
function downloadJSON() {
  db.meta.savedAt = new Date().toISOString(); persistLocal();
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = 'shanta-ledger-' + today() + '.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  dirty = false; renderFile();
}
function importFromInput(file) {
  const r = new FileReader();
  r.onload = () => {
    try { const d = JSON.parse(r.result); if (!confirmReplace()) return; db = normalize(d); persistLocal(); dirty = false; fileName = file.name; toast('Imported ' + file.name); render(); }
    catch (e) { toast('That file is not a valid ledger'); }
  };
  r.readAsText(file);
}
function downloadCSV(name, rows) {
  const csv = rows.map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = name; a.click();
}
