/* ---------- move products picked on Stock to another box, or to a new one ----------
   Only units still in stock move. When some units of a purchase were already sold (or lost), or only
   part of it moves, the purchase is split: the original keeps the rest, a copy with the moved units
   goes to the new box. Sales keep pointing at the original, so their cost stays as it was. */
let MV = null;
function openMove(ids) {
  const R = calc();
  const items = ids.map(id => R.lots[id]).filter(l => l && l.left > 0).map(l => ({ id: l.p.id, n: l.left }));
  if (!items.length) return;

  MV = { items, to: db.shipments.length ? '' : '__new', name: 'Box #' + (db.shipments.length + 1), err: '' };
  drawMove();
  const d = scanDlg('movedlg'); if (!d.open) d.showModal();
}
function drawMove() {
  const R = calc(), units = MV.items.reduce((a, x) => a + x.n, 0);
  const opts = db.shipments.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .map(s => `<option value="${s.id}"${MV.to === s.id ? ' selected' : ''}>${esc(s.name)} · ${esc(s.status)}</option>`).join('');
  const row = x => { const l = R.lots[x.id];
    return `<li class="mv"><span><b>${esc(l.p.product)}</b><span class="sub">${storeTag(l.p)}${esc(l.p.brand || '')}${l.p.brand ? ' · ' : ''}${esc(shipName(l.p.shipmentId) || 'Not shipped yet')}</span></span>
      <span class="mvn"><button type="button" class="ib" data-mv="minus:${x.id}" title="One less"${x.n <= 1 ? ' disabled' : ''}>−</button><b>${x.n}</b><small>of ${l.left}</small><button type="button" class="ib" data-mv="plus:${x.id}" title="One more"${x.n >= l.left ? ' disabled' : ''}>+</button>
      <button type="button" class="ib" data-mv="drop:${x.id}" title="Don’t move">×</button></span></li>`; };
  scanDlg('movedlg').innerHTML = `<div class="sdbody" tabindex="-1" autofocus><div class="eyebrow">Move to another box</div>
    <h2>${MV.items.length} products · ${units} units</h2>
    <ul class="linklist mvlist">${MV.items.map(row).join('')}</ul>
    <div class="mvto"><div class="f"><label>Move to</label><select data-mvk="to"><option value=""${MV.to === '' ? ' selected' : ''} disabled>Choose a box…</option>${opts}<option value="__new"${MV.to === '__new' ? ' selected' : ''}>+ New box…</option></select></div>
    ${MV.to === '__new' ? `<div class="f"><label>New box name</label><input data-mvk="name" value="${esc(MV.name)}"></div>` : ''}</div>
    <p class="note">Sold units stay in their box. Shipping costs are split again by weight in both boxes.</p>
    ${MV.err ? `<p class="err">${esc(MV.err)}</p>` : ''}
    <div class="mact sdact"><button type="button" class="btn" data-mv="go">Move</button><button type="button" class="btn ghost" data-mv="cancel">Cancel</button></div></div>`;
}
function doMove() {
  let to = MV.to;
  if (!to) { MV.err = 'Choose the box to move them to.'; return drawMove(); }
  if (to === '__new') {
    const name = MV.name.trim(); if (!name) { MV.err = 'Give the new box a name.'; return drawMove(); }
    to = uid(); db.shipments.push({ id: to, name, date: today(), status: 'Packing', carrier: '', tracking: '', weight: '', notes: '' });
  }
  const R = calc(); let moved = 0, units = 0;
  MV.items.forEach(x => {
    const l = R.lots[x.id]; if (!l || (l.p.shipmentId || '') === to) return;
    const n = Math.min(Math.max(1, x.n), l.left); if (n <= 0) return;
    if (n === l.qty) l.p.shipmentId = to;
    else { db.purchases.push(Object.assign(JSON.parse(JSON.stringify(l.p)), { id: uid(), qty: n, shipmentId: to })); l.p.qty = num(l.p.qty) - n; }
    moved++; units += n;
  });
  scanDlg('movedlg').close();
  if (!moved) return toast('Nothing to move: they are already in that box.');
  commit(); render(); toast(`✓ ${units} units moved to ${shipName(to)}`);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-mv]'); if (!b || !MV) return;
  const [a, id] = b.dataset.mv.split(':'), x = id && MV.items.find(i => i.id === id), R = x && calc(), left = x ? R.lots[id].left : 0;
  if (a === 'cancel') return scanDlg('movedlg').close();
  if (a === 'go') return doMove();
  if (a === 'minus' && x) x.n = Math.max(1, x.n - 1);
  if (a === 'plus' && x) x.n = Math.min(left, x.n + 1);
  if (a === 'drop' && x) { MV.items = MV.items.filter(i => i !== x); if (!MV.items.length) return scanDlg('movedlg').close(); }
  MV.err = ''; drawMove();
});
document.addEventListener('change', e => {
  const k = e.target.dataset && e.target.dataset.mvk; if (!k || !MV) return;
  MV[k] = e.target.value; MV.err = ''; if (k === 'to') drawMove();
});
document.addEventListener('input', e => { if (e.target.dataset && e.target.dataset.mvk === 'name' && MV) MV.name = e.target.value; });
