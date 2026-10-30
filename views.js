/* ---------- views ---------- */
const UI = { q: '', person: '', type: '', stockOnly: true };
let chart = null;
const byDate = (a, b) => (b.date || '').localeCompare(a.date || '');
const shipName = id => { const s = db.shipments.find(x => x.id === id); return s ? s.name : ''; };
const actions = (coll, id) => `<td class="acts"><button class="ib" data-edit="${coll}:${id}" title="Edit">✎</button><button class="ib del" data-del="${coll}:${id}" title="Delete">${TRASH}</button></td>`;
const match = (...vals) => !UI.q || vals.join(' ').toLowerCase().includes(UI.q.toLowerCase());
const search = ph => `<input type="search" placeholder="${ph}" value="${esc(UI.q)}" data-ui="q">`;
const personFilter = () => `<select data-ui="person"><option value="">Everyone</option>${PEOPLE.map(p => `<option value="${p}"${UI.person === p ? ' selected' : ''}>${esc(pname(p))}</option>`).join('')}</select>`;

function settlementHero(R, compact) {
  const f = R.person.friend, m = R.person.me, s = db.settings;
  const amt = Math.abs(f.owes), square = amt < 0.5;
  const from = f.owes > 0 ? 'friend' : 'me', to = from === 'friend' ? 'me' : 'friend';
  const presetAmt = from === 'friend' ? Math.round(eur2egp(amt)) : Math.round(amt * 100) / 100;
  const presetCur = from === 'friend' ? 'EGP' : 'EUR';
  const row = (l, k, fmt = fEUR) => `<tr><td>${l}</td><td>${fmt(m[k])}</td><td>${fmt(f[k])}</td></tr>`;
  return `<div class="hero">
    <div>
      <div class="who">${square ? 'Right now you are' : `<b>${esc(pname(from))}</b> should send <b>${esc(pname(to))}</b>`}</div>
      <div class="big">${square ? 'All square' : fEUR(amt)}${square ? '' : `<small>≈ ${fEGP(eur2egp(amt))}</small>`}</div>
      <p class="expl">Counts only money customers have actually paid. Each of you first gets back what you spent on the goods that already left stock (product cost plus that box’s shipping and customs), then the profit is split ${s.meShare}% ${esc(s.meName)} / ${100 - s.meShare}% ${esc(s.friendName)}. Money for unsold stock comes back as it sells.</p>
      ${square ? '' : `<button class="btn terra" data-new="transfers" ${pre({ from, to, amount: presetAmt, currency: presetCur, notes: 'Settlement' })}>Record this payment</button>`}
      <div style="margin-top:16px"><div class="note">Profit split</div><div class="split-bar"><div style="width:${s.meShare}%"></div></div>
      <div class="note" style="display:flex;justify-content:space-between"><span>${esc(s.meName)} ${s.meShare}%</span><span>${esc(s.friendName)} ${100 - s.meShare}%</span></div></div>
    </div>
    ${compact ? '' : `<div><table class="ptable"><thead><tr><th></th><th>${esc(s.meName)}</th><th>${esc(s.friendName)}</th></tr></thead><tbody>
      ${row('Spent in total', 'outlay')}
      ${row('… still tied up in unsold stock', 'invested')}
      ${row('Costs earned back so far', 'recovered')}
      ${row('Profit share', 'share')}
      <tr class="tot"><td>Should have received</td><td>${fEUR(m.entitled)}</td><td>${fEUR(f.entitled)}</td></tr>
      ${row('Collected from customers', 'received')}
      ${row('Transfers received', 'tin')}
      ${row('Transfers sent', 'tout')}
      <tr class="tot"><td>Actually holds</td><td>${fEUR(m.actual)}</td><td>${fEUR(f.actual)}</td></tr>
    </tbody></table><p class="note">All amounts in € using each entry’s own exchange rate. EGP shown at today’s rate of ${s.rate}.</p></div>`}
  </div>`;
}

