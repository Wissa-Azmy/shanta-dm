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
  const charged = o.extras.filter(s => !s.discount).reduce((a, s) => a + toEGP(num(s.qty) * num(s.unitPrice), s.currency, s.rate), 0);
  /* discounts: spread over the products (each line keeps its price before it as listPrice, so goods are already
     after the discount), or, in sales saved before that, one customer-pays line with a negative price */
  const discLine = -o.extras.filter(s => s.discount).reduce((a, s) => a + toEGP(num(s.qty) * num(s.unitPrice), s.currency, s.rate), 0);
  const spread = o.lines.reduce((a, s) => a + (num(s.listPrice) ? toEGP(num(s.qty) * (num(s.listPrice) - num(s.unitPrice)), s.currency, s.rate) : 0), 0);
  const discount = discLine + spread;
  const cost = o.costs.reduce((a, e) => a + toEGP(e.amount, e.currency, e.rate), 0);
  const landed = o.lines.reduce((a, s) => { const l = R.lots[s.purchaseId]; return a + (l ? eur2egp(num(s.qty) * l.landed) : 0); }, 0);
  return { goods, charged, discount, bill: goods + charged - discLine, cost, landed, profit: goods + charged - discLine - landed - cost };
}

/* ---------- editor ---------- */
function odlg() {
  let d = $('#odlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'odlg'; d.innerHTML = '<div id="obody" tabindex="-1" autofocus></div>'; document.body.appendChild(d); }
  return d;
}
function openOrder(id, preset) {
  const o = id ? salesOrders().find(x => x.id === id) : null;
  if (o) {
    const h = o.h, ex = {};
    o.costs.forEach(e => { const k = e.extraKey || e.id; ex[k] = Object.assign(ex[k] || { category: e.category, description: e.description || '', charge: '' }, { cost: num(e.amount), paidBy: e.paidBy }); });
    o.extras.filter(s => !s.discount).forEach(s => { const k = s.extraKey || s.id; ex[k] = Object.assign(ex[k] || { category: s.category || 'Other', description: s.product || '', cost: '', paidBy: 'friend' }, { charge: num(s.unitPrice) }); });
    const disc = -o.extras.filter(s => s.discount).reduce((a, s) => a + num(s.qty) * num(s.unitPrice), 0)
      + o.lines.reduce((a, s) => a + (num(s.listPrice) ? num(s.qty) * (num(s.listPrice) - num(s.unitPrice)) : 0), 0);
    OR = { id: o.id, isNew: false,
      h: { date: h.date, customer: h.customer || '', place: h.place || '', receivedBy: h.receivedBy || 'friend', method: h.method || 'Cash', paid: !!h.paid, payMode: h.payMode || (h.paid ? 'full' : 'credit'), downPayment: h.downPayment || '', dueDate: h.dueDate || '', currency: h.currency || 'EGP', rate: h.rate || db.settings.rate, kind: h.kind || 'sale', notes: h.notes || '', discount: disc > 0 ? Math.round(disc * 100) / 100 : '' },
      lines: o.lines.map(s => ({ purchaseId: s.purchaseId, qty: num(s.qty), unitPrice: h.kind === 'sale' ? r2(num(s.listPrice) || num(s.unitPrice)) : '' })),
      extras: Object.values(ex),
      old: { sales: o.lines.concat(o.extras).map(s => s.id), exps: o.costs.map(e => e.id) }, orig: {} };
    o.lines.forEach(s => OR.orig[s.purchaseId] = (OR.orig[s.purchaseId] || 0) + num(s.qty));
  } else {
    OR = { id: null, isNew: true,
      h: { date: today(), customer: '', place: db.settings.cityEG, receivedBy: 'friend', method: 'Cash', paid: true, payMode: 'full', downPayment: '', dueDate: '', currency: 'EGP', rate: db.settings.rate, kind: 'sale', notes: '', discount: '' },
      lines: [{ purchaseId: (preset && preset.purchaseId) || '', qty: 1, unitPrice: '' }], extras: [], old: { sales: [], exps: [] }, orig: {} };
    /* several products picked on Stock: one line each, 1 unit at the suggested price */
    if (preset && preset.purchaseIds) {
      const R = calc();
      OR.lines = preset.purchaseIds.map(id => R.lots[id]).filter(l => l && l.left > 0).map(l => ({ purchaseId: l.p.id, qty: 1, unitPrice: suggestEGP(l) }));
      if (!OR.lines.length) OR.lines = [{ purchaseId: '', qty: 1, unitPrice: '' }];
    }
    /* lines worked out elsewhere (the Egypt stock count): purchase, quantity and price given */
    if (preset && preset.lines && preset.lines.length) OR.lines = preset.lines.map(x => Object.assign({}, x));
    if (preset && preset.notes) OR.h.notes = preset.notes;
    /* a shop order: customer, payment and delivery filled in, and told the sale's id once it is saved */
    if (preset && preset.h) Object.assign(OR.h, preset.h);
    if (preset && preset.extras) OR.extras = preset.extras.map(x => Object.assign({}, x));
    if (preset && preset.onSave) OR.after = preset.onSave;
  }
  /* a new sale without products starts with the product search open */
  Object.assign(OPK, { open: !OR.lines.some(x => x.purchaseId), q: '', line: -1 });
  const d = odlg(); drawOrder(); if (!d.open) d.showModal();
  if (OPK.open) setTimeout(() => { const q = $('#pk_q'); if (q) q.focus(); }, 60);
}
function suggestEGP(l) { return Math.ceil(eur2egp(l.landed) * (1 + num(db.settings.targetMargin) / 100) / 5) * 5; }
function orderTotals() {
  const R = calc(), h = OR.h, sale = h.kind === 'sale';
  const egp = a => toEGP(a, h.currency, h.rate);
  const goods = sale ? OR.lines.reduce((a, x) => a + egp(num(x.qty) * num(x.unitPrice)), 0) : 0;
  const charged = sale ? OR.extras.reduce((a, x) => a + egp(num(x.charge)), 0) : 0;
  const discount = sale ? egp(num(h.discount)) : 0;
  const cost = OR.extras.reduce((a, x) => a + egp(num(x.cost)), 0);
  const landed = OR.lines.reduce((a, x) => { const l = R.lots[x.purchaseId]; return a + (l ? eur2egp(num(x.qty) * l.landed) : 0); }, 0);
  return { goods, charged, discount, before: goods + charged, bill: goods + charged - discount, cost, landed, profit: goods + charged - discount - landed - cost, units: OR.lines.reduce((a, x) => a + num(x.qty), 0) };
}
/* the sale's total before the discount, in the sale's own currency */
const beforeDisc = () => { return OR.lines.reduce((a, x) => a + num(x.qty) * num(x.unitPrice), 0) + OR.extras.reduce((a, x) => a + num(x.charge), 0); };
const r2 = x => Math.round(x * 100) / 100;
function discountHTML() {
  const h = OR.h, cur = h.currency, before = beforeDisc(), real = h.discount === '' ? '' : r2(before - num(h.discount));
  return `<h3 class="osec">Discount</h3><p class="note">Spread over the products by their share of the price, like receipt coupons. Each product keeps its price before the discount for reference.</p>
    <div class="grid2 odisc">
      <div class="f"><label>Discount (${cur})</label><input type="text" inputmode="decimal" data-num="1" data-oh="discount" id="o_disc" value="${esc(h.discount)}" placeholder="0"></div>
      <div class="f"><label>Or type what the customer really pays (${cur})</label><input type="text" inputmode="decimal" data-num="1" data-oreal="1" id="o_real" value="${esc(real)}" placeholder="${esc(fAmt(before, cur))}">
      <span class="hint">The discount is worked out for you: ${esc(fAmt(before, cur))} before the discount.</span></div>
    </div>`;
}
function totalsHTML() {
  const t = orderTotals(), sale = OR.h.kind === 'sale', f = x => fAmt(OR.h.currency === 'EUR' ? x / (num(OR.h.rate) || rate()) : x, OR.h.currency);
  return `<dl class="kv">
    ${sale ? `<dt>Products (${t.units} units)</dt><dd>${f(t.goods)}</dd><dt>Extras the customer pays</dt><dd>${f(t.charged)}</dd>
    ${t.discount ? `<dt>Discount</dt><dd class="out-amt">− ${f(t.discount)}</dd>` : ''}
    <dt><b>Customer pays in total</b></dt><dd><b>${f(t.bill)}</b></dd>
    ${OR.h.payMode !== 'full' ? (() => { const now = OR.h.payMode === 'down' ? toEGP(num(OR.h.downPayment), OR.h.currency, OR.h.rate) : 0;
      return `<dt class="kvsub">Paid now</dt><dd class="kvsub">${f(now)}</dd><dt class="kvsub">On ${esc(OR.h.customer || 'the customer')}’s credit</dt><dd class="kvsub">${f(Math.max(0, t.bill - now))}${OR.h.dueDate ? ` <span class="pill warn">due ${fDate(OR.h.dueDate)}</span>` : ''}</dd>`; })() : ''}` : `<dt>Units leaving stock</dt><dd>${t.units}</dd>`}
    <dt>Product cost incl. shipping</dt><dd>${fEGP(t.landed)}</dd><dt>Extra costs we pay</dt><dd>${f(t.cost)}</dd>
    <dt><b>${sale ? 'Profit on this sale' : 'Cost of this ' + (OR.h.kind === 'gift' ? 'gift' : 'loss')}</b></dt><dd class="${t.profit >= 0 ? 'in-amt' : 'out-amt'}"><b>${fEGP(t.profit)}</b></dd>${sale && markupPct(t) !== null ? `<dt>Markup on cost</dt><dd>${markupTag(t)}<span class="sub">on ${fEGP(num(t.landed) + num(t.cost))} cost</span></dd>` : ''}</dl>`;
}
function drawOrder(err) {
  const R = calc(), h = OR.h, sale = h.kind === 'sale', cur = h.currency;
  const avail = id => { const l = R.lots[id]; return l ? l.left + (OR.orig[id] || 0) : 0; };
  const lots = Object.values(R.lots).filter(l => avail(l.p.id) > 0 || OR.lines.some(x => x.purchaseId === l.p.id)).sort((a, b) => a.p.product.localeCompare(b.p.product));
  const opt = (v, l, s) => `<option value="${esc(v)}"${String(v) === String(s) ? ' selected' : ''}>${esc(l)}</option>`;
  const sel = (attr, opts, v) => `<select ${attr}>${opts.map(x => Array.isArray(x) ? x : [x, x]).map(([a, b]) => opt(a, b, v)).join('')}</select>`;
  const people = PEOPLE.map(p => [p, pname(p)]), payers = sale ? [...people, ['sale', 'From sale']] : people;
  $('#obody').innerHTML = `<div class="rhead"><div><h2>${OR.isNew ? 'New sale' : 'Edit sale'}</h2><p class="lead">Add every product the customer takes, then any extra costs such as delivery or packaging.</p></div>
    <button type="button" class="ib" data-o="close" title="Close">✕</button></div>
    <div class="fgrid rx-opts">
      <div class="f"><label>Date</label><input type="date" data-oh="date" value="${esc(h.date)}"></div>
      <div class="f"><label>Type</label>${sel('data-oh="kind"', OPT.kind, h.kind)}</div>
      <div class="f"><label>Customer</label><input data-oh="customer" value="${esc(h.customer)}" list="o_customers" autocomplete="off"><datalist id="o_customers">${uniq(db.sales.map(s => s.customer)).map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="f"><label>Where</label><input data-oh="place" value="${esc(h.place)}"></div>
      ${sale ? `<div class="f"><label>Currency</label>${sel('data-oh="currency"', OPT.cur, cur)}</div>
      ${cur !== 'EUR' ? `<div class="f"><label>Rate (EGP per €1)</label><input type="text" inputmode="decimal" data-num="1" step="0.01" data-oh="rate" value="${esc(h.rate)}"></div>` : ''}
      <div class="f"><label>Money collected by</label>${sel('data-oh="receivedBy"', people, h.receivedBy)}</div>
      <div class="f"><label>Paid with</label>${sel('data-oh="method"', OPT.payEG, h.method)}</div>
      <div class="f"><label>Payment</label>${sel('data-oh="payMode"', PAY_MODES, h.payMode)}</div>
      ${h.payMode === 'down' ? `<div class="f"><label>Down payment now (${cur})</label><input type="text" inputmode="decimal" data-num="1" data-oh="downPayment" value="${esc(h.downPayment)}" placeholder="e.g. 500"></div>` : ''}
      ${h.payMode !== 'full' ? `<div class="f"><label>Due date for the rest (optional)</label><input type="date" data-oh="dueDate" value="${esc(h.dueDate)}"></div>` : ''}` : ''}
    </div>

    <h3 class="osec">Products</h3>
    <div class="tablewrap rx-table"><table class="t"><thead><tr><th>Product</th><th class="num">Qty</th>${sale ? `<th class="num">Price per unit (${cur})</th><th class="num">Line total</th>` : ''}<th></th></tr></thead><tbody>
    ${OR.lines.map((x, i) => { const l = R.lots[x.purchaseId];
      return `<tr><td>${l ? `<button type="button" class="pkpick" data-o="pk-line:${i}" title="Change the product"><b>${esc(l.p.product)}</b><span class="sub">${l.p.brand ? esc(l.p.brand) + ' · ' : ''}${avail(l.p.id)} available</span></button>` : `<button type="button" class="btn sm ghost" data-o="pk-line:${i}">Choose a product…</button>`}
        ${l ? `<span class="sub">Cost incl. shipping ${fEGP(eur2egp(l.landed))} · ${db.settings.targetMargin}% markup → ${fEGP(suggestEGP(l))}</span>` : ''}</td>
        <td class="num"><input class="cell n" type="text" inputmode="decimal" data-num="1" min="1" step="1" data-ol="${i}" data-k="qty" value="${esc(x.qty)}"></td>
        ${sale ? `<td class="num"><input class="cell n w" type="text" inputmode="decimal" data-num="1" min="0" step="0.01" data-ol="${i}" data-k="unitPrice" value="${esc(x.unitPrice)}" placeholder="${l ? suggestEGP(l) : ''}"></td>
        <td class="num" id="ol_t_${i}">${fAmt(num(x.qty) * num(x.unitPrice), cur)}</td>` : ''}
        <td class="acts">${OR.lines.length > 1 ? `<button type="button" class="ib del" data-o="del-line:${i}" title="Remove">${TRASH}</button>` : ''}</td></tr>`; }).join('')}
    </tbody></table></div>
    <div class="topact" style="margin-top:8px"><button type="button" class="btn sm" data-o="add-line">+ Add products</button><button type="button" class="btn sm ghost" data-o="scan">${SCANICON} Scan products</button></div>
    ${pickerHTML(R)}

    <h3 class="osec">Extra costs</h3>${sale ? '<p class="note">Choose “From sale” for costs taken out of what the customer paid (e.g. free delivery the courier keeps): it lowers the sale’s profit and the money collected, and isn’t charged to either of you.</p>' : ''}
    ${OR.extras.length ? `<div class="tablewrap rx-table"><table class="t"><thead><tr><th>What</th><th>Description</th><th class="num">We pay (${cur})</th><th>Paid by</th>${sale ? `<th class="num">Customer pays (${cur})</th>` : ''}<th></th></tr></thead><tbody>
    ${OR.extras.map((x, i) => `<tr><td>${sel(`class="cell" data-oe="${i}" data-k="category"`, EXTRA_CATS, x.category)}</td>
      <td><input class="cell" data-oe="${i}" data-k="description" value="${esc(x.description)}" placeholder="e.g. Bosta courier"></td>
      <td class="num"><input class="cell n w" type="text" inputmode="decimal" data-num="1" min="0" step="0.01" data-oe="${i}" data-k="cost" value="${esc(x.cost)}"></td>
      <td>${sel(`class="cell" data-oe="${i}" data-k="paidBy"`, payers, !sale && x.paidBy === 'sale' ? OR.h.receivedBy || 'friend' : x.paidBy)}</td>
      ${sale ? `<td class="num"><input class="cell n w" type="text" inputmode="decimal" data-num="1" min="0" step="0.01" data-oe="${i}" data-k="charge" value="${esc(x.charge)}"></td>` : ''}
      <td class="acts"><button type="button" class="ib del" data-o="del-extra:${i}" title="Remove">${TRASH}</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="note">No extra costs. Add delivery, packaging or anything else this sale cost you, or that the customer pays on top.</p>'}
    <div class="topact" style="margin-top:8px">${EXTRA_CATS.map(c => `<button type="button" class="btn sm ghost" data-o="add-extra:${c}">+ ${c === 'Delivery to customer' ? 'Delivery' : c}</button>`).join('')}</div>

    ${sale ? discountHTML() : ''}
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
  const disc = sale ? r2(num(h.discount)) : 0;
  const listTot = lines.reduce((a, x) => a + num(x.qty) * num(x.unitPrice), 0);
  if (disc < 0) return drawOrder('The discount can’t be below 0. Add an extra the customer pays instead.');
  if (disc > 0 && disc > r2(listTot) + 0.005) return drawOrder('The discount is bigger than the products’ total.');
  if (sale && h.payMode !== 'full') {
    if (!String(h.customer || '').trim()) return drawOrder('Enter the customer’s name: the rest goes on their credit balance.');
    const bill = orderTotals().bill, dp = toEGP(num(h.downPayment), h.currency, h.rate);
    if (h.payMode === 'down' && !(dp > 0)) return drawOrder('Enter the down payment, or choose “On credit” if nothing was paid now.');
    if (h.payMode === 'down' && dp >= bill - 0.005) return drawOrder('The down payment covers the whole sale; choose “Paid in full” instead.');
  }
  const oid = OR.id || uid();
  const base = { orderId: oid, date: h.date, kind: h.kind, currency: sale ? h.currency : 'EGP', rate: h.rate, customer: h.customer, place: h.place,
    receivedBy: h.receivedBy, method: h.method, paid: sale && h.payMode === 'full', payMode: sale ? h.payMode : '', downPayment: sale && h.payMode === 'down' ? num(h.downPayment) : '', dueDate: sale && h.payMode !== 'full' ? h.dueDate : '', notes: h.notes };
  db.sales = db.sales.filter(s => !OR.old.sales.includes(s.id));
  db.expenses = db.expenses.filter(e => !OR.old.exps.includes(e.id));
  /* the discount is spread over the products by their share of the products' total, like receipt coupons;
     each line keeps the price before the discount as listPrice */
  const f = disc > 0 && listTot > 0 ? (listTot - disc) / listTot : 1;
  lines.forEach(x => db.sales.push(Object.assign({ id: uid() }, base, { purchaseId: x.purchaseId, qty: num(x.qty),
    unitPrice: sale ? (f < 1 ? Math.round(num(x.unitPrice) * f * 10000) / 10000 : num(x.unitPrice)) : 0 }, sale && f < 1 ? { listPrice: num(x.unitPrice) } : {})));
  OR.extras.forEach(x => {
    const key = uid(), what = x.description || x.category;
    if (num(x.cost) > 0) db.expenses.push({ id: uid(), orderId: oid, extraKey: key, date: h.date, category: x.category, description: what, amount: num(x.cost), currency: base.currency, rate: h.rate,
      paidBy: x.paidBy === 'sale' && !sale ? (h.receivedBy || 'friend') : x.paidBy, method: 'Cash', place: h.place, shipmentId: '', notes: h.customer ? 'Sale to ' + h.customer : 'Sale' });
    if (sale && num(x.charge) > 0) db.sales.push(Object.assign({ id: uid() }, base, { extra: true, extraKey: key, purchaseId: '', product: what, category: x.category, qty: 1, unitPrice: num(x.charge) }));
  });
  const after = OR.after;
  commit(); odlg().close(); toast('Sale saved');
  if (after) after(oid);
}
function deleteOrder(oid) {
  const paid = db.payments.filter(p => p.orderId === oid);
  if (!confirm('Delete this sale with all its products and extra costs? The products go back into stock.' + (paid.length ? `\n\n${paid.length} credit payment${paid.length === 1 ? '' : 's'} recorded for it will stay on the customer’s account and count toward their other open sales.` : ''))) return false;
  db.sales = db.sales.filter(s => !inOrder(s, oid));
  db.expenses = db.expenses.filter(e => e.orderId !== oid);
  paid.forEach(p => p.orderId = '');
  commit(); toast('Sale deleted'); return true;
}
/* "Record payment" on a sale: open the credit payment form with what is still owed */
function markPaid(oid) {
  const o = calc().book.byId[oid];
  if (!o || o.balance <= 0.005) return toast('Nothing left to pay on this sale');
  openForm('payments', null, { customer: o.h.customer || '', orderId: oid, amount: Math.round(o.balance * 100) / 100, currency: o.cur, rate: o.rate, receivedBy: o.h.receivedBy || 'friend' });
}
const PAY_MODES = [['full', 'Paid in full'], ['down', 'Down payment, rest on credit'], ['credit', 'On credit (nothing paid now)']];
function payStatus(o, kind) {
  if (kind !== 'sale') return '';
  if (!o || o.balance <= 0.005) return '<span class="pill ok">Paid</span>';
  const part = o.collected > 0.005 ? `<span class="sub">${fAmt(o.collected, o.cur)} of ${fAmt(o.bill, o.cur)} paid</span>` : '';
  const due = o.h.dueDate ? `<span class="sub ${o.overdue ? 'out-amt' : ''}">${o.overdue ? 'Overdue since' : 'Due'} ${fDate(o.h.dueDate)}</span>` : '';
  return `<span class="pill ${o.overdue ? 'bad' : 'warn'}">Owes ${fAmt(o.balance, o.cur)}</span>${part}${due}<button class="btn sm terra" data-act="paid:${o.id}" style="margin-top:4px">+ Payment</button>`;
}

/* ---------- sales list ---------- */
V.sales = R => {
  const kinds = Object.fromEntries(OPT.kind);
  const pn = s => { const l = R.lots[s.purchaseId]; return l ? l.p.product : '(deleted product)'; };
  const rows = salesOrders().filter(o => { const h = o.h;
    const b = R.book.byId[o.id];
    return (!UI.person || h.receivedBy === UI.person) && (!UI.type || (UI.type === 'unpaid' ? h.kind === 'sale' && b && b.balance > 0.005 : UI.type === 'overdue' ? b && b.overdue : h.kind === UI.type))
      && match(o.lines.map(pn).join(' '), o.extras.map(s => s.product).join(' '), h.customer, h.place, h.method, h.notes); }).sort(byDate);
  let bill = 0, prof = 0, costT = 0;
  const body = rows.map(o => { const h = o.h, m = orderMoney(o, R); bill += m.bill; prof += m.profit; costT += num(m.landed) + num(m.cost);
    return `<tr><td>${fDate(h.date)}</td><td><b>${esc(h.customer || (h.kind === 'sale' ? 'Customer' : kinds[h.kind]))}</b>${unsentTag('sales', o.id)}<span class="sub">${esc(h.place || '')}${h.method && h.kind === 'sale' ? ' · ' + esc(h.method) : ''}</span></td>
      <td>${saleSummary(o, pn)}</td>
      <td class="num">${h.kind === 'sale' ? fEGP(m.bill) : '—'}${m.charged ? `<span class="sub">incl. ${fEGP(m.charged)} extras</span>` : ''}${m.discount ? `<span class="sub">after ${fEGP(m.discount)} discount</span>` : ''}</td>
      <td class="num">${m.cost ? fEGP(m.cost) : '—'}</td>
      <td class="num ${m.profit >= 0 ? 'in-amt' : 'out-amt'}">${fEGP(m.profit)}${h.kind === 'sale' ? markupTag(m) + costNote(m) : ''}</td>
      <td>${h.kind === 'sale' ? pill(h.receivedBy) : ''}</td>
      <td class="paycell">${h.kind !== 'sale' ? `<span class="pill">${esc(kinds[h.kind])}</span>` : payStatus(R.book.byId[o.id], h.kind)}</td>
      <td class="acts"><button class="ib" data-edit="sales:${o.id}" title="Edit">${PENCIL}</button><button class="ib del" data-del="sales:${o.id}" title="Delete">${TRASH}</button></td></tr>`; }).join('');
  return `<div class="toolbar">${search('Search product, customer…')}${personFilter()}<select data-ui="type"><option value="">All types</option>${[['sale', 'Sales'], ['unpaid', 'Not fully paid'], ['overdue', 'Overdue'], ['gift', 'Gifts'], ['damaged', 'Damaged / lost']].map(([v, l]) => `<option value="${v}"${UI.type === v ? ' selected' : ''}>${l}</option>`).join('')}</select>${resetBtn("q", "person", "type")}${viewToggle('sales')}</div>
  ${totBar([['Sales', rows.length], ['Customer pays', fEGP(bill)], ['Total cost', fEGP(costT)], ['Profit', fEGP(prof) + markupTag({ profit: prof, landed: costT, cost: 0 })], ['Still owed', fEGP(rows.reduce((a, o) => { const b = R.book.byId[o.id]; return a + (b && b.balanceEGP > 0 ? b.balanceEGP : 0); }, 0))]], rows.length)}${isGrid('sales') ? `<div class="cgrid">${rows.map(o => saleCard(o, R, pn, kinds)).join('') || '<div class="empty">No sales yet. Press “Record sale”, or “Sell” on the Stock screen.</div>'}</div>` : `<div class="tablewrap"><table class="t"><thead><tr><th>Date</th><th>Customer</th><th>Products</th><th class="num">Customer pays</th><th class="num">Extra costs</th><th class="num">Profit</th><th>Collected by</th><th>Status</th><th></th></tr></thead><tbody>
  ${body || '<tr><td colspan="9" class="empty">No sales yet. Press “Record sale”, or “Sell” on the Stock screen.</td></tr>'}
  </tbody><tfoot><tr><td colspan="3">${rows.length} sale${rows.length === 1 ? '' : 's'}</td><td class="num">${fEGP(bill)}</td><td></td><td class="num">${fEGP(prof)}${markupTag({ profit: prof, landed: costT, cost: 0 })}</td><td colspan="3"></td></tr></tfoot></table></div>`}
  <p class="note">Profit = what the customer pays, minus the products’ cost including shipping from Germany, minus extra costs like delivery and packaging.</p>`;
};

/* ---------- selling by scan ----------
   One unit per scan, taken from the oldest purchase of that product that still has stock;
   when that one runs out the next scan starts a line from the next box.
   Returns the message to show, or null when the barcode isn't linked to a product. */
function addScanned(code) {
  const R = calc(), lots = eanLines(code).map(p => R.lots[p.id]).filter(Boolean);
  if (!lots.length) return null;
  const ids = lots.map(l => l.p.id), name = lots[0].p.product, brand = lots[0].p.brand || '';
  const used = id => OR.lines.filter(x => x.purchaseId === id).reduce((a, x) => a + num(x.qty), 0);
  const free = l => l.left + (OR.orig[l.p.id] || 0) - used(l.p.id);
  lots.sort((a, b) => (a.p.date || '').localeCompare(b.p.date || ''));
  const l = lots.find(x => free(x) > 0);
  if (!l) return { kind: 'warn', name, brand, note: 'None left in stock' };
  const line = OR.lines.find(x => x.purchaseId === l.p.id);
  if (line) line.qty = num(line.qty) + 1;
  else {
    const same = OR.lines.find(x => ids.includes(x.purchaseId) && x.unitPrice !== '');
    const price = OR.h.kind !== 'sale' ? '' : same ? same.unitPrice : OR.h.currency === 'EGP' ? suggestEGP(l) : '';
    const empty = OR.lines.find(x => !x.purchaseId), nl = { purchaseId: l.p.id, qty: 1, unitPrice: price };
    if (empty) Object.assign(empty, nl); else OR.lines.push(nl);
  }
  const n = OR.lines.filter(x => ids.includes(x.purchaseId)).reduce((a, x) => a + num(x.qty), 0);
  const ln = OR.lines.find(x => x.purchaseId === l.p.id), pr = ln && ln.unitPrice !== '' ? num(ln.unitPrice) : 0;
  return { kind: 'ok', name, brand, box: shipName(l.p.shipmentId), n, unit: 'in this sale', price: OR.h.kind === 'sale' && pr ? fAmt(pr, OR.h.currency) : '' };
}
function scanIntoOrder() {
  let unknown = '';
  Scan.read('Scan the products', code => {
    if (!OR || !odlg().open) return null;
    const r = addScanned(code);
    if (r === null) { unknown = code; return null; }
    drawOrder(); return r;
  }).then(() => {
    if (unknown && OR) showCode(unknown, c => { const r = addScanned(c); drawOrder(); if (r) toast(scanText(r)); });
  });
}
function sellCode(code) { openOrder(null); const r = addScanned(code); drawOrder(); if (r) toast(scanText(r)); }

/* ---------- events ---------- */
document.addEventListener('click', e => {
  if (!e.target.closest('[data-scansell]')) return;
  openOrder(null); scanIntoOrder();
});
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
  if (a === 'scan') return scanIntoOrder();
  if (a === 'delete') { if (deleteOrder(OR.id)) odlg().close(); return; }
  if (a === 'add-line') { OPK.open = true; OPK.line = -1; }
  if (a === 'pk-line') { OPK.open = true; OPK.line = +arg; OPK.q = ''; }
  if (a === 'pk-clear') { OPK.q = ''; const q = $('#pk_q'); if (q) { q.value = ''; q.focus(); } b.hidden = true; redrawPicker(false); return; }
  if (a === 'pk-close') { OPK.open = false; OPK.line = -1; OPK.q = ''; OR.lines = OR.lines.filter((x, i) => x.purchaseId || OR.lines.length === 1); }
  if (a === 'pk-add') { pickerAdd(b.dataset.o.slice(7)); drawOrder(); if (OPK.open) { const q = $('#pk_q'); if (q) q.focus(); } return; }
  if (a === 'del-line') OR.lines.splice(+arg, 1);
  if (a === 'add-extra') OR.extras.push({ category: arg, description: '', cost: '', paidBy: OR.h.receivedBy || 'friend', charge: '' });
  if (a === 'del-extra') OR.extras.splice(+arg, 1);
  drawOrder();
});
function orderInput(e, redraw) {
  const t = e.target; if (!OR || !t.closest('#obody')) return;
  const val = t.type === 'checkbox' ? t.checked : t.dataset.num ? (t.value === '' ? '' : num(t.value)) : t.value;
  if (t.dataset.oh) OR.h[t.dataset.oh] = val;
  else if (t.dataset.ol) {
    const x = OR.lines[+t.dataset.ol]; x[t.dataset.k] = val;
    if (t.dataset.k === 'purchaseId' && x.unitPrice === '' && OR.h.kind === 'sale') { const l = calc().lots[val]; if (l && OR.h.currency === 'EGP') x.unitPrice = suggestEGP(l); }
    const c = $('#ol_t_' + t.dataset.ol); if (c) c.textContent = fAmt(num(x.qty) * num(x.unitPrice), OR.h.currency);
  } else if (t.dataset.oe) OR.extras[+t.dataset.oe][t.dataset.k] = val;
  else if (t.dataset.oreal) {
    /* the real total typed in: the discount is the difference (only down; to go up, add an extra) */
    OR.h.discount = val === '' ? '' : r2(Math.max(0, beforeDisc() - val));
    const d = $('#o_disc'); if (d) d.value = OR.h.discount;
  }
  else return;
  if (t.dataset.oh === 'discount' || t.dataset.ol || t.dataset.oe) { const r = $('#o_real'); if (r && r !== t) { const b = beforeDisc(); r.value = OR.h.discount === '' ? '' : r2(b - num(OR.h.discount)); r.placeholder = fAmt(b, OR.h.currency); } }
  if (redraw) drawOrder(); else $('#o_tot').innerHTML = totalsHTML();
}
document.addEventListener('input', e => orderInput(e, false));
document.addEventListener('change', e => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') orderInput(e, true); });

/* ---------- credit payments: later payments against a customer's balance ---------- */
function openCustomers(skip) {
  const B = saleBook(skip);
  return Object.values(B.customers).filter(c => c.balanceEGP > 0.005).sort((a, b) => a.name.localeCompare(b.name));
}
SCHEMAS.payments = {
  title: 'credit payment', lead: 'Money a customer pays later against what they still owe.',
  fields: [
    { k: 'date', l: 'Date', t: 'date', def: today, req: true },
    { k: 'customer', l: 'Customer', t: 'select', req: true, opts: v => {
      const list = openCustomers(modal && modal.id).map(c => [c.name, `${c.name} · owes ${fEGP(c.balanceEGP)}`]);
      if (v.customer && !list.some(([n]) => custKey(n) === custKey(v.customer))) list.unshift([v.customer, v.customer]);
      return [['', list.length ? 'Choose a customer…' : 'Nobody owes anything']].concat(list); } },
    { k: 'orderId', l: 'Pays for', t: 'select', opts: v => {
      const B = saleBook(modal && modal.id), c = custKey(v.customer);
      const open = B.orders.filter(o => custKey(o.h.customer) === c && (o.balance > 0.005 || o.id === v.orderId)).sort((a, b) => (a.h.date || '').localeCompare(b.h.date || ''));
      return [['', 'Oldest open sales first']].concat(open.map(o => [o.id, `Sale of ${fDate(o.h.date)} · owes ${fAmt(o.balance, o.cur)}${o.h.dueDate ? ' · due ' + fDate(o.h.dueDate) : ''}`])); } },
    { t: 'info', html: v => { const B = saleBook(modal && modal.id), c = B.customers[custKey(v.customer)]; if (!c) return '';
      return `${esc(c.name)} owes <b>${fEGP(c.balanceEGP)}</b> in total${c.overdue ? `, of which <b>${fEGP(c.overdue)}</b> is overdue` : ''}${c.nextDue ? ` · next due ${fDate(c.nextDue)}` : ''}.`; } },
    { k: 'amount', l: 'Amount', t: 'number', req: true },
    { k: 'currency', l: 'Currency', t: 'select', opts: OPT.cur, def: 'EGP' },
    rateField(),
    { k: 'receivedBy', l: 'Money collected by', t: 'person', def: 'friend' },
    { k: 'method', l: 'Paid with', t: 'select', opts: OPT.payEG, def: 'Cash' },
    { k: 'notes', l: 'Notes', t: 'textarea', span: true }
  ],
  validate(v) {
    if (!(num(v.amount) > 0)) return 'Enter the amount paid.';
    const B = saleBook(modal && modal.id), c = B.customers[custKey(v.customer)];
    if (!c || c.balanceEGP <= 0.005) return 'This customer has nothing left to pay.';
    const egp = toEGP(num(v.amount), v.currency, v.rate);
    if (egp > c.balanceEGP + 0.5) return `${c.name} only owes ${fEGP(c.balanceEGP)}. Enter at most that amount.`;
  }
};

/* ---------- customers screen ---------- */
V.customers = R => {
  const B = R.book, t = today();
  const list = Object.values(B.customers).filter(c => match(c.name)).sort((a, b) => b.overdue - a.overdue || b.balanceEGP - a.balanceEGP || a.name.localeCompare(b.name));
  const owing = list.filter(c => c.balanceEGP > 0.005);
  const pays = db.payments.slice().sort(byDate).filter(p => match(p.customer, p.method, p.notes));
  const total = owing.reduce((a, c) => a + c.balanceEGP, 0), overdue = owing.reduce((a, c) => a + c.overdue, 0);
  return `<div class="stamps">
    <div class="stamp t"><div class="in"><div class="k">Customers owe</div><div class="v">${fEGP(total)}</div><div class="s">${owing.length} customer${owing.length === 1 ? '' : 's'}</div></div></div>
    <div class="stamp ${overdue ? 't' : 'n'}"><div class="in"><div class="k">Overdue</div><div class="v">${fEGP(overdue)}</div><div class="s">past the due date</div></div></div>
    <div class="stamp n"><div class="in"><div class="k">Credit payments</div><div class="v">${fEGP(db.payments.reduce((a, p) => a + toEGP(p.amount, p.currency, p.rate), 0))}</div><div class="s">${db.payments.length} recorded</div></div></div>
  </div>
  <div class="toolbar">${search('Search customer')}${resetBtn('q')}${viewToggle('customers')}</div>
  ${isGrid('customers') ? `<div class="cgrid">${list.map(c => custCard(c, t)).join('') || '<div class="empty">No customers yet. They appear here when you record a sale with a customer name.</div>'}</div>` : `<div class="tablewrap"><table class="t"><thead><tr><th>Customer</th><th class="num">Bought</th><th class="num">Still owes</th><th>Due</th><th>Open sales</th><th></th></tr></thead><tbody>
  ${list.map(c => { const open = c.orders.filter(o => o.balance > 0.005);
    return `<tr><td><b>${esc(c.name)}</b></td><td class="num">${fEGP(c.billEGP)}</td>
      <td class="num">${c.balanceEGP > 0.005 ? `<b class="${c.overdue ? 'out-amt' : ''}">${fEGP(c.balanceEGP)}</b>${c.overdue ? `<span class="sub out-amt">${fEGP(c.overdue)} overdue</span>` : ''}` : '<span class="pill ok">Nothing</span>'}</td>
      <td>${c.nextDue ? `<span class="pill ${c.nextDue < t ? 'bad' : 'warn'}">${fDate(c.nextDue)}</span>` : '—'}</td>
      <td>${open.map(o => `<span class="pline">${fDate(o.h.date)} · ${fAmt(o.balance, o.cur)} <button class="ib" data-edit="sales:${o.id}" title="Open sale">${PENCIL}</button></span>`).join('') || '<span class="note">none</span>'}</td>
      <td class="acts">${c.balanceEGP > 0.005 ? `<button class="btn sm" data-new="payments" ${pre({ customer: c.name, amount: Math.round(c.balanceEGP), currency: 'EGP' })}>+ Payment</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">No customers yet. They appear here when you record a sale with a customer name.</td></tr>'}
  </tbody></table></div>`}
  <h3 style="margin-top:24px">Credit payments</h3>
  <div class="tablewrap"><table class="t"><thead><tr><th>Date</th><th>Customer</th><th>Pays for</th><th class="num">Amount</th><th>Collected by</th><th>How</th><th></th></tr></thead><tbody>
  ${pays.map(p => { const parts = B.orders.flatMap(o => o.payments.filter(x => x.id === p.id).map(x => `${fDate(o.h.date)}: ${fAmt(x.amt, o.cur)}`));
    return `<tr><td>${fDate(p.date)}</td><td><b>${esc(p.customer)}</b>${p.notes ? `<span class="sub">${esc(p.notes)}</span>` : ''}</td>
      <td>${parts.length ? parts.map(s => `<span class="pline note">Sale ${esc(s)}</span>`).join('') : '<span class="note">—</span>'}${B.unused[p.id] > 0.005 ? `<span class="sub out-amt">${fAmt(B.unused[p.id], p.currency)} not matched to any sale</span>` : ''}</td>
      <td class="num">${fAmt(p.amount, p.currency)}</td><td>${pill(p.receivedBy)}</td><td>${esc(p.method || '')}</td>${actions('payments', p.id)}</tr>`; }).join('') || '<tr><td colspan="7" class="empty">No credit payments yet.</td></tr>'}
  </tbody></table></div>`;
};
/* ---------- sales list: a short summary per sale; tapping it opens the full list of products ---------- */
function saleSummary(o, pn) {
  const units = o.lines.reduce((a, s) => a + num(s.qty), 0), prods = new Set(o.lines.map(s => s.purchaseId ? pn(s) : '')).size;
  const first = o.lines[0] ? pn(o.lines[0]) : '';
  const extras = [...new Set(o.costs.map(e => e.description || e.category).concat(o.extras.filter(s => !s.discount).map(s => s.product)))];
  if (!o.lines.length) return extras.length ? `<span class="sub">${extras.map(esc).join(', ')}</span>` : '—';
  return `<button type="button" class="slsum" data-salelines="${o.id}"><b>${prods === 1 ? `<span class="notr">${esc(first)}</span>` : `${prods} products`}</b>
    <span class="sub">${units} unit${units === 1 ? '' : 's'}${prods > 1 ? ` · ${esc(first)} and ${prods - 1} more` : ''}${extras.length ? ` · ${extras.length} extra${extras.length === 1 ? '' : 's'}` : ''}</span><span class="slview">View products</span></button>`;
}
function openSaleLines(id) {
  const o = salesOrders().find(x => x.id === id); if (!o) return;
  const R = calc(), h = o.h, sale = h.kind === 'sale', m = orderMoney(o, R), kinds = Object.fromEntries(OPT.kind);
  const pn = s => { const l = R.lots[s.purchaseId]; return l ? l.p : null; };
  const units = o.lines.reduce((a, s) => a + num(s.qty), 0);
  const rows = o.lines.map(s => { const p = pn(s), q = num(s.qty), u = num(s.unitPrice);
    return `<tr><td><b class="notr">${esc(p ? p.product : '(deleted product)')}</b><span class="sub">${p ? `${typeof storeTag === 'function' ? storeTag(p) : ''}<span class="notr">${esc(p.brand || '')}</span>${p.shipmentId ? ' · ' + esc(shipName(p.shipmentId)) : ''}` : ''}</span></td>
      <td class="num">${q}</td>${sale ? `<td class="num">${fAmt(u, s.currency)}${typeof wasPrice === 'function' ? wasPrice(num(s.listPrice), u, v => fAmt(v, s.currency)) : ''}</td><td class="num">${fAmt(q * u, s.currency)}</td>` : ''}</tr>`; }).join('');
  const extras = o.extras.filter(s => !s.discount), cur = (o.lines[0] || {}).currency || h.currency || 'EGP';
  const d = scanDlg('sldlg');
  d.innerHTML = `<div class="sdbody" tabindex="-1" autofocus><div class="eyebrow">${fDate(h.date)} · ${sale ? 'Sale' : esc(kinds[h.kind] || h.kind)}</div>
    <h2 class="notr">${esc(h.customer || (sale ? 'Customer' : kinds[h.kind] || ''))}</h2>
    <p class="lead">${new Set(o.lines.map(s => s.purchaseId)).size} product lines · ${units} unit${units === 1 ? '' : 's'}${h.place ? ' · <span class="notr">' + esc(h.place) + '</span>' : ''}</p>
    <div class="tablewrap sltable"><table class="t"><thead><tr><th>Product</th><th class="num">Qty</th>${sale ? '<th class="num">Price</th><th class="num">Total</th>' : ''}</tr></thead><tbody>${rows}</tbody>
    ${sale ? `<tfoot>${extras.map(s => `<tr><td colspan="3">${esc(s.product || s.category)}</td><td class="num">${fAmt(num(s.qty) * num(s.unitPrice), s.currency)}</td></tr>`).join('')}
      ${m.discount ? `<tr><td colspan="3">Discount</td><td class="num out-amt">− ${fEGP(m.discount)}</td></tr>` : ''}
      <tr class="sltot"><td colspan="3">Customer pays</td><td class="num">${fEGP(m.bill)}</td></tr></tfoot>` : ''}</table></div>
    ${o.costs.length ? `<p class="note">Extra costs: ${o.costs.map(e => `${esc(e.description || e.category)} ${fAmt(num(e.amount), e.currency)}`).join(' · ')}</p>` : ''}
    ${h.notes ? `<p class="note notr">${esc(h.notes)}</p>` : ''}
    <div class="mact sdact"><button type="button" class="btn ghost" data-sl="close">Close</button><button type="button" class="btn" data-sl="edit:${o.id}">Edit sale</button></div></div>`;
  if (!d.open) d.showModal();
}
document.addEventListener('click', e => {
  const s = e.target.closest('[data-salelines]'); if (s) { e.preventDefault(); return openSaleLines(s.dataset.salelines); }
  const b = e.target.closest('[data-sl]'); if (!b) return;
  const [a, id] = b.dataset.sl.split(':'); scanDlg('sldlg').close();
  if (a === 'edit') openOrder(id);
});
/* ---------- optional grid view for Sales and Customers (remembered on this device) ---------- */
const GRID_KEY = 'shanta_grid';
const gridPrefs = () => { try { return JSON.parse(localStorage.getItem(GRID_KEY) || '{}'); } catch (e) { return {}; } };
const isGrid = page => !!gridPrefs()[page];
const GRIDICON = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.2" fill="currentColor"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1.2" fill="currentColor"/><rect x="1.5" y="9" width="5.5" height="5.5" rx="1.2" fill="currentColor"/><rect x="9" y="9" width="5.5" height="5.5" rx="1.2" fill="currentColor"/></svg>';
const LISTICON = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><rect x="1.5" y="2" width="13" height="2.6" rx="1" fill="currentColor"/><rect x="1.5" y="6.7" width="13" height="2.6" rx="1" fill="currentColor"/><rect x="1.5" y="11.4" width="13" height="2.6" rx="1" fill="currentColor"/></svg>';
const viewToggle = page => { const g = isGrid(page);
  return `<span class="vtog" role="group" aria-label="View"><button type="button" class="${g ? '' : 'on'}" data-vtog="${page}:list" title="List view" aria-pressed="${!g}">${LISTICON}</button><button type="button" class="${g ? 'on' : ''}" data-vtog="${page}:grid" title="Grid view" aria-pressed="${g}">${GRIDICON}</button></span>`; };
document.addEventListener('click', e => {
  const b = e.target.closest('[data-vtog]'); if (!b) return;
  const [page, mode] = b.dataset.vtog.split(':'), p = gridPrefs(); p[page] = mode === 'grid';
  try { localStorage.setItem(GRID_KEY, JSON.stringify(p)); } catch (x) { }
  render();
});
function saleCard(o, R, pn, kinds) {
  const h = o.h, m = orderMoney(o, R), sale = h.kind === 'sale', units = o.lines.reduce((a, s) => a + num(s.qty), 0);
  const prods = new Set(o.lines.map(s => s.purchaseId)).size, b = R.book.byId[o.id];
  /* card status: one capsule in the top row; for open sales, how much is paid (with a bar) and when it's due
     go in their own row, and "+ Payment" in the footer */
  const open = sale && b && b.balance > 0.005;
  const cap = !sale ? `<span class="pill">${esc(kinds[h.kind])}</span>` : open ? `<span class="pill ${b.overdue ? 'bad' : 'warn'}">Owes ${fAmt(b.balance, b.cur)}</span>` : '<span class="pill ok">Paid</span>';
  const pct = open && b.bill > 0 ? Math.max(0, Math.min(100, Math.round(b.collected / b.bill * 100))) : 0;
  const payRow = open ? `<div class="gpay"><div class="gbar"><i style="width:${pct}%"></i></div>
      <span class="sub">${fAmt(b.collected, b.cur)} of ${fAmt(b.bill, b.cur)} paid${h.dueDate ? ` · <span class="${b.overdue ? 'out-amt' : ''}">${b.overdue ? 'Overdue since' : 'Due'} ${fDate(h.dueDate)}</span>` : ''}</span></div>` : '';
  return `<div class="gcard${sale ? '' : ' muted'}${open && b.overdue ? ' late' : ''}">
    <div class="gtop"><span class="gdate">${fDate(h.date)}</span>${cap}</div>
    <b class="gname">${esc(h.customer || (sale ? 'Customer' : kinds[h.kind]))}</b>${unsentTag('sales', o.id)}
    <span class="sub">${esc(h.place || '')}${h.method && sale ? (h.place ? ' · ' : '') + esc(h.method) : ''}</span>
    ${o.lines.length ? `<button type="button" class="gprod" data-salelines="${o.id}">${prods === 1 ? `<span class="notr">${esc(pn(o.lines[0]))}</span>` : `${prods} products`} · ${units} unit${units === 1 ? '' : 's'}</button>` : ''}
    <div class="gnums">${sale ? `<div><small>Customer pays</small><b>${fEGP(m.bill)}</b>${m.discount ? `<span class="sub">after ${fEGP(m.discount)} discount</span>` : ''}</div>` : ''}
      <div><small>Profit${sale ? markupTag(m) : ''}</small><b class="${m.profit >= 0 ? 'in-amt' : 'out-amt'}">${fEGP(m.profit)}</b>${sale ? costNote(m) : ''}</div></div>
    ${payRow}
    <div class="gfoot">${sale ? pill(h.receivedBy) : '<span></span>'}<span class="gacts">${open ? `<button class="btn sm terra" data-act="paid:${o.id}">+ Payment</button>` : ''}<button class="ib" data-edit="sales:${o.id}" title="Edit">${PENCIL}</button><button class="ib del" data-del="sales:${o.id}" title="Delete">${TRASH}</button></span></div></div>`;
}
function custCard(c, t) {
  const open = c.orders.filter(o => o.balance > 0.005), owes = c.balanceEGP > 0.005;
  return `<div class="gcard${c.overdue ? ' late' : ''}">
    <div class="gtop"><b class="gname notr">${esc(c.name)}</b>${owes ? (c.nextDue ? `<span class="pill ${c.nextDue < t ? 'bad' : 'warn'}">Due ${fDate(c.nextDue)}</span>` : '') : '<span class="pill ok">Paid up</span>'}</div>
    <div class="gnums"><div><small>Bought</small><b>${fEGP(c.billEGP)}</b></div><div><small>Still owes</small><b class="${c.overdue ? 'out-amt' : ''}">${owes ? fEGP(c.balanceEGP) : '—'}</b>${c.overdue ? `<span class="sub out-amt">${fEGP(c.overdue)} overdue</span>` : ''}</div></div>
    ${open.length ? `<ul class="gopen">${open.map(o => `<li><span>${fDate(o.h.date)} · ${fAmt(o.balance, o.cur)}</span><button class="ib" data-edit="sales:${o.id}" title="Open sale">${PENCIL}</button></li>`).join('')}</ul>` : `<span class="sub">${c.orders.length} sale${c.orders.length === 1 ? '' : 's'} · nothing open</span>`}
    ${owes ? `<div class="gfoot"><span></span><button class="btn sm" data-new="payments" ${pre({ customer: c.name, amount: Math.round(c.balanceEGP), currency: 'EGP' })}>+ Payment</button></div>` : ''}</div>`;
}

/* ---------- product picker in the sale form ----------
   Instead of a dropdown with every product: type a few letters of the name, brand or barcode, narrow by box,
   store or category, sort, and tap to add (tap again for one more). It stays open, so a 22-product sale is
   typed and tapped without leaving the keyboard; Enter adds the first match */
const OPK = { open: false, q: '', box: '', store: '', cat: '', sort: 'name', line: -1 };
const pkNorm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
function pickerLots(R) {
  const avail = id => { const l = R.lots[id]; return l ? l.left + (OR.orig[id] || 0) : 0; };
  const inSale = id => OR.lines.reduce((a, x) => a + (x.purchaseId === id ? num(x.qty) : 0), 0);
  const words = pkNorm(OPK.q).split(/\s+/).filter(Boolean);
  let list = Object.values(R.lots).filter(l => avail(l.p.id) - inSale(l.p.id) > 0 || inSale(l.p.id) > 0);
  if (OPK.box) list = list.filter(l => (l.p.shipmentId || 'none') === OPK.box);
  if (OPK.store) list = list.filter(l => storeOf(l.p) === OPK.store);
  if (OPK.cat) list = list.filter(l => (l.p.category || 'Other') === OPK.cat);
  if (words.length) list = list.filter(l => { const h = pkNorm([l.p.product, l.p.brand, l.p.ean, l.p.category].join(' ')); return words.every(w => h.includes(w)); });
  const by = { name: (a, b) => a.p.product.localeCompare(b.p.product), brand: (a, b) => String(a.p.brand || '').localeCompare(String(b.p.brand || '')) || a.p.product.localeCompare(b.p.product),
    stock: (a, b) => avail(b.p.id) - avail(a.p.id), newest: (a, b) => String(b.p.date || '').localeCompare(String(a.p.date || '')), price: (a, b) => suggestEGP(a) - suggestEGP(b) };
  /* name matches first when searching */
  const starts = l => words.length && pkNorm(l.p.product).startsWith(words[0]) ? 0 : 1;
  return list.sort((a, b) => starts(a) - starts(b) || (by[OPK.sort] || by.name)(a, b)).map(l => ({ l, left: avail(l.p.id) - inSale(l.p.id), inSale: inSale(l.p.id) }));
}
function pickerHTML(R) {
  if (!OPK.open) return '';
  const all = Object.values(R.lots), opt = (v, t, s) => `<option value="${esc(v)}"${v === s ? ' selected' : ''}>${esc(t)}</option>`;
  const boxes = db.shipments.slice().sort(byDate).filter(s => all.some(l => l.p.shipmentId === s.id && l.left > 0));
  const stores = [...new Set(all.filter(l => l.left > 0).map(l => storeOf(l.p)))].sort();
  const cats = [...new Set(all.filter(l => l.left > 0).map(l => l.p.category || 'Other'))].sort();
  return `<div class="picker" id="o_picker">
    <div class="pkbar"><span class="srch"><input type="search" id="pk_q" placeholder="${OPK.line >= 0 ? 'Search the product for this line…' : 'Search name, brand or barcode…'}" value="${esc(OPK.q)}" autocomplete="off" enterkeyhint="done"><button type="button" class="srchx" data-o="pk-clear" aria-label="Clear search" title="Clear search"${OPK.q ? '' : ' hidden'}>×</button></span>
      <button type="button" class="btn sm" data-o="pk-close">Done</button></div>
    <div class="pkf">
      <select data-pk="box">${opt('', 'All boxes', OPK.box)}${boxes.map(s => opt(s.id, s.name, OPK.box)).join('')}</select>
      <select data-pk="store">${opt('', 'All stores', OPK.store)}${stores.map(s => opt(s, s, OPK.store)).join('')}</select>
      <select data-pk="cat">${opt('', 'All categories', OPK.cat)}${cats.map(c => opt(c, c, OPK.cat)).join('')}</select>
      <select data-pk="sort">${[['name', 'Sort: name'], ['brand', 'Sort: brand'], ['stock', 'Sort: most in stock'], ['newest', 'Sort: newest'], ['price', 'Sort: price']].map(([v, t]) => opt(v, t, OPK.sort)).join('')}</select>
    </div>
    <div id="pk_list">${pickerList(R)}</div>
    <p class="pkhint">Tap a product to add one; tap again for one more. Enter adds the first match.</p></div>`;
}
function pickerList(R) {
  const rows = pickerLots(R), show = rows.slice(0, 60);
  if (!rows.length) return `<p class="note pkempty">No product in stock matches${OPK.q ? ` “${esc(OPK.q)}”` : ''}.</p>`;
  return `<ul class="pklist">${show.map(({ l, left, inSale }, i) => `<li><button type="button" class="pkrow${i === 0 && OPK.q ? ' first' : ''}" data-o="pk-add:${esc(l.p.id)}"${left <= 0 && OPK.line < 0 ? ' disabled' : ''}>
      <span class="pkn"><b>${esc(l.p.product)}</b><span class="sub">${esc(l.p.brand || '')}${l.p.brand ? ' · ' : ''}${esc(shipName(l.p.shipmentId) || 'not in a box')}</span></span>
      <span class="pkm"><span class="pkleft">${left} left</span><span class="sub">${fEGP(suggestEGP(l))}</span></span>
      ${inSale ? `<span class="pill ok pkin">×${inSale}</span>` : '<span class="pkplus" aria-hidden="true">+</span>'}</button></li>`).join('')}</ul>
    ${rows.length > show.length ? `<p class="note">${rows.length - show.length} more: type more of the name to narrow it down.</p>` : ''}`;
}
/* tap a product: one more unit of it (a new line the first time, at the suggested price) */
function pickerAdd(id) {
  const R = calc(), l = R.lots[id]; if (!l) return;
  const price = OR.h.kind === 'sale' && OR.h.currency === 'EGP' ? suggestEGP(l) : '';
  if (OPK.line >= 0 && OR.lines[OPK.line]) {
    const x = OR.lines[OPK.line]; x.purchaseId = id; if (x.unitPrice === '' || x.unitPrice == null) x.unitPrice = price;
    OPK.line = -1; OPK.open = false; OPK.q = ''; return;
  }
  const ex = OR.lines.find(x => x.purchaseId === id);
  if (ex) ex.qty = num(ex.qty) + 1;
  else { const empty = OR.lines.find(x => !x.purchaseId); if (empty) Object.assign(empty, { purchaseId: id, qty: 1, unitPrice: empty.unitPrice === '' ? price : empty.unitPrice }); else OR.lines.push({ purchaseId: id, qty: 1, unitPrice: price }); }
  OPK.q = '';
}
function redrawPicker(keepFocus) {
  const R = calc(), box = $('#pk_list'); if (box) box.innerHTML = pickerList(R);
  if (keepFocus) { const q = $('#pk_q'); if (q) { q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch (e) { } } }
}
document.addEventListener('input', e => { if (e.target.id !== 'pk_q') return; OPK.q = e.target.value; const x = e.target.parentNode.querySelector('.srchx'); if (x) x.hidden = !OPK.q; redrawPicker(false); });
document.addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.pk; if (!k) return; e.stopPropagation(); OPK[k] = e.target.value; redrawPicker(true); }, true);
document.addEventListener('keydown', e => {
  if (e.target.id !== 'pk_q') return;
  if (e.key === 'Enter') { e.preventDefault(); const f = $('#pk_list .pkrow:not([disabled])'); if (f) f.click(); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); OPK.open = false; OPK.line = -1; drawOrder(); }
});
