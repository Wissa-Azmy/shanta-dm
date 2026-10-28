/* ---------- form schemas ---------- */
const OPT = {
  category: ['Skin care', 'Make-up', 'Hair care', 'Body care', 'Fragrance', 'Health & vitamins', 'Baby', 'Other'],
  payDE: ['Card', 'Cash', 'PayPal', 'Bank transfer', 'Other'],
  payEG: ['Cash', 'InstaPay', 'Vodafone Cash', 'Bank transfer', 'Other'],
  expCat: ['Shipping', 'Customs & duties', 'Packaging', 'Transfer fees', 'Delivery to customer', 'Marketing', 'Other'],
  tMethod: ['InstaPay', 'Bank transfer', 'Western Union', 'Cash hand-over', 'PayPal', 'Other'],
  status: ['Packing', 'Shipped', 'In customs', 'Delivered'],
  kind: [['sale', 'Sale to customer'], ['gift', 'Gift / sample'], ['damaged', 'Damaged / lost']],
  cur: [['EGP', 'EGP (Egyptian pound)'], ['EUR', 'EUR (euro)']]
};
const shipOpts = () => [['', 'Not shipped yet']].concat(db.shipments.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(s => [s.id, s.name + ' · ' + s.status]));
const notEUR = k => v => v[k] !== 'EUR';
const rateField = (k = 'rate', curKey = 'currency') => ({ k, l: 'Rate (EGP per €1)', t: 'number', step: '0.01', def: () => db.settings.rate, show: notEUR(curKey), hint: 'Rate on that day; used to convert to €' });

function lotLabel(l, R) {
  const sh = db.shipments.find(s => s.id === l.p.shipmentId);
  return `${l.p.product}${l.p.brand ? ' (' + l.p.brand + ')' : ''} · ${l.left} left · ${sh ? sh.name : 'not shipped'}`;
}