const V = {};
V.overview = R => {
  const empty = !db.purchases.length && !db.sales.length && !db.shipments.length;
  if (empty) return `<div class="welcome"><h2>Welcome. Let’s set up your ledger.</h2>
    <ol><li><b>Choose where the data lives:</b> click <b>Save as…</b> on the left to create a <code>.json</code> file on your disk. After that every change is written to it automatically. Share that file (e.g. via Google Drive or WhatsApp) so you both see the same numbers.</li>
    <li>Put your names, the profit split and today’s EGP rate in <b>Settings</b>.</li>
    <li>Create a <b>Shipment</b>, add your dm <b>Purchases</b> to it, then record <b>Sales</b>, <b>Expenses</b> and <b>Transfers</b> as they happen.</li></ol>
    <div class="topact"><button class="btn" data-new="shipments">Create first shipment</button><button class="btn ghost" data-go="settings">Settings</button><button class="btn ghost" data-act="demo">Load sample data to explore</button></div></div>`;
  const lows = Object.values(R.lots).filter(l => l.left > 0 && l.left <= num(db.settings.lowStock));
  const unpaid = salesOrders().filter(o => o.h.kind === 'sale' && !o.h.paid).sort(byDate);
  const moving = db.shipments.filter(s => s.status !== 'Delivered');
  const prod = {}; Object.values(R.lots).forEach(l => { const k = l.p.product; prod[k] = prod[k] || { n: 0, rev: 0, cost: 0 }; prod[k].n += l.sold; prod[k].rev += l.revEUR; prod[k].cost += l.sold * l.landed; });
  const top = Object.entries(prod).filter(([, x]) => x.n).sort((a, b) => (b[1].rev - b[1].cost) - (a[1].rev - a[1].cost)).slice(0, 6);
  return settlementHero(R) + `
  <div class="stamps">
    <div class="stamp n"><div class="in"><div class="k">Collected from sales</div><div class="v">${fEGP(R.revEGP)}</div><div class="s">${fEUR(R.rev)}</div></div></div>
    <div class="stamp ${R.profit >= 0 ? 'n' : 't'}"><div class="in"><div class="k">Profit so far</div><div class="v">${fEUR(R.profit)}</div><div class="s">${fEGP(eur2egp(R.profit))} · on goods sold</div></div></div>
    <div class="stamp g"><div class="in"><div class="k">Stock not yet sold</div><div class="v">${fEUR(R.stockEUR)}</div><div class="s">${Object.values(R.lots).reduce((a, l) => a + Math.max(0, l.left), 0)} units at cost</div></div></div>
    <div class="stamp t"><div class="in"><div class="k">Customers still owe</div><div class="v">${fEGP(R.unpaidEGP)}</div><div class="s">${unpaid.length} unpaid sale${unpaid.length === 1 ? '' : 's'}</div></div></div>
  </div>
  <div class="grid2">
    <div class="card"><h3>Money in vs money out, by month</h3><div class="chartbox"><canvas id="chart"></canvas></div></div>
    <div class="card"><h3>Best earners</h3>${top.length ? `<ul class="mini">${top.map(([k, x]) => `<li><span>${esc(k)}<span class="sub note">${x.n} sold</span></span><span class="r">${fEUR(x.rev - x.cost)} profit</span></li>`).join('')}</ul>` : '<div class="empty">No sales yet.</div>'}</div>
  </div>
  <div class="grid3" style="margin-top:18px">
    <div class="card"><h3>On the way</h3>${moving.length ? `<ul class="mini">${moving.map(s => `<li><span>${esc(s.name)}<span class="sub note">${esc(s.carrier || '')} ${fDate(s.date)}</span></span><span class="pill warn">${esc(s.status)}</span></li>`).join('')}</ul>` : '<div class="empty">Nothing in transit.</div>'}</div>
    <div class="card"><h3>Running low</h3>${lows.length ? `<ul class="mini">${lows.map(l => `<li><span>${esc(l.p.product)}</span><span class="r">${l.left} left</span></li>`).join('')}</ul>` : '<div class="empty">Stock levels look fine.</div>'}</div>
    <div class="card"><h3>Waiting for payment</h3>${unpaid.length ? `<ul class="mini">${unpaid.slice(0, 8).map(o => { const l = R.lots[(o.lines[0] || {}).purchaseId], more = o.lines.length - 1; return `<li><span>${esc(o.h.customer || 'Customer')}<span class="sub note">${esc(l ? l.p.product : '')}${more > 0 ? ` +${more} more` : ''} · ${fDate(o.date)}</span></span><span class="r"><button class="ib" data-act="paid:${o.id}" title="Mark paid">✓</button> ${fEGP(orderMoney(o, R).bill)}</span></li>`; }).join('')}</ul>` : '<div class="empty">Everyone has paid.</div>'}</div>
  </div>`;
};
V.overview.after = () => {
  const el = $('#chart'); if (!el || !window.Chart) return;
  const m = {}; const add = (d, k, v) => { if (!d) return; const key = d.slice(0, 7); m[key] = m[key] || { in: 0, out: 0 }; m[key][k] += v; };
  db.sales.forEach(s => s.kind === 'sale' && s.paid && add(s.date, 'in', toEUR(num(s.qty) * num(s.unitPrice), s.currency, s.rate)));
  db.purchases.forEach(p => add(p.date, 'out', num(p.qty) * num(p.unitCost)));
  db.expenses.forEach(e => add(e.date, 'out', toEUR(e.amount, e.currency, e.rate)));
  const keys = Object.keys(m).sort().slice(-12);
  chart = new Chart(el, { type: 'bar', data: { labels: keys.map(k => new Date(k + '-01T00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })),
    datasets: [{ label: 'Collected', data: keys.map(k => m[k].in), backgroundColor: '#0e6a5d', borderRadius: 4 }, { label: 'Spent', data: keys.map(k => m[k].out), backgroundColor: '#c4562d', borderRadius: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { family: 'Avenir Next, Gill Sans, sans-serif' } } }, tooltip: { callbacks: { label: c => c.dataset.label + ': ' + fEUR(c.raw) } } },
      scales: { y: { ticks: { callback: v => '€' + v }, grid: { color: '#ece3d1' } }, x: { grid: { display: false } } } } });
};

V.shipments = R => {
  const list = db.shipments.slice().sort(byDate).filter(s => match(s.name, s.carrier, s.tracking, s.notes));
  if (!db.shipments.length) return `<div class="welcome"><h2>No shipments yet</h2><p>A shipment is one box or suitcase going to Egypt. Create one, then add your dm purchases to it.</p><button class="btn" data-new="shipments">New shipment</button></div>`;
  return `<div class="toolbar">${search('Search shipments')}</div>${shipInfoHTML()}<div class="ships">${list.map(s => {
    const x = R.ship[s.id], idx = OPT.status.indexOf(s.status);
    const items = db.purchases.filter(p => p.shipmentId === s.id), costs = db.expenses.filter(e => e.shipmentId === s.id);
    return `<div class="ship" data-ship-id="${s.id}"><div class="shiphead"><h3>${esc(s.name)}</h3><span class="shipacts"><button class="ib" data-edit="shipments:${s.id}" title="Edit">✎</button><button class="ib del" data-del="shipments:${s.id}" title="Delete">${TRASH}</button></span></div><div class="meta">${fDate(s.date)} · ${esc(s.carrier || 'carrier?')}${s.tracking ? ' · ' + esc(s.tracking) : ''}${s.weight ? ' · ' + s.weight + ' kg' : ''}</div>
      <div class="steps">${OPT.status.map((_, i) => `<span class="${i <= idx ? 'on' : ''}"></span>`).join('')}</div>
      <div class="steplbl">${OPT.status.map((t, i) => i === idx ? `<b>${t}</b>` : `<span>${t}</span>`).join('')}</div>
      <dl class="kv"><dt>Products</dt><dd>${x.units} units · ${fEUR(x.goods)}</dd><dt>Shipping & other costs</dt><dd>${fEUR(x.costs)}</dd>
      <dt>Costs as % of goods</dt><dd>${x.goods ? Math.round(x.costs / x.goods * 100) + '%' : '—'}</dd>
      <dt>Shipping weight</dt><dd>${x.byWeight ? fG(x.grams) + (x.estimated ? ` (${x.estimated} est.)` : '') : 'no weights, split by price'}</dd>
      <dt>Shipping per kg</dt><dd>${x.byWeight && x.grams ? fEUR(x.costs / x.grams * 1000) : '—'}</dd>
      <dt>Sold / given away</dt><dd>${x.goods ? Math.round(x.consumed / x.goods * 100) : 0}% of value</dd></dl>
      <div class="lines"><ul class="mini">${items.map(p => `<li><span>${esc(p.product)} ×${p.qty}</span><span class="r">${fEUR(num(p.qty) * num(p.unitCost))} ${pill(p.paidBy)}</span></li>`).join('') || '<li class="empty">No products yet</li>'}
      ${costs.map(e => `<li><span>${esc(e.category)}${e.onDelivery ? ' (paid on delivery)' : ''}</span><span class="r">${fAmt(e.amount, e.currency)} ${pill(e.paidBy)}</span></li>`).join('')}</ul></div>
      ${s.notes ? `<p class="note">${esc(s.notes)}</p>` : ''}
      <div class="row">${idx < OPT.status.length - 1 ? `<button class="btn sm" data-act="advance:${s.id}">Mark ${OPT.status[idx + 1]}</button>` : ''}
      <button class="btn sm ghost" data-new="purchases" ${pre({ shipmentId: s.id })}>+ Product</button>
      <button class="btn sm ghost" data-receipt="${s.id}">⇪ dm receipt</button>
      <button class="btn sm ghost" data-new="expenses" ${pre({ shipmentId: s.id, category: 'Shipping', description: 'Shipping for ' + s.name })}>+ Cost</button>
      </div></div>`;
  }).join('')}</div>`;
};

V.purchases = R => {
  const rows = db.purchases.slice().sort(byDate).filter(p => (!UI.person || p.paidBy === UI.person) && match(p.product, p.brand, p.category, p.place, p.receipt, shipName(p.shipmentId)));
  const tot = rows.reduce((a, p) => a + num(p.qty) * num(p.unitCost), 0), units = rows.reduce((a, p) => a + num(p.qty), 0);
  return `<div class="toolbar">${search('Search product, brand, receipt…')}${personFilter()}</div>
  <div class="tablewrap"><table class="t"><thead><tr><th>Date</th><th>Product</th><th>Category</th><th class="num">Qty</th><th class="num">Per unit</th><th class="num">Total</th><th>Paid by</th><th>Where / how</th><th>Shipment</th><th></th></tr></thead><tbody>
  ${rows.map(p => `<tr><td>${fDate(p.date)}</td><td><b>${esc(p.product)}</b><span class="sub">${esc(p.brand || '')}${num(p.netG) ? ' · ' + fG(num(p.netG)) : ''}${p.receipt ? ' · #' + esc(p.receipt) : ''}</span></td><td>${esc(p.category)}</td>
    <td class="num">${p.qty}</td><td class="num">${fEUR(num(p.unitCost))}</td><td class="num">${fEUR(num(p.qty) * num(p.unitCost))}</td><td>${pill(p.paidBy)}</td>
    <td>${esc(p.place || '')}<span class="sub">${esc(p.method || '')}</span></td><td>${p.shipmentId ? esc(shipName(p.shipmentId)) : '<span class="pill warn">Not shipped</span>'}</td>${actions('purchases', p.id)}</tr>`).join('') || '<tr><td colspan="10" class="empty">No purchases yet.</td></tr>'}
  </tbody><tfoot><tr><td colspan="3">${rows.length} lines</td><td class="num">${units}</td><td></td><td class="num">${fEUR(tot)}</td><td colspan="4"></td></tr></tfoot></table></div>`;
};

V.stock = R => {
  const tm = num(db.settings.targetMargin) / 100;
  const loc = l => { const s = db.shipments.find(x => x.id === l.p.shipmentId); if (!s || s.status === 'Packing') return ['In Germany', 'me']; if (s.status === 'Delivered') return ['In Egypt', 'friend']; return [s.status, '']; };
  const rows = Object.values(R.lots).filter(l => (!UI.stockOnly || l.left > 0) && match(l.p.product, l.p.brand, l.p.category)).sort((a, b) => a.p.product.localeCompare(b.p.product));
  return `<div class="toolbar">${search('Search stock')}<label class="note"><input type="checkbox" data-ui="stockOnly"${UI.stockOnly ? ' checked' : ''}> Only items still in stock</label></div>
  <div class="tablewrap"><table class="t"><thead><tr><th>Product</th><th>Location</th><th class="num">Bought</th><th class="num">Sold</th><th class="num">Gift/lost</th><th class="num">Left</th><th class="num">Shipping weight</th><th class="num">Cost incl. shipping</th><th class="num">Avg sold at</th><th class="num">Markup</th><th class="num">Price for ${db.settings.targetMargin}% markup</th><th></th></tr></thead><tbody>
  ${rows.map(l => { const [where, c] = loc(l), cEGP = eur2egp(l.landed), avg = l.sold ? l.revEGP / l.sold : 0, mk = avg && cEGP ? (avg / cEGP - 1) * 100 : null;
    return `<tr><td><b>${esc(l.p.product)}</b><span class="sub">${esc(l.p.brand || '')} · ${esc(shipName(l.p.shipmentId) || 'no shipment')}</span></td><td><span class="pill ${c}">${esc(where)}</span></td>
    <td class="num">${l.qty}</td><td class="num">${l.sold}${l.unpaid ? `<span class="sub">${l.unpaid} unpaid</span>` : ''}</td><td class="num">${l.lost || ''}</td><td class="num"><b>${l.left}</b></td>
    <td class="num">${l.shipG ? fG(l.shipG) + (l.estG ? ' <span class="pill warn" title="Estimated from price">est.</span>' : '') : '—'}${num(l.p.netG) ? `<span class="sub">${fG(num(l.p.netG))} + packaging</span>` : ''}</td>
    <td class="num">${fEGP(cEGP)}<span class="sub">${fEUR(l.unit)} + ${fEUR(l.shipShare || 0)} shipping</span></td><td class="num">${avg ? fEGP(avg) : '—'}</td>
    <td class="num">${mk === null ? '—' : `<span class="pill ${mk >= num(db.settings.targetMargin) ? 'ok' : mk >= 0 ? 'warn' : 'bad'}">${Math.round(mk)}%</span>`}</td>
    <td class="num">${fEGP(Math.ceil(cEGP * (1 + tm) / 5) * 5)}</td>
    <td class="acts">${l.left > 0 ? `<button class="btn sm" data-new="sales" ${pre({ purchaseId: l.p.id })}>Sell</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="12" class="empty">Nothing here.</td></tr>'}
  </tbody><tfoot><tr><td colspan="5">Stock value at cost</td><td class="num">${rows.reduce((a, l) => a + Math.max(0, l.left), 0)}</td><td></td><td class="num">${fEUR(rows.reduce((a, l) => a + Math.max(0, l.left) * l.landed, 0))}</td><td colspan="4"></td></tr></tfoot></table></div>
  <p class="note">EGP amounts use today’s rate (${db.settings.rate} EGP/€).</p>${shipInfoHTML()}`;
};

V.expenses = R => {
  const rows = db.expenses.slice().sort(byDate).filter(e => (!UI.person || e.paidBy === UI.person) && match(e.category, e.description, e.place, e.method, shipName(e.shipmentId)));
  const tot = rows.reduce((a, e) => a + toEUR(e.amount, e.currency, e.rate), 0);
  return `<div class="toolbar">${search('Search expenses')}${personFilter()}</div>
  <div class="tablewrap"><table class="t"><thead><tr><th>Date</th><th>What</th><th class="num">Amount</th><th class="num">In €</th><th>Paid by</th><th>Where / how</th><th>Shipment</th><th></th></tr></thead><tbody>
  ${rows.map(e => `<tr><td>${fDate(e.date)}</td><td><b>${esc(e.category)}</b><span class="sub">${esc(e.description || '')}</span></td><td class="num">${fAmt(e.amount, e.currency)}${e.currency === 'EGP' ? `<span class="sub">@ ${e.rate}</span>` : ''}</td>
    <td class="num">${fEUR(toEUR(e.amount, e.currency, e.rate))}</td><td>${pill(e.paidBy)}${e.onDelivery ? '<span class="sub">on delivery</span>' : ''}</td><td>${esc(e.place || '')}<span class="sub">${esc(e.method || '')}</span></td>
    <td>${e.shipmentId ? esc(shipName(e.shipmentId)) : e.orderId ? `<button class="ib" data-edit="sales:${e.orderId}">${esc(e.notes || 'Sale')}</button>` : '<span class="note">general</span>'}</td>${actions('expenses', e.id)}</tr>`).join('') || '<tr><td colspan="8" class="empty">No expenses yet.</td></tr>'}
  </tbody><tfoot><tr><td colspan="3">${rows.length} entries</td><td class="num">${fEUR(tot)}</td><td colspan="4"></td></tr></tfoot></table></div>`;
};

V.transfers = R => {
  const rows = db.transfers.slice().sort(byDate).filter(t => (!UI.person || t.from === UI.person || t.to === UI.person) && match(t.method, t.notes));
  return settlementHero(R, true) + `<div class="toolbar">${search('Search transfers')}${personFilter()}</div>
  <div class="tablewrap"><table class="t"><thead><tr><th>Date</th><th>From → To</th><th class="num">Amount</th><th class="num">In €</th><th>Method</th><th>Notes</th><th></th></tr></thead><tbody>
  ${rows.map(t => `<tr><td>${fDate(t.date)}</td><td>${pill(t.from)} → ${pill(t.to)}</td><td class="num">${fAmt(t.amount, t.currency)}${t.currency === 'EGP' ? `<span class="sub">@ ${t.rate}</span>` : ''}</td><td class="num">${fEUR(toEUR(t.amount, t.currency, t.rate))}</td><td>${esc(t.method || '')}</td><td>${esc(t.notes || '')}</td>${actions('transfers', t.id)}</tr>`).join('') || '<tr><td colspan="7" class="empty">No transfers yet.</td></tr>'}
  </tbody></table></div>`;
};

function ledgerRows(R) {
  const out = [];
  db.purchases.forEach(p => out.push({ date: p.date, type: 'Purchase', desc: `${p.product} ×${p.qty}`, who: p.paidBy, dir: 'out', place: p.place, how: p.method, amt: num(p.qty) * num(p.unitCost), cur: 'EUR', eur: num(p.qty) * num(p.unitCost), coll: 'purchases', id: p.id }));
  db.expenses.forEach(e => out.push({ date: e.date, type: e.category, desc: e.description || e.category, who: e.paidBy, dir: 'out', place: e.place, how: e.method + (e.onDelivery ? ', on delivery' : ''), amt: e.amount, cur: e.currency, eur: toEUR(e.amount, e.currency, e.rate), coll: 'expenses', id: e.id }));
  db.sales.filter(s => s.kind === 'sale').forEach(s => { const l = R.lots[s.purchaseId], a = num(s.qty) * num(s.unitPrice);
    out.push({ date: s.date, type: s.paid ? 'Sale' : 'Sale (unpaid)', desc: `${l ? l.p.product : (s.product || '?')} ×${s.qty}${s.customer ? ' to ' + s.customer : ''}`, who: s.receivedBy, dir: s.paid ? 'in' : 'pending', place: s.place, how: s.method, amt: a, cur: s.currency, eur: toEUR(a, s.currency, s.rate), coll: 'sales', id: s.id }); });
  db.transfers.forEach(t => out.push({ date: t.date, type: 'Transfer', desc: `${pname(t.from)} → ${pname(t.to)}${t.notes ? ' · ' + t.notes : ''}`, who: t.from, to: t.to, dir: 'move', place: '', how: t.method, amt: t.amount, cur: t.currency, eur: toEUR(t.amount, t.currency, t.rate), coll: 'transfers', id: t.id }));
  return out.sort(byDate);
}
V.ledger = R => {
  const rows = ledgerRows(R).filter(r => (!UI.person || r.who === UI.person || r.to === UI.person) && (!UI.type || r.dir === UI.type) && match(r.type, r.desc, r.place, r.how));
  const flow = { in: ['Money in', 'ok'], out: ['Money out', 'bad'], pending: ['Owed by customer', 'warn'], move: ['Between you', ''] };
  return `<div class="toolbar">${search('Search everything')}${personFilter()}<select data-ui="type"><option value="">All movements</option>${Object.entries(flow).map(([k, [l]]) => `<option value="${k}"${UI.type === k ? ' selected' : ''}>${l}</option>`).join('')}</select><button class="btn sm ghost" data-act="csv">Export CSV</button></div>
  <div class="tablewrap"><table class="t"><thead><tr><th>When</th><th>What</th><th>Who</th><th>Where</th><th>How</th><th class="num">How much</th><th class="num">In €</th><th>Flow</th><th></th></tr></thead><tbody>
  ${rows.map(r => `<tr><td>${fDate(r.date)}</td><td><b>${esc(r.type)}</b><span class="sub">${esc(r.desc)}</span></td><td>${pill(r.who)}${r.to ? ' → ' + pill(r.to) : ''}</td><td>${esc(r.place || '')}</td><td>${esc(r.how || '')}</td>
    <td class="num">${fAmt(r.amt, r.cur)}</td><td class="num ${r.dir === 'in' ? 'in-amt' : r.dir === 'out' ? 'out-amt' : ''}">${r.dir === 'out' ? '−' : r.dir === 'in' ? '+' : ''}${fEUR(r.eur)}</td>
    <td><span class="pill ${flow[r.dir][1]}">${flow[r.dir][0]}</span></td><td class="acts"><button class="ib" data-edit="${r.coll}:${r.id}">✎</button></td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nothing recorded yet.</td></tr>'}
  </tbody></table></div>`;
};
V.ledger.csv = () => {
  const R = calc();
  downloadCSV('shanta-ledger-' + today() + '.csv', [['Date', 'Type', 'Description', 'Who', 'To', 'Where', 'How', 'Amount', 'Currency', 'EUR', 'Flow']]
    .concat(ledgerRows(R).map(r => [r.date, r.type, r.desc, pname(r.who), r.to ? pname(r.to) : '', r.place, r.how, num(r.amt).toFixed(2), r.cur, r.eur.toFixed(2), r.dir])));
};

V.settings = () => {
  const s = db.settings;
  const f = (k, l, t = 'text', extra = '', hint = '') => `<div class="f"><label>${l}</label><input data-set="${k}" type="${t}" value="${esc(s[k])}" ${extra}>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
  return `<div class="grid2 settings"><div class="card"><h3>The two of you</h3>
    <div class="fgrid">${f('meName', 'Your name (in Germany)')}${f('friendName', 'Friend’s name (in Egypt)')}</div>
    ${f('meShare', 'Your share of the profit (%)', 'number', 'min="0" max="100" step="1"', `${esc(s.friendName)} gets ${100 - num(s.meShare)}%`)}
    <div class="fgrid">${f('cityDE', 'Default place to buy')}${f('cityEG', 'Default city for sales')}</div></div>
  <div class="card"><h3>Money & stock</h3>
    <div class="f"><label>Today’s rate: EGP for €1</label><div class="raterow"><input data-set="rate" type="number" step="0.01" value="${esc(s.rate)}"><button type="button" class="btn sm ghost" data-act="fx">↻ Live rate</button></div><span class="hint" id="fx_hint">${fxHint()}</span></div>
    <div class="f chk"><input type="checkbox" id="fx_auto" data-set="rateAuto"${s.rateAuto !== false ? ' checked' : ''}><label for="fx_auto">Update the rate from the internet once a day</label></div>
    ${f('targetMargin', 'Target markup on cost (%)', 'number', 'step="1"', 'Used for the suggested selling price.')}
    ${f('packagingPct', 'Packaging added to content weight (%)', 'number', 'step="1" min="0"', 'Receipts only show the net content. This much is added for bottle, jar and box when splitting shipping by weight.')}
    ${shipInfoHTML()}
    ${f('lowStock', 'Warn when stock is at or below', 'number', 'step="1"')}</div>
  <div class="card"><h3>Backup & sync</h3><div class="filebox" id="filebox"></div>
    <p class="note">${canFS() ? 'Data is written straight to a <code>.json</code> file on your disk. Pick it once with “Save as…”; after that every change is saved to it automatically. A backup copy also stays in this browser.' : 'This browser can’t write to files directly, so use “Download backup” to save a <code>.json</code> file and “Import” to load it again.'}</p>
    <div class="f chk"><input type="checkbox" id="as" data-set="autosave"${s.autosave ? ' checked' : ''}><label for="as">Save to the file automatically after every change</label></div>
    <div class="topact" style="margin-top:10px"><button class="btn" data-act="saveas">Save as…</button><button class="btn ghost" data-act="open">Open file</button><button class="btn ghost" data-act="download">Download backup</button><button class="btn ghost" data-act="import">Restore from file</button></div></div>
  ${Cloud.settingsHTML()}
  <div class="card"><h3>Start over</h3><p class="note">Sample data shows how a full cycle looks. Before anything is cleared or replaced, a full backup is made: in the cloud when you are signed in (open it from the list above), otherwise as a downloaded file.</p>
    <div class="topact"><button class="btn ghost" data-act="demo">Load sample data</button><button class="btn terra" data-act="reset">Clear all data</button></div></div></div>`;
};

/* ---------- how shipping is split (info box) ---------- */
function shipInfoHTML(open) {
  const p = num(db.settings.packagingPct), ex = 200 * (1 + p / 100);
  return `<details class="howto"${open ? ' open' : ''}><summary><span class="ii">i</span> How shipping costs are split over a box</summary>
    <div class="howto-b">
      <p>Each box’s costs (shipping, customs and anything else added with “+ Cost”) are shared by its products <b>by weight</b>:</p>
      <div class="formula"><span>Shipping weight</span> = content weight × (1 + ${p}% packaging)<br>
        <span>Product’s share</span> = box costs × its shipping weight ÷ total shipping weight of the box<br>
        <span>Cost incl. shipping</span> = purchase price + its share</div>
      <p><b>Example:</b> a 200 g cream ships as ${fG(ex)} (200 g + ${p}%). In a box of 10 kg with €50 shipping it carries €50 × ${fG(ex)} ÷ 10 kg = <b>${fEUR(50 * ex / 10000)}</b>.</p>
      <ul>
        <li><b>Content weight</b> comes from the receipt (“150 ml”, “200g”, “1,5kg”; 1 ml counts as 1 g). You can change it on each purchase.</li>
        <li><b>Packaging</b> (bottle, jar, box) isn’t on the receipt, so ${p}% is added. Change it in Settings → Money &amp; stock.</li>
        <li><b>No weight known</b> (e.g. tablets sold by count): it is estimated from the price, using the box’s average grams per euro. These show “est.”.</li>
        <li><b>A box with no weights at all</b> is split by purchase price instead.</li>
        <li>Whoever paid the box costs gets them back in the same proportion as its products are sold.</li>
      </ul>${missingW().length ? `<button class="btn sm" data-act="fillw">Read weights from product names for ${missingW().length} older purchase${missingW().length === 1 ? '' : 's'}</button>` : ''}</div></details>`;
}
const missingW = () => db.purchases.filter(p => !num(p.netG) && parseWeightG(p.product));

/* ---------- deleting a box: keep, move or delete its products and costs ---------- */
function bdlg() {
  let d = $('#bdlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'bdlg'; d.innerHTML = '<div id="bbody"></div>'; document.body.appendChild(d); }
  return d;
}
function openShipDelete(id) {
  const sh = db.shipments.find(s => s.id === id); if (!sh) return;
  const items = db.purchases.filter(p => p.shipmentId === id), costs = db.expenses.filter(e => e.shipmentId === id);
  if (!items.length && !costs.length) {
    if (confirm(`Delete ${sh.name}? It has no products or costs.`)) { db.shipments = db.shipments.filter(s => s.id !== id); commit(); toast('Box deleted'); }
    return;
  }
  const ids = new Set(items.map(p => p.id)), sold = db.sales.filter(s => ids.has(s.purchaseId));
  const others = db.shipments.filter(s => s.id !== id).sort(byDate);
  const units = items.reduce((a, p) => a + num(p.qty), 0);
  const value = items.reduce((a, p) => a + num(p.qty) * num(p.unitCost), 0);
  const costEUR = costs.reduce((a, e) => a + toEUR(e.amount, e.currency, e.rate), 0);
  const d = bdlg();
  $("#bbody").innerHTML = `<div class="rhead"><div><h2>Delete ${esc(sh.name)}</h2>
      <p class="lead">This box has <b>${items.length} product line${items.length === 1 ? '' : 's'}</b> (${units} units, ${fEUR(value)})${costs.length ? ` and <b>${costs.length} cost${costs.length === 1 ? '' : 's'}</b> (${fEUR(costEUR)})` : ''}${sold.length ? `. ${sold.length} sale line${sold.length === 1 ? ' is' : 's are'} recorded for its products.` : '.'} What should happen to them?</p></div>
      <button type="button" class="ib" data-b="close" title="Close">✕</button></div>
    <div class="bopts">
      <label class="bopt"><input type="radio" name="bmode" value="keep" checked><span><b>Keep them, unassigned</b>
        <span class="note">Products show as “Not shipped”, costs become general expenses.</span></span></label>
      <label class="bopt${others.length ? '' : ' off'}"><input type="radio" name="bmode" value="move"${others.length ? '' : ' disabled'}><span><b>Move them to another box</b>
        <span class="note">${others.length ? 'Products and costs go to the box you pick; its cost split is recalculated.' : 'There is no other box yet. Create one first.'}</span>
        ${others.length ? `<select id="b_target">${others.map(s => `<option value="${s.id}">${esc(s.name)} · ${esc(s.status)}</option>`).join('')}</select>` : ''}</span></label>
      <label class="bopt${sold.length ? ' off' : ''}"><input type="radio" name="bmode" value="all"${sold.length ? ' disabled' : ''}><span><b>Delete them too</b>
        <span class="note">${sold.length ? 'Not possible: some of these products have sales. Delete those sales first, or move the products to another box.' : `Removes the box, its products and its costs. A backup is made first (${Cloud.on() ? 'in the cloud, listed under Settings' : 'downloaded as a file'}).`}</span></span></label>
    </div>
    <div class="err" id="b_err" hidden></div>
    <div class="mact"><button type="button" class="btn ghost" data-b="close">Cancel</button><button type="button" class="btn terra" data-b="go" data-id="${id}">Delete box</button></div>`;
  if (!d.open) d.showModal();
}
async function runShipDelete(id, btn) {
  const sh = db.shipments.find(s => s.id === id); if (!sh) return bdlg().close();
  const mode = (document.querySelector('input[name="bmode"]:checked') || {}).value || 'keep';
  const err = m => { const e = $('#b_err'); e.textContent = m; e.hidden = false; btn.disabled = false; btn.textContent = 'Delete box'; };
  btn.disabled = true;
  if (mode === 'move') {
    const to = $('#b_target').value, target = db.shipments.find(s => s.id === to);
    if (!target) return err('Pick a box to move to.');
    db.purchases.forEach(p => { if (p.shipmentId === id) p.shipmentId = to; });
    db.expenses.forEach(e => { if (e.shipmentId === id) e.shipmentId = to; });
    db.shipments = db.shipments.filter(s => s.id !== id);
    commit(); bdlg().close(); return toast(`${sh.name} deleted; its contents moved to ${target.name}`);
  }
  if (mode === 'all') {
    btn.textContent = 'Saving a backup…';
    try {
      if (Cloud.on()) {
        await Cloud.sync();
        if (Cloud.state !== 'ok') return err('Couldn’t reach the cloud to make a backup, so nothing was deleted. ' + Cloud.msg);
        await Cloud.snapshot(`Automatic backup before deleting ${sh.name} with its products`);
      } else downloadJSON();
    } catch (x) { return err(x.message || 'The backup failed, so nothing was deleted.'); }
    const ids = new Set(db.purchases.filter(p => p.shipmentId === id).map(p => p.id));
    if (db.sales.some(s => ids.has(s.purchaseId))) return err('Sales were added for these products meanwhile, so nothing was deleted.');
    db.purchases = db.purchases.filter(p => !ids.has(p.id));
    db.expenses = db.expenses.filter(e => e.shipmentId !== id);
    db.shipments = db.shipments.filter(s => s.id !== id);
    commit(); bdlg().close(); return toast(`${sh.name} deleted with ${ids.size} products. A backup was saved first.`);
  }
  SCHEMAS.shipments.onDelete(sh);
  db.shipments = db.shipments.filter(s => s.id !== id);
  commit(); bdlg().close(); toast(`${sh.name} deleted; its contents are unassigned`);
}
document.addEventListener('click', e => {
  const t = e.target.closest('[data-del^="shipments:"]');
  if (t) { e.stopImmediatePropagation(); e.preventDefault(); return openShipDelete(t.dataset.del.split(':')[1]); }
  const b = e.target.closest('[data-b]'); if (!b) return;
  if (b.dataset.b === 'close') bdlg().close();
  if (b.dataset.b === 'go') runShipDelete(b.dataset.id, b);
}, true);
