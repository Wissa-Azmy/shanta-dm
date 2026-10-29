/* ---------- sales orders: one sale = several products + extra costs ----------
   Stored as before so all totals keep working:
   - each product line is a record in db.sales (sharing an orderId)
   - an extra cost we paid is a record in db.expenses (with orderId)
   - an extra the customer pays for is a db.sales record with extra: true and no product */
const EXTRA_CATS = ['Delivery to customer', 'Packaging', 'Other'];
let OR = null;

function salesOrders() {
  const m = {};
  db.sales.forEach(s => { const k = s.orderId || s.id; m[k] = m[k] || { id: k, lines: [], extras: [], costs: [] }; (s.extra ? m[k].extras : m[k].lines).push(s); });
  db.expenses.forEach(e => { if (e.orderId && m[e.orderId]) m[e.orderId].costs.push(e); });
  return Object.values(m).map(o => { const h = o.lines[0] || o.extras[0]; return Object.assign(o, { h, date: h.date }); });
}
const orderOf = ref => { const s = db.sales.find(x => x.id === ref); return s ? (s.orderId || s.id) : ref; };
const inOrder = (s, oid) => (s.orderId || s.id) === oid;
function orderMoney(o, R) {
  const goods = o.lines.reduce((a, s) => a + toEGP(num(s.qty) * num(s.unitPrice), s.currency, s.rate), 0);
  const charged = o.extras.reduce((a, s) => a + toEGP(num(s.qty) * num(s.unitPrice), s.currency, s.rate), 0);
  const cost = o.costs.reduce((a, e) => a + toEGP(e.amount, e.currency, e.rate), 0);
  const landed = o.lines.reduce((a, s) => { const l = R.lots[s.purchaseId]; return a + (l ? eur2egp(num(s.qty) * l.landed) : 0); }, 0);
  return { goods, charged, bill: goods + charged, cost, landed, profit: goods + charged - landed - cost };
}