const SCHEMAS = {
  shipments: {
    title: 'shipment', lead: 'A box/parcel going from Germany to Egypt. Add the products to it from Purchases.',
    fields: [
      { k: 'name', l: 'Name', t: 'text', req: true, def: () => 'Box #' + (db.shipments.length + 1) },
      { k: 'date', l: 'Ship date', t: 'date', def: today },
      { k: 'status', l: 'Status', t: 'select', opts: OPT.status, def: 'Packing' },
      { k: 'carrier', l: 'Carrier', t: 'text', list: ['DHL', 'Hermes', 'Aramex', 'Egypt Post', 'Traveller / suitcase'] },
      { k: 'tracking', l: 'Tracking number', t: 'text' },
      { k: 'weight', l: 'Weight (kg)', t: 'number', step: '0.1' },
      { k: 'deliveredOn', l: 'Delivered on', t: 'date', show: v => v.status === 'Delivered' },
      { k: 'notes', l: 'Notes', t: 'textarea', span: true },
      { t: 'section', l: 'Shipping cost (optional, saved as an expense on this shipment)', createOnly: true },
      { k: '_cost', l: 'Amount', t: 'number', step: '0.01', createOnly: true },
      { k: '_cur', l: 'Currency', t: 'select', opts: OPT.cur, def: 'EUR', createOnly: true },
      { k: '_rate', l: 'Rate (EGP per €1)', t: 'number', step: '0.01', def: () => db.settings.rate, createOnly: true, show: notEUR('_cur') },
      { k: '_paidBy', l: 'Paid by', t: 'person', def: 'me', createOnly: true },
      { k: '_cod', l: 'Paid on delivery in Egypt', t: 'check', createOnly: true }
    ],
    afterSave(rec, isNew) {
      if (isNew && num(rec._cost) > 0) {
        db.expenses.push({ id: uid(), date: rec.date, category: 'Shipping', description: 'Shipping for ' + rec.name, amount: num(rec._cost), currency: rec._cur, rate: rec._rate,
          paidBy: rec._paidBy, method: rec._cod ? 'Cash' : 'Card', place: rec._cod ? db.settings.cityEG : 'Germany', shipmentId: rec.id, onDelivery: !!rec._cod });
      }
      ['_cost', '_cur', '_rate', '_paidBy', '_cod'].forEach(k => delete rec[k]);
      if (rec.status !== 'Delivered') delete rec.deliveredOn;
    },
    onDelete(rec) {
      db.purchases.forEach(p => { if (p.shipmentId === rec.id) p.shipmentId = ''; });
      db.expenses.forEach(e => { if (e.shipmentId === rec.id) e.shipmentId = ''; });
    },
    delMsg: 'Delete this shipment? Its products and costs stay, they just become unassigned.'
  },
  purchases: {
    title: 'purchase', lead: 'One product line from a dm receipt. Use “Save & add another” to enter a whole receipt.',
    again: ['date', 'place', 'paidBy', 'method', 'shipmentId', 'receipt'],
    fields: [
      { k: 'date', l: 'Date bought', t: 'date', def: today, req: true },
      { k: 'place', l: 'Where', t: 'text', def: () => db.settings.cityDE, list: () => uniq(db.purchases.map(p => p.place)) },
      { k: 'product', l: 'Product', t: 'text', req: true, span: true, list: () => uniq(db.purchases.map(p => p.product)) },
      { k: 'brand', l: 'Brand', t: 'text', list: () => uniq(db.purchases.map(p => p.brand)) },
      { k: 'category', l: 'Category', t: 'select', opts: OPT.category, def: 'Skin care' },
      { k: 'qty', l: 'Quantity', t: 'number', step: '1', def: 1, req: true },
      { k: 'unitCost', l: 'Price per unit (€)', t: 'number', step: '0.01', req: true },
      { k: 'paidBy', l: 'Paid by', t: 'person', def: 'me' },
      { k: 'method', l: 'Paid with', t: 'select', opts: OPT.payDE, def: 'Card' },
      { k: 'shipmentId', l: 'Shipment', t: 'select', opts: shipOpts, def: '' },
      { k: 'receipt', l: 'Receipt / order no.', t: 'text' },
      { k: 'notes', l: 'Notes', t: 'textarea', span: true }
    ],
    validate(v, old) {
      if (num(v.qty) <= 0) return 'Quantity must be at least 1.';
      if (old) { const used = db.sales.filter(s => s.purchaseId === old.id).reduce((a, s) => a + num(s.qty), 0); if (num(v.qty) < used) return `${used} of these are already sold or given away, so quantity can’t be lower than that.`; }
    },
    canDelete: rec => db.sales.some(s => s.purchaseId === rec.id) ? 'This product has sales recorded. Delete those sales first.' : null
  },
  sales: {
    title: 'sale', lead: 'Something leaving stock in Egypt: a sale, a gift/sample, or a damaged item.',
    again: ['date', 'customer', 'receivedBy', 'method', 'place', 'paid', 'currency', 'rate'],
    fields: [
      { k: 'date', l: 'Date', t: 'date', def: today, req: true },
      { k: 'kind', l: 'Type', t: 'select', opts: OPT.kind, def: 'sale' },
      { k: 'purchaseId', l: 'Product', t: 'select', span: true, req: true, opts: v => { const R = calc(); return [['', 'Choose a product…']].concat(Object.values(R.lots).filter(l => l.left > 0 || l.p.id === v.purchaseId).sort((a, b) => a.p.product.localeCompare(b.p.product)).map(l => [l.p.id, lotLabel(l, R)])); } },
      { t: 'info', html: saleInfo },
      { k: 'qty', l: 'Quantity', t: 'number', step: '1', def: 1, req: true },
      { k: 'unitPrice', l: 'Price per unit', t: 'number', step: '0.01', show: v => v.kind === 'sale', req: true },
      { k: 'currency', l: 'Currency', t: 'select', opts: OPT.cur, def: 'EGP', show: v => v.kind === 'sale' },
      Object.assign(rateField(), { show: v => v.kind === 'sale' && v.currency !== 'EUR' }),
      { k: 'customer', l: 'Customer', t: 'text', list: () => uniq(db.sales.map(s => s.customer)) },
      { k: 'place', l: 'Where', t: 'text', def: () => db.settings.cityEG },
      { k: 'receivedBy', l: 'Money collected by', t: 'person', def: 'friend', show: v => v.kind === 'sale' },
      { k: 'method', l: 'Paid with', t: 'select', opts: OPT.payEG, def: 'Cash', show: v => v.kind === 'sale' },
      { k: 'paid', l: 'Customer has paid', t: 'check', def: true, show: v => v.kind === 'sale' },
      { k: 'notes', l: 'Notes', t: 'textarea', span: true }
    ],
    validate(v, old) {
      const R = calc(), l = R.lots[v.purchaseId];
      if (!l) return 'Pick a product.';
      if (num(v.qty) <= 0) return 'Quantity must be at least 1.';
      const avail = l.left + (old && old.purchaseId === v.purchaseId ? num(old.qty) : 0);
      if (num(v.qty) > avail) return `Only ${avail} of this product are left in stock.`;
      if (v.kind === 'sale' && v.unitPrice === '') return 'Enter the price.';
    },
    beforeSave(v) { if (v.kind !== 'sale') { v.unitPrice = 0; v.paid = false; } }
  },
  expenses: {
    title: 'expense', lead: 'Any cost other than the products: shipping, customs, packaging, transfer fees… Link it to a shipment to spread it over that box’s products.',
    again: ['date', 'paidBy', 'currency', 'rate', 'place', 'method'],
    fields: [
      { k: 'date', l: 'Date', t: 'date', def: today, req: true },
      { k: 'category', l: 'Category', t: 'select', opts: OPT.expCat, def: 'Shipping' },
      { k: 'description', l: 'Description', t: 'text', span: true },
      { k: 'amount', l: 'Amount', t: 'number', step: '0.01', req: true },
      { k: 'currency', l: 'Currency', t: 'select', opts: OPT.cur, def: 'EUR' },
      rateField(),
      { k: 'paidBy', l: 'Paid by', t: 'person', def: 'me' },
      { k: 'method', l: 'Paid with', t: 'select', opts: [...new Set([...OPT.payDE, ...OPT.payEG])], def: 'Card' },
      { k: 'place', l: 'Where', t: 'text', def: 'Germany' },
      { k: 'shipmentId', l: 'Shipment', t: 'select', opts: () => [['', 'Not linked (general expense)']].concat(shipOpts().slice(1)), def: '' },
      { k: 'onDelivery', l: 'Paid on delivery in Egypt', t: 'check' },
      { k: 'notes', l: 'Notes', t: 'textarea', span: true }
    ],
    validate(v) { if (num(v.amount) <= 0) return 'Amount must be above zero.'; }
  },
  transfers: {
    title: 'money transfer', lead: 'Money moving between the two of you, e.g. your friend sending sales money to Germany.',
    fields: [
      { k: 'date', l: 'Date', t: 'date', def: today, req: true },
      { k: 'method', l: 'Method', t: 'select', opts: OPT.tMethod, def: 'InstaPay' },
      { k: 'from', l: 'From', t: 'person', def: 'friend' },
      { k: 'to', l: 'To', t: 'person', def: 'me' },
      { k: 'amount', l: 'Amount', t: 'number', step: '0.01', req: true },
      { k: 'currency', l: 'Currency', t: 'select', opts: OPT.cur, def: 'EGP' },
      rateField(),
      { k: 'notes', l: 'Notes', t: 'textarea', span: true }
    ],
    validate(v) { if (v.from === v.to) return 'From and To must be different people.'; if (num(v.amount) <= 0) return 'Amount must be above zero.'; }
  }
};
function uniq(a) { return [...new Set(a.filter(Boolean))].sort(); }

