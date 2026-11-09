/* ---------- shop orders: what customers sent from the online shop ----------
   Orders and requests live in Firestore (orders/<id>, customers/<uid>), outside the ledger. Shanta listens
   to them live while you are signed in. "Confirm → sale" opens the normal sale form filled in from the order;
   once it is saved the order is marked confirmed and points to that sale, so stock and money follow the
   ledger as usual. Down payments and credit stay on the order until then.
   Statuses: new → confirmed → out → delivered; requested → offered → new (customer confirms);
   declined (by you) / cancelled (by the customer). */
const ShopOrd = { orders: [], customers: {}, loaded: false, started: false, err: '', tab: 'new', lastN: -1 };
const ORD_ST = { new: ['New', 'warn'], confirmed: ['Confirmed', 'ok'], out: ['Out for delivery', 'ok'], delivered: ['Delivered', 'ok'],
  requested: ['Requested', ''], offered: ['Offered, waiting for customer', 'warn'], declined: ['Declined', 'bad'], cancelled: ['Cancelled by customer', 'bad'] };
const ORD_TABS = [['new', 'New'], ['active', 'In progress'], ['requests', 'Requests'], ['closed', 'Closed'], ['customers', 'Customers']];
const ordIn = { new: ['new'], active: ['confirmed', 'out'], requests: ['requested', 'offered'], closed: ['delivered', 'declined', 'cancelled'] };
const ordTime = o => o.createdAt || '';
const agoTxt = iso => { const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
/* a down payment marked received, or one the customer sent a screenshot for, is owed back if the order ends */
const refundable = o => (o.downPaid || o.proof) ? num(o.down) : 0;
const paidDown = o => o.downPaid ? num(o.down) : 0;
const custOf = o => ShopOrd.customers[o.uid] || {};
/* the down payment the shop asks for now, for this customer and kind of order */
function ordExpPct(o) {
  const c = custOf(o), s = db.settings;
  if (c.downPct !== undefined && c.downPct !== null && c.downPct !== '') return num(c.downPct);
  return num(o.kind === 'request' ? s.shopReqDown : o.method === 'cod' ? s.shopDownCod : (s.shopDownInsta ?? 100));
}
const ordNeeds = o => o.status === 'new' || (o.proof && !o.downPaid && ['new', 'requested', 'offered'].includes(o.status))
  || (['declined', 'cancelled'].includes(o.status) && refundable(o) > 0 && !o.refundDone && !!o.refund);
const custNeeds = c => c.creditRefundAt && (!c.creditRefundDoneAt || c.creditRefundDoneAt < c.creditRefundAt) && num(c.credit) > 0;
/* units held by orders not yet turned into a sale (read by the shop catalog) */
function shopHeld() {
  const h = {};
  ShopOrd.orders.filter(o => o.status === 'new' || o.status === 'offered').forEach(o => (o.lines || []).forEach(l => h[l.id] = (h[l.id] || 0) + num(l.qty)));
  return h;
}

Object.assign(ShopOrd, {
  pending() { return this.orders.filter(ordNeeds).length + Object.values(this.customers).filter(custNeeds).length; },
  async start() {
    if (this.started || !Cloud.on() || Cloud.isBackup() || !Cloud.ready) return;
    this.started = true;
    try { await fb(); } catch (e) { this.started = false; return; }
    const S = F.S, fail = e => { console.warn(e); this.err = e && e.code === 'permission-denied' ? shopRulesMsg : fsMsg(e); this.loaded = true; this.changed(); };
    S.onSnapshot(S.collection(F.fs, 'orders'), snap => {
      const first = !this.loaded;
      if (!first) snap.docChanges().forEach(ch => { const o = ch.doc.data();
        if (ch.type === 'added' && (o.status === 'new' || o.status === 'requested')) toast(`🛍 New shop ${o.status === 'new' ? 'order' : 'request'} from ${o.name || o.phone}`);
        if (ch.type === 'modified' && o.proof && !o.downPaid && ch.doc.metadata && !ch.doc.metadata.hasPendingWrites) { const old = this.orders.find(x => x.id === ch.doc.id); if (old && !old.proof) toast(`🧾 InstaPay proof from ${o.name || o.phone}`); }
      });
      this.orders = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      this.loaded = true; this.err = ''; this.changed();
    }, fail);
    S.onSnapshot(S.collection(F.fs, 'customers'), snap => {
      this.customers = {}; snap.forEach(d => this.customers[d.id] = Object.assign({ id: d.id }, d.data())); this.changed();
    }, fail);
  },
  changed() {
    const n = this.pending();
    if (view === 'orders' || n !== this.lastN) { this.lastN = n; if (!$('dialog[open]') || view !== 'orders') render(); else this.dirty = true; }
    if (typeof ShopPub !== 'undefined') ShopPub.auto();
  },
  async upd(o, data, msg) {
    try {
      await fb(); await within(F.S.updateDoc(F.S.doc(F.fs, 'orders', o.id), Object.assign({ updatedAt: new Date().toISOString() }, data)), 20000, offlineMsg);
      if (msg) toast(msg);
    } catch (e) { toast('⚠ ' + ((e && e.message) || fsMsg(e))); }
  },
  async credit(uidc, amount, why, extra) {
    const S = F.S;
    await within(S.setDoc(S.doc(F.fs, 'customers', uidc), Object.assign({ credit: S.increment(amount), creditLog: S.arrayUnion({ at: new Date().toISOString(), amount, why }) }, extra || {}), { merge: true }), 20000, offlineMsg);
  }
});
/* repaint once a dialog closes, if orders changed while it was open */
document.addEventListener('close', () => { if (ShopOrd.dirty && view === 'orders') { ShopOrd.dirty = false; render(); } }, true);
Cloud.whenReady(60000).then(() => ShopOrd.start());

/* ---------- Confirm → sale ---------- */
const egLots = it => it.lots.filter(l => l.left > 0 && (db.shipments.find(s => s.id === l.p.shipmentId) || {}).status === 'Delivered');
function ordConfirm(o) {
  const items = {}; shopItems().forEach(x => items[x.id] = x);
  const lines = [], short = [];
  (o.lines || []).forEach(ln => {
    const it = items[ln.id]; let rest = num(ln.qty);
    if (it) egLots(it).forEach(l => { if (rest <= 0) return; const q = Math.min(rest, l.left); rest -= q; lines.push({ purchaseId: l.p.id, qty: q, unitPrice: num(ln.price) }); });
    if (rest > 0) short.push(`${ln.name}: ${rest} missing`);
  });
  if (!lines.length) return toast('⚠ None of these products are in Egypt any more.');
  if (short.length && !confirm(`Not everything is in Egypt:\n\n${short.join('\n')}\n\nMake the sale with what is there? Tell the customer about the rest.`)) return;
  const bill = lines.reduce((a, x) => a + x.qty * x.unitPrice, 0) + num(o.delivery);
  const paid = Math.min(bill, num(o.creditUsed) + paidDown(o));
  const payMode = paid >= bill - 0.005 ? 'full' : paid > 0 ? 'down' : 'credit';
  openOrder(null, {
    lines,
    notes: `Shop order #${o.code} · ${o.phone}${o.address ? ' · ' + o.address : ''}${num(o.creditUsed) ? ` · ${fEGP(num(o.creditUsed))} paid from shop credit` : ''}`,
    h: { customer: o.name || o.phone, method: o.method === 'instapay' ? 'InstaPay' : 'Cash', payMode, paid: payMode === 'full', downPayment: payMode === 'down' ? paid : '', receivedBy: 'friend' },
    extras: num(o.delivery) > 0 ? [{ category: 'Delivery to customer', description: 'Delivery', charge: num(o.delivery), cost: '', paidBy: 'friend' }] : [],
    onSave: async oid => {
      await ShopOrd.upd(o, { status: 'confirmed', saleId: oid, confirmedAt: new Date().toISOString() }, `Order #${o.code} confirmed`);
      if (num(o.creditUsed) > 0) try { await ShopOrd.credit(o.uid, -num(o.creditUsed), `Used on order #${o.code}`); } catch (e) { toast('⚠ Couldn’t take the credit off: ' + ((e && e.message) || fsMsg(e))); }
    }
  });
}

/* ---------- WhatsApp to the customer ---------- */
function ordWa(o) {
  const ar = o.lang === 'ar', n = o.name || '', c = '#' + o.code, shop = db.settings.shopName || 'Shanta';
  const T = ar ? {
    new: `أهلًا ${n}، استلمنا طلبك ${c} من ${shop}. سنؤكده قريبًا.`, confirmed: `أهلًا ${n}، تم تأكيد طلبك ${c} ونجهّزه الآن.`,
    out: `أهلًا ${n}، طلبك ${c} في الطريق إليك.`, delivered: `شكرًا ${n}! نتمنى أن تعجبك المنتجات.`,
    requested: `أهلًا ${n}، استلمنا طلبك ${c}. سنخبرك عندما يصل المنتج.`, offered: `أهلًا ${n}، المنتج الذي طلبته (${c}) وصل! أكّد الطلب من «طلباتي» في المتجر خلال 24 ساعة.`,
    declined: `أهلًا ${n}، للأسف لا نستطيع تنفيذ طلبك ${c}.${o.declineMsg ? ' ' + o.declineMsg : ''}`, cancelled: `أهلًا ${n}، تم إلغاء طلبك ${c}.`
  } : {
    new: `Hi ${n}, we got your order ${c} from ${shop}. We’ll confirm it soon.`, confirmed: `Hi ${n}, your order ${c} is confirmed and being prepared.`,
    out: `Hi ${n}, your order ${c} is on its way.`, delivered: `Thank you ${n}! Enjoy your products.`,
    requested: `Hi ${n}, we got your request ${c}. We’ll tell you when it arrives.`, offered: `Hi ${n}, what you requested (${c}) is here! Please confirm it under “My orders” in the shop within 24 hours.`,
    declined: `Hi ${n}, sorry, we can’t fill your order ${c}.${o.declineMsg ? ' ' + o.declineMsg : ''}`, cancelled: `Hi ${n}, your order ${c} was cancelled.`
  };
  return `https://wa.me/${waNumber(o.phone)}?text=${encodeURIComponent(T[o.status] || '')}`;
}

/* ---------- the page ---------- */
function ordCard(o, R) {
  const st = ORD_ST[o.status] || [o.status, ''], c = custOf(o), exp = ordExpPct(o);
  if (ordCard.R !== R) { ordCard.R = R; ordCard.items = {}; shopItems(R).forEach(x => ordCard.items[x.id] = x); }
  const items = ordCard.items;
  const line = l => { const it = items[l.id], eg = it ? egLots(it).reduce((a, x) => a + x.left, 0) : null;
    const warn = o.status === 'new' && eg !== null && eg < num(l.qty) ? ` <span class="pill bad">only ${eg} in Egypt</span>` : o.status === 'requested' && eg ? ` <span class="pill ok">${eg} in Egypt now</span>` : '';
    return `<li><span><b class="notr">${num(l.qty)} × ${esc(l.name)}</b>${warn}<span class="sub notr">${esc(l.brand || '')}</span></span><span>${fEGP(num(l.qty) * num(l.price))}</span></li>`; };
  const due = num(o.down), act = [];
  const b = (a, l, cls) => act.push(`<button type="button" class="btn sm ${cls || 'ghost'}" data-ord="${a}:${o.id}">${l}</button>`);
  if (o.status === 'new') { b('confirm', 'Confirm → sale', ' '); b('decline', 'Decline'); }
  if (o.status === 'confirmed') { b('out', 'Out for delivery', ' '); b('delivered', 'Delivered'); }
  if (o.status === 'out') b('delivered', 'Delivered', ' ');
  if (['confirmed', 'out', 'delivered'].includes(o.status) && o.saleId) { b('sale', 'Open sale'); if ((R.book.byId[o.saleId] || {}).balance > 0.005) b('collect', 'Record payment'); }
  if (o.status === 'requested') { b('offer', 'Offer: it’s here', ' '); b('decline', 'Decline'); }
  if (o.status === 'offered') b('withdraw', 'Withdraw offer');
  if (due > 0 && ['new', 'requested', 'offered'].includes(o.status)) b('down', o.downPaid ? 'Down payment not received' : 'Down payment received', o.proof && !o.downPaid ? ' ' : 'ghost');
  let refund = '';
  if (['declined', 'cancelled'].includes(o.status) && refundable(o) > 0) {
    refund = o.refundDone ? `<p class="note">✓ ${o.refund === 'credit' ? 'Added to the customer’s credit' : 'Refund sent'}: ${fEGP(refundable(o))}</p>`
      : `<p class="note"><b>${fEGP(refundable(o))} down payment to return.</b> ${o.downPaid ? '' : 'The customer sent a screenshot you hadn’t marked received; check your InstaPay first. '}${o.refund === 'refund' ? `The customer wants a refund to <span class="mono notr" dir="ltr">${esc(o.refundTo || '')}</span>.` : o.refund === 'credit' ? 'The customer wants it as credit.' : 'Waiting for the customer to choose refund or credit.'}</p>`;
    if (!o.refundDone) { b('refunded', 'Refund sent', o.refund === 'refund' ? ' ' : 'ghost'); b('tocredit', 'Add as credit', o.refund === 'credit' ? ' ' : 'ghost'); }
  }
  act.push(`<a class="btn sm ghost" href="${esc(ordWa(o))}" target="_blank" rel="noopener">WhatsApp</a>`);
  return `<div class="card sord${ordNeeds(o) ? ' needs' : ''}">
    <div class="sohead"><div><b class="notr">${esc(o.name || 'Customer')}</b> <span class="mono">#${esc(o.code || '')}</span><span class="sub">${esc(fDateTime(ordTime(o)))} · ${agoTxt(ordTime(o))}</span></div>
      <div class="sopills"><span class="pill ${st[1]}">${st[0]}</span><span class="pill">${o.method === 'instapay' ? 'InstaPay' : 'Cash on delivery'}</span>${o.kind === 'request' ? '<span class="pill warn">Request</span>' : ''}</div></div>
    <p class="note"><a href="tel:${esc(o.phone)}" class="mono notr" dir="ltr">${esc(o.phone)}</a>${o.verified === false ? ' <span class="pill warn" title="Signed in with Google; the number was typed in, not checked by SMS">number not checked</span>' : ''}${o.address ? ` · <span class="notr">${esc(o.address)}</span>` : ''}${o.note ? `<br>“<span class="notr">${esc(o.note)}</span>”` : ''}${num(c.credit) > 0 ? `<br>Credit balance: ${fEGP(num(c.credit))}` : ''}</p>
    <ul class="mini">${(o.lines || []).map(line).join('')}
      ${num(o.delivery) ? `<li><span>Delivery</span><span>${fEGP(num(o.delivery))}</span></li>` : ''}
      ${num(o.creditUsed) ? `<li><span>Paid from credit</span><span>−${fEGP(num(o.creditUsed))}</span></li>` : ''}
      <li><span><b>Total to pay</b></span><b>${fEGP(num(o.total))}</b></li>
      ${due > 0 ? `<li><span>Down payment ${num(o.downPct)}%${num(o.downPct) < exp ? ` <span class="pill warn">shop asks ${exp}% now</span>` : ''}</span><span>${o.downPaid ? '<span class="pill ok">received</span> ' : o.proof ? '<span class="pill warn">proof sent</span> ' : '<span class="pill bad">not paid</span> '}${fEGP(due)}</span></li>` : ''}</ul>
    ${o.proof ? `<button type="button" class="proofbtn" data-ord="proof:${o.id}"><img src="${esc(o.proof)}" alt="InstaPay proof"><span>InstaPay proof · tap to enlarge</span></button>` : ''}
    ${o.declineMsg && o.status === 'declined' ? `<p class="note">Your message: “<span class="notr">${esc(o.declineMsg)}</span>”</p>` : ''}
    ${o.status === 'offered' && o.offeredAt ? `<p class="note">Offered ${agoTxt(o.offeredAt)}. The units are held for the customer; withdraw the offer if they don’t answer within 24 hours.</p>` : ''}
    ${refund}<div class="soact">${act.join('')}</div></div>`;
}
function custRow(c) {
  const log = (c.creditLog || []).slice().sort((a, b) => (b.at || '').localeCompare(a.at || '')).slice(0, 4);
  const n = ShopOrd.orders.filter(o => o.uid === c.id).length, dp = c.downPct === undefined || c.downPct === null || c.downPct === '' ? '' : String(num(c.downPct));
  return `<li class="scust"><span><b class="notr">${esc(c.name || '—')}</b><span class="sub"><span class="mono notr" dir="ltr">${esc(c.phone || '')}</span>${c.verified === false ? ' (not checked)' : ''}${c.email ? ` · <span class="notr">${esc(c.email)}</span>` : ''} · ${n} order${n === 1 ? '' : 's'}</span>
      ${custNeeds(c) ? `<span class="note"><b>Asked for the credit as a refund</b> to <span class="mono notr" dir="ltr">${esc(c.creditRefundTo || '')}</span></span>` : ''}
      ${log.length ? `<span class="sub">${log.map(x => `${esc(fDate((x.at || '').slice(0, 10)))}: ${x.amount > 0 ? '+' : ''}${fEGP(x.amount)} <span class="notr">${esc(x.why || '')}</span>`).join('<br>')}</span>` : ''}</span>
    <span class="scact"><span class="sub">Credit</span><b>${fEGP(num(c.credit))}</b>
      <select data-custdown="${esc(c.id)}" aria-label="Down payment"><option value=""${dp === '' ? ' selected' : ''}>Shop default</option>${[0, 20, 30, 50, 100].map(p => `<option value="${p}"${dp === String(p) ? ' selected' : ''}>${p}% down payment</option>`).join('')}</select>
      <span><button type="button" class="btn sm ghost" data-ord="adjust:${esc(c.id)}">Adjust credit</button>${custNeeds(c) ? `<button type="button" class="btn sm" data-ord="creditpaid:${esc(c.id)}">Refund sent</button>` : ''}</span></span></li>`;
}
V.orders = R => {
  if (!Cloud.on() || Cloud.isBackup()) return `<div class="card"><h3>Shop orders</h3><p class="note">Sign in to the shared online ledger (Settings) to see orders from the online shop.</p></div>`;
  ShopOrd.start();
  if (!ShopOrd.loaded) return `<div class="card"><p class="note">Loading shop orders…</p></div>`;
  const cnt = k => k === 'customers' ? Object.values(ShopOrd.customers).filter(custNeeds).length : ShopOrd.orders.filter(o => ordIn[k].includes(o.status) && (k === 'closed' ? ordNeeds(o) : k === 'requests' ? ordNeeds(o) : true)).length;
  const tabs = `<div class="segtabs otabs">${ORD_TABS.map(([k, l]) => { const n = cnt(k); return `<button type="button" data-otab="${k}" class="${ShopOrd.tab === k ? 'on' : ''}">${l}${n ? ` <span class="ocnt">${n}</span>` : ''}</button>`; }).join('')}</div>`;
  const err = ShopOrd.err ? `<div class="err">${esc(ShopOrd.err)}</div>` : '';
  if (ShopOrd.tab === 'customers') {
    const cs = Object.values(ShopOrd.customers).sort((a, b) => custNeeds(b) - custNeeds(a) || num(b.credit) - num(a.credit) || String(a.name || '').localeCompare(String(b.name || '')));
    return tabs + err + `<div class="card"><h3>Shop customers</h3><p class="note">Everyone who signed in to the shop with their phone. Set a down payment for one customer (0% for people you trust, 100% after a refused delivery); it overrides the shop’s settings. Credit is money you hold for them; it comes off their next order automatically.</p>
      <ul class="mini scusts">${cs.map(custRow).join('') || '<li class="note">No customers yet.</li>'}</ul></div>`;
  }
  const list = ShopOrd.orders.filter(o => ordIn[ShopOrd.tab].includes(o.status))
    .sort((a, b) => ordNeeds(b) - ordNeeds(a) || (ShopOrd.tab === 'new' ? ordTime(a).localeCompare(ordTime(b)) : ordTime(b).localeCompare(ordTime(a))));
  const empty = { new: 'No new orders.', active: 'Nothing being prepared or delivered.', requests: 'No open requests.', closed: 'No closed orders yet.' }[ShopOrd.tab];
  if (ShopOrd.tab === 'requests' && list.length) {
    /* grouped by product: the shopping list for the next dm order */
    const g = {}; list.forEach(o => (o.lines || []).forEach(l => { const x = g[l.id] = g[l.id] || { name: l.name, brand: l.brand, units: 0, people: new Set(), down: 0 }; x.units += num(l.qty); x.people.add(o.uid); }));
    list.forEach(o => { const l = (o.lines || [])[0]; if (l && g[l.id]) g[l.id].down += paidDown(o); });
    const rows = Object.values(g).sort((a, b) => b.units - a.units);
    return tabs + err + `<div class="card"><h3>Wanted products</h3><p class="note">Your shopping list for the next dm order: what customers asked for and are waiting on.</p>
      <ul class="mini">${rows.map(x => `<li><span><b class="notr">${esc(x.name)}</b><span class="sub"><span class="notr">${esc(x.brand || '')}</span> · ${x.people.size} customer${x.people.size === 1 ? '' : 's'}${x.down ? ` · ${fEGP(x.down)} down payments received` : ''}</span></span><b>${x.units} wanted</b></li>`).join('')}</ul></div>
      <div class="sords">${list.map(o => ordCard(o, R)).join('')}</div>`;
  }
  return tabs + err + (list.length ? `<div class="sords">${(ShopOrd.tab === 'closed' ? list.slice(0, 60) : list).map(o => ordCard(o, R)).join('')}</div>` : `<div class="card"><p class="note">${empty}</p></div>`);
};
/* the Orders page sits after Sales; its count is what needs you */
NAV.splice(NAV.findIndex(x => x[0] === 'sales') + 1, 0, ['orders', '✆', 'Orders', 'From the online shop']);
{ const c0 = counts; counts = () => Object.assign(c0(), { orders: ShopOrd.pending() }); }

function ordProof(o) {
  let d = $('#proofdlg'); if (!d) { d = document.createElement('dialog'); d.id = 'proofdlg'; document.body.appendChild(d); }
  d.innerHTML = `<div class="sdbody"><div class="eyebrow">InstaPay proof · #${esc(o.code)}</div><img class="proofbig" src="${esc(o.proof)}" alt="">
    <p class="note">Amount asked: <b>${fEGP(num(o.down))}</b>. Check it arrived in your InstaPay before marking it received.</p>
    <div class="mact"><button type="button" class="btn ghost" data-proofclose="">Close</button>${!o.downPaid ? `<button type="button" class="btn" data-ord="down:${o.id}" data-proofclose="">Down payment received</button>` : ''}</div></div>`;
  d.showModal();
}
document.addEventListener('click', e => {
  const tb = e.target.closest('[data-otab]'); if (tb) { ShopOrd.tab = tb.dataset.otab; return render(); }
  if (e.target.closest('[data-proofclose]')) $('#proofdlg').close();
  const t = e.target.closest('[data-ord]'); if (!t) return;
  const [a, id] = t.dataset.ord.split(':'), o = ShopOrd.orders.find(x => x.id === id), now = new Date().toISOString();
  if (a === 'adjust' || a === 'creditpaid') {
    const c = ShopOrd.customers[id]; if (!c) return;
    if (a === 'creditpaid') {
      if (!confirm(`Mark ${fEGP(num(c.credit))} as refunded to ${c.creditRefundTo}? Their credit goes to 0.`)) return;
      return ShopOrd.credit(id, -num(c.credit), 'Refunded to InstaPay', { creditRefundDoneAt: now }).then(() => toast('Credit refunded')).catch(x => toast('⚠ ' + fsMsg(x)));
    }
    const v = prompt(`Change ${c.name || 'this customer'}’s credit by how much? (EGP; use a minus sign to take credit off)`, ''); if (v === null || !num(v)) return;
    const why = prompt('Why? (shown to the customer)', num(v) > 0 ? 'Added by the shop' : 'Taken off by the shop'); if (why === null) return;
    return ShopOrd.credit(id, num(v), why).then(() => toast('Credit updated')).catch(x => toast('⚠ ' + fsMsg(x)));
  }
  if (!o) return;
  if (a === 'confirm') return ordConfirm(o);
  if (a === 'proof') return ordProof(o);
  if (a === 'sale') { go('sales'); return openOrder(o.saleId); }
  if (a === 'collect') return markPaid(o.saleId);
  if (a === 'decline') { const m = prompt('Decline this ' + (o.status === 'requested' ? 'request' : 'order') + '. Message to the customer (optional):', ''); if (m === null) return; return ShopOrd.upd(o, { status: 'declined', declineMsg: m.trim(), declinedAt: now }, 'Declined'); }
  if (a === 'out') return ShopOrd.upd(o, { status: 'out', outAt: now }, 'Out for delivery');
  if (a === 'delivered') { ShopOrd.upd(o, { status: 'delivered', deliveredAt: now }, 'Delivered');
    if (o.saleId && (calc().book.byId[o.saleId] || {}).balance > 0.005 && confirm('Delivered. Record the money collected now?')) markPaid(o.saleId); return; }
  if (a === 'offer') return ShopOrd.upd(o, { status: 'offered', offeredAt: now }, 'Offered; send them a WhatsApp');
  if (a === 'withdraw') return ShopOrd.upd(o, { status: 'requested', offeredAt: '' }, 'Offer withdrawn');
  if (a === 'down') return ShopOrd.upd(o, { downPaid: !o.downPaid, downPaidAt: o.downPaid ? '' : now }, o.downPaid ? 'Marked not received' : 'Down payment received');
  if (a === 'refunded') { if (!confirm(`Mark ${fEGP(refundable(o))} as refunded${o.refundTo ? ' to ' + o.refundTo : ''}?`)) return; return ShopOrd.upd(o, { refundDone: true, refundDoneAt: now, refund: 'refund' }, 'Refund marked as sent'); }
  if (a === 'tocredit') return ShopOrd.credit(o.uid, refundable(o), `Down payment of order #${o.code}`)
    .then(() => ShopOrd.upd(o, { refundDone: true, refundDoneAt: now, refund: 'credit' }, 'Added to their credit')).catch(x => toast('⚠ ' + fsMsg(x)));
});
document.addEventListener('change', e => {
  const s = e.target.closest && e.target.closest('[data-custdown]'); if (!s) return;
  const S = F.S, v = s.value;
  within(S.setDoc(S.doc(F.fs, 'customers', s.dataset.custdown), { downPct: v === '' ? S.deleteField() : num(v) }, { merge: true }), 20000, offlineMsg)
    .then(() => toast(v === '' ? 'Uses the shop’s down payment' : `Down payment for this customer: ${v}%`)).catch(x => toast('⚠ ' + fsMsg(x)));
});
if (view === 'orders') render();