/* ---------- editor ---------- */
function odlg() {
  let d = $('#odlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'odlg'; d.innerHTML = '<div id="obody"></div>'; document.body.appendChild(d); }
  return d;
}
function openOrder(id, preset) {
  const o = id ? salesOrders().find(x => x.id === id) : null;
  if (o) {
    const h = o.h, ex = {};
    o.costs.forEach(e => { const k = e.extraKey || e.id; ex[k] = Object.assign(ex[k] || { category: e.category, description: e.description || '', charge: '' }, { cost: num(e.amount), paidBy: e.paidBy }); });
    o.extras.forEach(s => { const k = s.extraKey || s.id; ex[k] = Object.assign(ex[k] || { category: s.category || 'Other', description: s.product || '', cost: '', paidBy: 'friend' }, { charge: num(s.unitPrice) }); });
    OR = { id: o.id, isNew: false,
      h: { date: h.date, customer: h.customer || '', place: h.place || '', receivedBy: h.receivedBy || 'friend', method: h.method || 'Cash', paid: !!h.paid, currency: h.currency || 'EGP', rate: h.rate || db.settings.rate, kind: h.kind || 'sale', notes: h.notes || '' },
      lines: o.lines.map(s => ({ purchaseId: s.purchaseId, qty: num(s.qty), unitPrice: h.kind === 'sale' ? num(s.unitPrice) : '' })),
      extras: Object.values(ex),
      old: { sales: o.lines.concat(o.extras).map(s => s.id), exps: o.costs.map(e => e.id) }, orig: {} };
    o.lines.forEach(s => OR.orig[s.purchaseId] = (OR.orig[s.purchaseId] || 0) + num(s.qty));
  } else {
    OR = { id: null, isNew: true,
      h: { date: today(), customer: '', place: db.settings.cityEG, receivedBy: 'friend', method: 'Cash', paid: true, currency: 'EGP', rate: db.settings.rate, kind: 'sale', notes: '' },
      lines: [{ purchaseId: (preset && preset.purchaseId) || '', qty: 1, unitPrice: '' }], extras: [], old: { sales: [], exps: [] }, orig: {} };
  }
  const d = odlg(); drawOrder(); if (!d.open) d.showModal();
}
function suggestEGP(l) { return Math.ceil(eur2egp(l.landed) * (1 + num(db.settings.targetMargin) / 100) / 5) * 5; }
function orderTotals() {
  const R = calc(), h = OR.h, sale = h.kind === 'sale';
  const egp = a => toEGP(a, h.currency, h.rate);
  const goods = sale ? OR.lines.reduce((a, x) => a + egp(num(x.qty) * num(x.unitPrice)), 0) : 0;
  const charged = sale ? OR.extras.reduce((a, x) => a + egp(num(x.charge)), 0) : 0;
  const cost = OR.extras.reduce((a, x) => a + egp(num(x.cost)), 0);
  const landed = OR.lines.reduce((a, x) => { const l = R.lots[x.purchaseId]; return a + (l ? eur2egp(num(x.qty) * l.landed) : 0); }, 0);
  return { goods, charged, bill: goods + charged, cost, landed, profit: goods + charged - landed - cost, units: OR.lines.reduce((a, x) => a + num(x.qty), 0) };
}
function totalsHTML() {
  const t = orderTotals(), sale = OR.h.kind === 'sale', f = x => fAmt(OR.h.currency === 'EUR' ? x / (num(OR.h.rate) || rate()) : x, OR.h.currency);
  return `<dl class="kv">
    ${sale ? `<dt>Products (${t.units} units)</dt><dd>${f(t.goods)}</dd><dt>Extras the customer pays</dt><dd>${f(t.charged)}</dd>
    <dt><b>Customer pays in total</b></dt><dd><b>${f(t.bill)}</b></dd>` : `<dt>Units leaving stock</dt><dd>${t.units}</dd>`}
    <dt>Product cost incl. shipping</dt><dd>${fEGP(t.landed)}</dd><dt>Extra costs we pay</dt><dd>${f(t.cost)}</dd>
    <dt><b>${sale ? 'Profit on this sale' : 'Cost of this ' + (OR.h.kind === 'gift' ? 'gift' : 'loss')}</b></dt><dd class="${t.profit >= 0 ? 'in-amt' : 'out-amt'}"><b>${fEGP(t.profit)}</b></dd></dl>`;
}
function drawOrder(err) {
  const R = calc(), h = OR.h, sale = h.kind === 'sale', cur = h.currency;
  const avail = id => { const l = R.lots[id]; return l ? l.left + (OR.orig[id] || 0) : 0; };
  const lots = Object.values(R.lots).filter(l => avail(l.p.id) > 0 || OR.lines.some(x => x.purchaseId === l.p.id)).sort((a, b) => a.p.product.localeCompare(b.p.product));
  const opt = (v, l, s) => `<option value="${esc(v)}"${String(v) === String(s) ? ' selected' : ''}>${esc(l)}</option>`;
  const sel = (attr, opts, v) => `<select ${attr}>${opts.map(x => Array.isArray(x) ? x : [x, x]).map(([a, b]) => opt(a, b, v)).join('')}</select>`;
  const people = PEOPLE.map(p => [p, pname(p)]);
  $('#obody').innerHTML = `<div class="rhead"><div><h2>${OR.isNew ? 'New sale' : 'Edit sale'}</h2><p class="lead">Add every product the customer takes, then any extra costs such as delivery or packaging.</p></div>
    <button type="button" class="ib" data-o="close" title="Close">✕</button></div>
    <div class="fgrid rx-opts">
      <div class="f"><label>Date</label><input type="date" data-oh="date" value="${esc(h.date)}"></div>
      <div class="f"><label>Type</label>${sel('data-oh="kind"', OPT.kind, h.kind)}</div>
      <div class="f"><label>Customer</label><input data-oh="customer" value="${esc(h.customer)}" list="o_customers" autocomplete="off"><datalist id="o_customers">${uniq(db.sales.map(s => s.customer)).map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="f"><label>Where</label><input data-oh="place" value="${esc(h.place)}"></div>
      ${sale ? `<div class="f"><label>Currency</label>${sel('data-oh="currency"', OPT.cur, cur)}</div>
      ${cur !== 'EUR' ? `<div class="f"><label>Rate (EGP per €1)</label><input type="number" step="0.01" data-oh="rate" value="${esc(h.rate)}"></div>` : ''}
      <div class="f"><label>Money collected by</label>${sel('data-oh="receivedBy"', people, h.receivedBy)}</div>
      <div class="f"><label>Paid with</label>${sel('data-oh="method"', OPT.payEG, h.method)}</div>
      <div class="f chk"><input type="checkbox" id="o_paid" data-oh="paid"${h.paid ? ' checked' : ''}><label for="o_paid">Customer has paid</label></div>` : ''}
    </div>

    <h3 class="osec">Products</h3>
    <div class="tablewrap rx-table"><table class="t"><thead><tr><th>Product</th><th class="num">Qty</th>${sale ? `<th class="num">Price per unit (${cur})</th><th class="num">Line total</th>` : ''}<th></th></tr></thead><tbody>
    ${OR.lines.map((x, i) => { const l = R.lots[x.purchaseId];
      return `<tr><td>${sel(`class="cell wide" data-ol="${i}" data-k="purchaseId"`, [['', 'Choose a product…']].concat(lots.map(l => [l.p.id, `${l.p.product}${l.p.brand ? ' (' + l.p.brand + ')' : ''} · ${avail(l.p.id)} available`])), x.purchaseId)}
        ${l ? `<span class="sub">Cost incl. shipping ${fEGP(eur2egp(l.landed))} · ${db.settings.targetMargin}% markup → ${fEGP(suggestEGP(l))}</span>` : ''}</td>
        <td class="num"><input class="cell n" type="number" min="1" step="1" data-ol="${i}" data-k="qty" value="${esc(x.qty)}"></td>
        ${sale ? `<td class="num"><input class="cell n w" type="number" min="0" step="0.01" data-ol="${i}" data-k="unitPrice" value="${esc(x.unitPrice)}" placeholder="${l ? suggestEGP(l) : ''}"></td>
        <td class="num" id="ol_t_${i}">${fAmt(num(x.qty) * num(x.unitPrice), cur)}</td>` : ''}
        <td class="acts">${OR.lines.length > 1 ? `<button type="button" class="ib del" data-o="del-line:${i}" title="Remove">✕</button>` : ''}</td></tr>`; }).join('')}
    </tbody></table></div>
    <button type="button" class="btn sm ghost" data-o="add-line" style="margin-top:8px">+ Add product</button>

    <h3 class="osec">Extra costs</h3>
    ${OR.extras.length ? `<div class="tablewrap rx-table"><table class="t"><thead><tr><th>What</th><th>Description</th><th class="num">We pay (${cur})</th><th>Paid by</th>${sale ? `<th class="num">Customer pays (${cur})</th>` : ''}<th></th></tr></thead><tbody>
    ${OR.extras.map((x, i) => `<tr><td>${sel(`class="cell" data-oe="${i}" data-k="category"`, EXTRA_CATS, x.category)}</td>
      <td><input class="cell" data-oe="${i}" data-k="description" value="${esc(x.description)}" placeholder="e.g. Bosta courier"></td>
      <td class="num"><input class="cell n w" type="number" min="0" step="0.01" data-oe="${i}" data-k="cost" value="${esc(x.cost)}"></td>
      <td>${sel(`class="cell" data-oe="${i}" data-k="paidBy"`, people, x.paidBy)}</td>
      ${sale ? `<td class="num"><input class="cell n w" type="number" min="0" step="0.01" data-oe="${i}" data-k="charge" value="${esc(x.charge)}"></td>` : ''}
      <td class="acts"><button type="button" class="ib del" data-o="del-extra:${i}" title="Remove">✕</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="note">No extra costs. Add delivery, packaging or anything else this sale cost you, or that the customer pays on top.</p>'}
    <div class="topact" style="margin-top:8px">${EXTRA_CATS.map(c => `<button type="button" class="btn sm ghost" data-o="add-extra:${c}">+ ${c === 'Delivery to customer' ? 'Delivery' : c}</button>`).join('')}</div>

    <div class="grid2" style="margin-top:16px">
      <div class="f"><label>Notes</label><textarea data-oh="notes" rows="3">${esc(h.notes)}</textarea></div>
      <div class="card" id="o_tot">${totalsHTML()}</div>
    </div>
    ${err ? `<div class="err">${esc(err)}</div>` : ''}
    <div class="mact">${OR.isNew ? '' : '<button type="button" class="btn ghost terra-text" data-o="delete" style="margin-right:auto">Delete sale</button>'}
      <button type="button" class="btn ghost" data-o="close">Cancel</button><button type="button" class="btn" data-o="save">Save sale</button></div>`;
}
function saveOrder() {
  const R = calc(), h = OR.h, sale = h.kind === 'sale';
  const lines = OR.lines.filter(x => x.purchaseId && num(x.qty) > 0);
  if (!lines.length) return drawOrder('Add at least one product with a quantity.');
  const want = {}; lines.forEach(x => want[x.purchaseId] = (want[x.purchaseId] || 0) + num(x.qty));
  for (const [id, q] of Object.entries(want)) {
    const l = R.lots[id], av = (l ? l.left : 0) + (OR.orig[id] || 0);
    if (q > av) return drawOrder(`Only ${av} of “${l ? l.p.product : 'this product'}” are available.`);
  }
  if (sale && lines.some(x => x.unitPrice === '' || x.unitPrice == null)) return drawOrder('Enter a price for every product.');
  const oid = OR.id || uid();
  const base = { orderId: oid, date: h.date, kind: h.kind, currency: sale ? h.currency : 'EGP', rate: h.rate, customer: h.customer, place: h.place,
    receivedBy: h.receivedBy, method: h.method, paid: sale && !!h.paid, notes: h.notes };
  db.sales = db.sales.filter(s => !OR.old.sales.includes(s.id));
  db.expenses = db.expenses.filter(e => !OR.old.exps.includes(e.id));
  lines.forEach(x => db.sales.push(Object.assign({ id: uid() }, base, { purchaseId: x.purchaseId, qty: num(x.qty), unitPrice: sale ? num(x.unitPrice) : 0 })));
  OR.extras.forEach(x => {
    const key = uid(), what = x.description || x.category;
    if (num(x.cost) > 0) db.expenses.push({ id: uid(), orderId: oid, extraKey: key, date: h.date, category: x.category, description: what, amount: num(x.cost), currency: base.currency, rate: h.rate,
      paidBy: x.paidBy, method: 'Cash', place: h.place, shipmentId: '', notes: h.customer ? 'Sale to ' + h.customer : 'Sale' });
    if (sale && num(x.charge) > 0) db.sales.push(Object.assign({ id: uid() }, base, { extra: true, extraKey: key, purchaseId: '', product: what, category: x.category, qty: 1, unitPrice: num(x.charge) }));
  });
  commit(); odlg().close(); toast('Sale saved');
}
function deleteOrder(oid) {
  if (!confirm('Delete this sale with all its products and extra costs? The products go back into stock.')) return false;
  db.sales = db.sales.filter(s => !inOrder(s, oid));
  db.expenses = db.expenses.filter(e => e.orderId !== oid);
  commit(); toast('Sale deleted'); return true;
}
function markPaid(oid) {
  db.sales.forEach(s => { if (inOrder(s, oid) && s.kind === 'sale') s.paid = true; });
  commit(); toast('Marked as paid');
}

/* ---------- sales list ---------- */
V.sales = R => {
  const kinds = Object.fromEntries(OPT.kind);
  const pn = s => { const l = R.lots[s.purchaseId]; return l ? l.p.product : '(deleted product)'; };
  const rows = salesOrders().filter(o => { const h = o.h;
    return (!UI.person || h.receivedBy === UI.person) && (!UI.type || (UI.type === 'unpaid' ? h.kind === 'sale' && !h.paid : h.kind === UI.type))
      && match(o.lines.map(pn).join(' '), o.extras.map(s => s.product).join(' '), h.customer, h.place, h.method, h.notes); }).sort(byDate);
  let bill = 0, prof = 0;
  const body = rows.map(o => { const h = o.h, m = orderMoney(o, R); bill += m.bill; prof += m.profit;
    return `<tr><td>${fDate(h.date)}</td><td><b>${esc(h.customer || (h.kind === 'sale' ? 'Customer' : kinds[h.kind]))}</b><span class="sub">${esc(h.place || '')}${h.method && h.kind === 'sale' ? ' · ' + esc(h.method) : ''}</span></td>
      <td>${o.lines.map(s => `<span class="pline">${num(s.qty)}× ${esc(pn(s))}${h.kind === 'sale' ? ` <span class="note">@ ${fAmt(s.unitPrice, s.currency)}</span>` : ''}</span>`).join('')}
        ${o.extras.concat(o.costs).length ? `<span class="sub">${[...new Set(o.costs.map(e => e.description || e.category).concat(o.extras.map(s => s.product)))].map(esc).join(', ')}</span>` : ''}</td>
      <td class="num">${h.kind === 'sale' ? fEGP(m.bill) : '—'}${m.charged ? `<span class="sub">incl. ${fEGP(m.charged)} extras</span>` : ''}</td>
      <td class="num">${m.cost ? fEGP(m.cost) : '—'}</td>
      <td class="num ${m.profit >= 0 ? 'in-amt' : 'out-amt'}">${fEGP(m.profit)}</td>
      <td>${h.kind === 'sale' ? pill(h.receivedBy) : ''}</td>
      <td>${h.kind !== 'sale' ? `<span class="pill">${esc(kinds[h.kind])}</span>` : h.paid ? '<span class="pill ok">Paid</span>' : `<button class="btn sm terra" data-act="paid:${o.id}">Mark paid</button>`}</td>
      <td class="acts"><button class="ib" data-edit="sales:${o.id}" title="Edit">✎</button><button class="ib del" data-del="sales:${o.id}" title="Delete">✕</button></td></tr>`; }).join('');
  return `<div class="toolbar">${search('Search product, customer…')}${personFilter()}<select data-ui="type"><option value="">All types</option>${[['sale', 'Sales'], ['unpaid', 'Unpaid'], ['gift', 'Gifts'], ['damaged', 'Damaged / lost']].map(([v, l]) => `<option value="${v}"${UI.type === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
  <div class="tablewrap"><table class="t"><thead><tr><th>Date</th><th>Customer</th><th>Products</th><th class="num">Customer pays</th><th class="num">Extra costs</th><th class="num">Profit</th><th>Collected by</th><th>Status</th><th></th></tr></thead><tbody>
  ${body || '<tr><td colspan="9" class="empty">No sales yet. Press “Record sale”, or “Sell” on the Stock screen.</td></tr>'}
  </tbody><tfoot><tr><td colspan="3">${rows.length} sale${rows.length === 1 ? '' : 's'}</td><td class="num">${fEGP(bill)}</td><td></td><td class="num">${fEGP(prof)}</td><td colspan="3"></td></tr></tfoot></table></div>
  <p class="note">Profit = what the customer pays, minus the products’ cost including shipping from Germany, minus extra costs like delivery and packaging.</p>`;
};

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-new="sales"],[data-edit^="sales:"],[data-del^="sales:"],[data-act^="paid:"]');
  if (!t) return;
  e.stopImmediatePropagation(); e.preventDefault();
  if (t.dataset.new) return openOrder(null, t.dataset.preset ? JSON.parse(t.dataset.preset) : null);
  const oid = orderOf((t.dataset.edit || t.dataset.del || t.dataset.act).split(':')[1]);
  if (t.dataset.edit) openOrder(oid);
  else if (t.dataset.del) deleteOrder(oid);
  else markPaid(oid);
}, true);
document.addEventListener('click', e => {
  const b = e.target.closest('[data-o]'); if (!b || !OR) return;
  const [a, arg] = b.dataset.o.split(':');
  if (a === 'close') return odlg().close();
  if (a === 'save') return saveOrder();
  if (a === 'delete') { if (deleteOrder(OR.id)) odlg().close(); return; }
  if (a === 'add-line') OR.lines.push({ purchaseId: '', qty: 1, unitPrice: '' });
  if (a === 'del-line') OR.lines.splice(+arg, 1);
  if (a === 'add-extra') OR.extras.push({ category: arg, description: '', cost: '', paidBy: OR.h.receivedBy || 'friend', charge: '' });
  if (a === 'del-extra') OR.extras.splice(+arg, 1);
  drawOrder();
});
function orderInput(e, redraw) {
  const t = e.target; if (!OR || !t.closest('#obody')) return;
  const val = t.type === 'checkbox' ? t.checked : t.type === 'number' ? (t.value === '' ? '' : parseFloat(t.value)) : t.value;
  if (t.dataset.oh) OR.h[t.dataset.oh] = val;
  else if (t.dataset.ol) {
    const x = OR.lines[+t.dataset.ol]; x[t.dataset.k] = val;
    if (t.dataset.k === 'purchaseId' && x.unitPrice === '' && OR.h.kind === 'sale') { const l = calc().lots[val]; if (l && OR.h.currency === 'EGP') x.unitPrice = suggestEGP(l); }
    const c = $('#ol_t_' + t.dataset.ol); if (c) c.textContent = fAmt(num(x.qty) * num(x.unitPrice), OR.h.currency);
  } else if (t.dataset.oe) OR.extras[+t.dataset.oe][t.dataset.k] = val;
  else return;
  if (redraw) drawOrder(); else $('#o_tot').innerHTML = totalsHTML();
}
document.addEventListener('input', e => orderInput(e, false));
document.addEventListener('change', e => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') orderInput(e, true); });