function saleInfo(v) {
  const R = calc(), l = R.lots[v.purchaseId];
  if (!l) return '';
  const landedEGP = eur2egp(l.landed), sugg = landedEGP * (1 + num(db.settings.targetMargin) / 100);
  const avg = l.sold ? l.revEGP / l.sold : 0;
  return `Cost incl. shipping: <b>${fEGP(landedEGP)}</b> (${fEUR(l.landed)}) per unit · Price for ${db.settings.targetMargin}% markup: <b>${fEGP(Math.ceil(sugg / 5) * 5)}</b>${avg ? ` · Sold so far at avg <b>${fEGP(avg)}</b>` : ''} · In stock: <b>${l.left}</b>`;
}

/* ---------- modal engine ---------- */
let modal = null;
function optsOf(f, v) { const o = typeof f.opts === 'function' ? f.opts(v) : f.opts; return o.map(x => Array.isArray(x) ? x : [x, x]); }
function fieldHTML(f, v, i) {
  if (f.t === 'section') return `<div class="sect">${esc(f.l)}</div>`;
  if (f.t === 'info') { const h = f.html(v); return h ? `<div class="info">${h}</div>` : ''; }
  const val = v[f.k] ?? '', id = 'f_' + f.k, cls = 'f' + (f.span || f.t === 'textarea' ? ' span' : '') + (f.t === 'check' ? ' chk' : '');
  let input;
  if (f.t === 'select' || f.t === 'person') {
    const o = f.t === 'person' ? PEOPLE.map(p => [p, pname(p)]) : optsOf(f, v);
    input = `<select id="${id}" name="${f.k}" data-re="1">${o.map(([a, b]) => `<option value="${esc(a)}"${String(a) === String(val) ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>`;
  } else if (f.t === 'check') {
    return `<div class="${cls}"><input type="checkbox" id="${id}" name="${f.k}" data-re="1"${val ? ' checked' : ''}><label for="${id}">${esc(f.l)}</label></div>`;
  } else if (f.t === 'textarea') {
    input = `<textarea id="${id}" name="${f.k}">${esc(val)}</textarea>`;
  } else {
    const list = f.list ? (typeof f.list === 'function' ? f.list() : f.list) : null;
    input = `<input id="${id}" name="${f.k}" type="${f.t}" value="${esc(val)}"${f.step ? ` step="${f.step}" inputmode="decimal"` : ''}${list ? ` list="dl_${f.k}"` : ''} autocomplete="off">` +
      (list ? `<datalist id="dl_${f.k}">${list.map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : '');
  }
  return `<div class="${cls}"><label for="${id}">${esc(f.l)}${f.req ? ' *' : ''}</label>${input}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</div>`;
}
function visibleFields() { const S = SCHEMAS[modal.coll]; return S.fields.filter(f => (!f.createOnly || modal.isNew) && (!f.show || f.show(modal.v))); }
function drawForm(err) {
  const S = SCHEMAS[modal.coll];
  $('#mbody').innerHTML = `<h2>${modal.isNew ? 'New' : 'Edit'} ${S.title}</h2><p class="lead">${esc(S.lead || '')}</p>
    <div class="fgrid">${visibleFields().map(f => fieldHTML(f, modal.v)).join('')}</div>
    ${err ? `<div class="err">${esc(err)}</div>` : ''}
    <div class="mact"><button type="button" class="btn ghost" data-m="cancel">Cancel</button>
    ${modal.isNew && S.again ? '<button type="button" class="btn ghost" data-m="again">Save & add another</button>' : ''}
    <button type="submit" class="btn" data-m="save">Save</button></div>`;
}
function readForm() {
  visibleFields().forEach(f => {
    if (!f.k) return;
    const el = $('#mbody [name="' + f.k + '"]'); if (!el) return;
    modal.v[f.k] = f.t === 'check' ? el.checked : f.t === 'number' ? (el.value === '' ? '' : parseFloat(el.value)) : el.value;
  });
}
function openForm(coll, id, preset) {
  const S = SCHEMAS[coll], old = id ? db[coll].find(x => x.id === id) : null;
  const v = old ? JSON.parse(JSON.stringify(old)) : {};
  if (!old) { S.fields.forEach(f => { if (f.k && f.def !== undefined) v[f.k] = typeof f.def === 'function' ? f.def() : f.def; }); Object.assign(v, preset || {}); }
  modal = { coll, id, v, isNew: !old, old };
  drawForm();
  const d = $('#modal'); if (!d.open) d.showModal();
  setTimeout(() => { const first = $('#mbody input:not([type=checkbox]),#mbody select'); first && first.focus(); }, 30);
}
function submitForm(again) {
  readForm();
  const S = SCHEMAS[modal.coll], v = modal.v;
  const miss = visibleFields().find(f => f.req && (v[f.k] === '' || v[f.k] == null));
  if (miss) return drawForm(`“${miss.l}” is required.`);
  const err = S.validate && S.validate(v, modal.old);
  if (err) return drawForm(err);
  S.beforeSave && S.beforeSave(v);
  let rec;
  if (modal.isNew) { rec = Object.assign({ id: uid() }, v); db[modal.coll].push(rec); }
  else { const i = db[modal.coll].findIndex(x => x.id === modal.id); rec = db[modal.coll][i] = v; }
  S.afterSave && S.afterSave(rec, modal.isNew);
  const coll = modal.coll;
  commit();
  toast(S.title[0].toUpperCase() + S.title.slice(1) + ' saved');
  if (again) { const keep = {}; S.again.forEach(k => keep[k] = rec[k]); openForm(coll, null, keep); }
  else $('#modal').close();
}
function deleteRec(coll, id) {
  const S = SCHEMAS[coll], rec = db[coll].find(x => x.id === id); if (!rec) return;
  const block = S.canDelete && S.canDelete(rec); if (block) return toast(block);
  if (!confirm(S.delMsg || `Delete this ${S.title}?`)) return;
  S.onDelete && S.onDelete(rec);
  db[coll] = db[coll].filter(x => x.id !== id);
  commit(); toast('Deleted');
}
document.addEventListener('DOMContentLoaded', () => {
  const m = $('#mbody');
  m.addEventListener('change', e => { if (e.target.dataset.re) { readForm(); drawForm(); const el = $('#mbody [name="' + e.target.name + '"]'); el && el.focus(); } });
  m.addEventListener('click', e => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    if (b.dataset.m === 'cancel') { e.preventDefault(); $('#modal').close(); }
    if (b.dataset.m === 'again') { e.preventDefault(); submitForm(true); }
  });
  m.addEventListener('submit', e => { e.preventDefault(); submitForm(false); });
});
