/* App version: change this with every push (date + number of the day), e.g. 2026.11.01-2 */
const APP_VERSION = "2026.11.04-1";
/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().slice(0, 10);
const num = x => +String(x ?? "").trim().replace(",", ".") || 0; // accepts "6,5" and "6.5"
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
const TRASH = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const PENCIL = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
/* content weight per unit in grams from a product name: "200g", "1,5kg", ", 150 ml", "0,5 l" (1 ml counted as 1 g) */
function parseWeightG(t) {
  const m = String(t || "").match(/(?<![\d.,])(0[.,]\d+|[1-9]\d*(?:[.,]\d+)?)\s?(kg|g|ml|l)(?![a-zäöü])/i);
  if (!m) return 0;
  const v = parseFloat(m[1].replace(",", ".")), u = m[2].toLowerCase();
  return Math.round(u === "kg" || u === "l" ? v * 1000 : v);
}
const fG = g => g >= 1000 ? (g / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " kg" : Math.round(g) + " g";

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2800);
}

/* ---------- data ---------- */
const DEFAULT_DB = () => ({
  app: 'shanta-ledger', version: 1,
  settings: { meName: 'Me', friendName: 'Friend', meShare: 50, rate: 55, targetMargin: 35, packagingPct: 25, lowStock: 2, autosave: true, cityDE: 'dm, Germany', cityEG: 'Cairo' },
  shipments: [], purchases: [], sales: [], payments: [], expenses: [], transfers: [],
  meta: { created: new Date().toISOString(), updatedAt: null, savedAt: null }
});
let db;
try { db = JSON.parse(localStorage.getItem('shanta-db')) || DEFAULT_DB(); } catch (e) { db = DEFAULT_DB(); }
function normalize(d) {
  const base = DEFAULT_DB();
  d = Object.assign(base, d || {});
  d.settings = Object.assign(DEFAULT_DB().settings, d.settings || {});
  ['shipments', 'purchases', 'sales', 'payments', 'expenses', 'transfers'].forEach(k => { if (!Array.isArray(d[k])) d[k] = []; });
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

/* ---------- sale book: what each sale costs the customer and what has been collected ----------
   Paid in full: collected at the sale. Down payment: that part is collected at the sale, the rest goes on the
   customer's credit balance. Credit payments (db.payments) pay a chosen sale, or the customer's oldest open sales first. */
const custKey = c => String(c || '').trim().toLowerCase();
function saleBook(skipPaymentId) {
  const byId = {}, orders = [], customers = {}, unused = {};
  db.sales.forEach(x => {
    if (x.kind !== 'sale') return;
    const k = x.orderId || x.id;
    let o = byId[k];
    if (!o) {
      o = byId[k] = { id: k, h: x, cur: x.currency || 'EGP', rate: num(x.rate) || rate(), bill: 0, collected: 0, cash: [], payments: [] };
      o.mode = x.payMode || (x.paid ? 'full' : 'credit');
      orders.push(o);
    }
    o.bill += num(x.qty) * num(x.unitPrice);
  });
  const toOrderCur = (o, p) => { const eur = toEUR(p.amount, p.currency, p.rate); return p.currency === o.cur ? num(p.amount) : o.cur === 'EUR' ? eur : eur * o.rate; };
  const take = (o, amt, who, date, eurPerUnit, egpPerUnit, payment) => {
    const t = Math.min(amt, o.bill - o.collected); if (t <= 0.0001) return 0;
    o.collected += t;
    o.cash.push({ who, date, amt: t, eur: t * eurPerUnit, egp: t * egpPerUnit, payment: payment && payment.id });
    if (payment) o.payments.push({ id: payment.id, date, amt: t });
    return t;
  };
  const ownEUR = o => o.cur === 'EUR' ? 1 : 1 / o.rate, ownEGP = o => o.cur === 'EGP' ? 1 : o.rate;
  orders.forEach(o => {
    const h = o.h;
    if (o.mode === 'full') take(o, o.bill, h.receivedBy, h.date, ownEUR(o), ownEGP(o));
    else if (o.mode === 'down') take(o, num(h.downPayment), h.receivedBy, h.date, ownEUR(o), ownEGP(o));
  });
  const open = c => orders.filter(o => custKey(o.h.customer) === c && o.bill - o.collected > 0.0001)
    .sort((a, b) => (a.h.dueDate || a.h.date || '').localeCompare(b.h.dueDate || b.h.date || '') || (a.h.date || '').localeCompare(b.h.date || ''));
  const pays = db.payments.filter(p => p.id !== skipPaymentId).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  pays.forEach(p => {
    if (num(p.amount) <= 0) return;
    const eur = toEUR(p.amount, p.currency, p.rate), egp = toEGP(p.amount, p.currency, p.rate);
    let targets = p.orderId && byId[p.orderId] ? [byId[p.orderId]].concat(open(custKey(p.customer)).filter(o => o.id !== p.orderId)) : open(custKey(p.customer));
    let left = num(p.amount);
    for (const o of targets) {
      if (left <= 0.0001) break;
      const inOC = toOrderCur(o, Object.assign({}, p, { amount: left }));
      const per = inOC > 0 ? left / inOC : 0;
      const t = take(o, inOC, p.receivedBy, p.date, per * eur / num(p.amount), per * egp / num(p.amount), p);
      left -= t * per;
    }
    unused[p.id] = Math.max(0, left);
  });
  const t = today();
  orders.forEach(o => {
    o.f = o.bill > 0 ? o.collected / o.bill : 1;
    o.balance = Math.max(0, o.bill - o.collected);
    o.balanceEGP = o.cur === 'EGP' ? o.balance : o.balance * o.rate;
    o.overdue = o.balance > 0.0001 && o.h.dueDate && o.h.dueDate < t;
    const c = custKey(o.h.customer); if (!c) return;
    const cu = customers[c] = customers[c] || { key: c, name: String(o.h.customer).trim(), balanceEGP: 0, billEGP: 0, orders: [], overdue: 0, nextDue: '' };
    cu.orders.push(o); cu.balanceEGP += o.balanceEGP; cu.billEGP += o.cur === 'EGP' ? o.bill : o.bill * o.rate;
    if (o.overdue) cu.overdue += o.balanceEGP;
    if (o.balance > 0.0001 && o.h.dueDate && (!cu.nextDue || o.h.dueDate < cu.nextDue)) cu.nextDue = o.h.dueDate;
  });
  return { byId, orders, customers, unused };
}
function calc() {
  const s = db.settings;
  const R = { lots: {}, ship: {}, person: {}, rev: 0, revEGP: 0, unpaidEUR: 0, unpaidEGP: 0, stockEUR: 0, unpaidCostEUR: 0, spent: 0, lossEUR: 0 };
  PEOPLE.forEach(p => R.person[p] = { outlay: 0, recovered: 0, received: 0, tin: 0, tout: 0 });
  db.purchases.forEach(p => R.lots[p.id] = { p, qty: num(p.qty), unit: num(p.unitCost), sold: 0, paidQty: 0, unpaid: 0, lost: 0, revEGP: 0, revEUR: 0 });
  const B = R.book = saleBook();
  db.sales.forEach(x => {
    const l = R.lots[x.purchaseId]; if (!l) return;
    const q = num(x.qty);
    if (x.kind === 'sale') {
      /* a sale counts in proportion to what the customer has paid so far */
      const o = B.byId[x.orderId || x.id], f = o ? o.f : 0;
      l.sold += q; l.paidQty += q * f; l.unpaid += q * (1 - f);
      l.revEGP += toEGP(q * num(x.unitPrice), x.currency, x.rate);
      l.revEUR += toEUR(q * num(x.unitPrice), x.currency, x.rate);
    } else l.lost += q;
  });
  /* Shipping split by weight: a product's share of its box's costs = its shipping weight ÷ the box's total weight.
     Shipping weight = content weight × (1 + packaging %). Products without a weight:
     - if the packed box was weighed, they share what is left of the measured weight (by price among themselves);
     - otherwise they are estimated from their price, using the box's average grams per euro.
     A box with no weights at all (and not weighed) is split by price instead. */
  const pack = 1 + num(s.packagingPct) / 100;
  db.shipments.forEach(sh => R.ship[sh.id] = { goods: 0, costs: 0, consumed: 0, units: 0, items: 0, wG: 0, wV: 0, netG: 0, uV: 0, unknown: 0, basis: 0, consumedB: 0, grams: 0, estimated: 0, fromBox: 0, measuredG: num(sh.weight) * 1000 });
  Object.values(R.lots).forEach(l => {
    l.left = l.qty - l.sold - l.lost;
    l.consumed = l.paidQty + l.lost;
    l.grossG = num(l.p.netG) > 0 ? num(l.p.netG) * pack : 0;
    const sh = R.ship[l.p.shipmentId];
    if (sh) { sh.goods += l.qty * l.unit; sh.consumed += l.consumed * l.unit; sh.units += l.qty; sh.items++;
      if (l.grossG) { sh.wG += l.qty * l.grossG; sh.wV += l.qty * l.unit; sh.netG += l.qty * num(l.p.netG); }
      else { sh.uV += l.qty * l.unit; sh.unknown++; } }
  });
  Object.values(R.ship).forEach(sh => {
    sh.rest = sh.measuredG - sh.wG;
    sh.useRest = sh.measuredG > 0 && sh.uV > 0 && sh.rest > 0;
    sh.byWeight = sh.wG > 0 || sh.useRest;
    sh.tooLight = sh.measuredG > 0 && sh.rest <= 0 && sh.wG > 0;
    if (sh.measuredG > 0 && !sh.unknown && sh.netG > 0) sh.impliedPack = Math.round((sh.measuredG / sh.netG - 1) * 100);
  });
  Object.values(R.lots).forEach(l => {
    const sh = R.ship[l.p.shipmentId]; if (!sh) return;
    l.boxG = !l.grossG && sh.useRest;
    l.estG = !l.grossG && !sh.useRest && sh.wG > 0 && sh.wV > 0;
    l.shipG = l.grossG || (l.boxG ? l.unit * sh.rest / sh.uV : l.estG ? l.unit * sh.wG / sh.wV : 0);
    l.basis = sh.byWeight ? l.shipG : l.unit;
    sh.basis += l.qty * l.basis; sh.consumedB += l.consumed * l.basis;
    sh.grams += l.qty * l.shipG; if (l.estG) sh.estimated++; if (l.boxG) sh.fromBox++;
  });
  db.expenses.forEach(e => {
    const sh = R.ship[e.shipmentId];
    if (sh) sh.costs += toEUR(e.amount, e.currency, e.rate);
  });
  Object.values(R.lots).forEach(l => {
    const sh = R.ship[l.p.shipmentId];
    l.shipShare = sh && sh.basis > 0 ? sh.costs * l.basis / sh.basis : 0;
    l.landed = l.unit + l.shipShare;
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
    P(e.paidBy).recovered += sh && sh.basis > 0 ? eur * sh.consumedB / sh.basis : eur;
  });
  db.sales.forEach(x => {
    if (x.kind !== 'sale') return;
    const o = B.byId[x.orderId || x.id], f = o ? o.f : 0;
    const eur = toEUR(num(x.qty) * num(x.unitPrice), x.currency, x.rate);
    const egp = toEGP(num(x.qty) * num(x.unitPrice), x.currency, x.rate);
    R.unpaidEUR += eur * (1 - f); R.unpaidEGP += egp * (1 - f);
  });
  B.orders.forEach(o => o.cash.forEach(c => { R.rev += c.eur; R.revEGP += c.egp; (R.person[c.who] || R.person.friend).received += c.eur; }));
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
      fileHandle = await window.showSaveFilePicker({ suggestedName: fileName || 'shanta-ledger.json', types: [{ description: 'Shanta dm data', accept: { 'application/json': ['.json'] } }] });
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
    const [h] = await window.showOpenFilePicker({ types: [{ description: 'Shanta dm data', accept: { 'application/json': ['.json'] } }] });
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
    /* when signed in, the cloud is the source of truth: an older file must not overwrite it */
    if (fileT > localT && !(typeof Cloud !== 'undefined' && Cloud.on())) { db = data; persistLocal(); toast('Loaded latest data from ' + fileName); }
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
