/* ---------- set the EGP rate of products: one receipt, a whole box, or the products picked on Stock ----------
   The rate is saved on each product ("EGP per €1", what €1 cost you in pounds when you paid). An empty rate
   removes it, and the rate of the purchase day is used again. Suggested selling prices stay on today's rate. */
let SR = null;
function openRate(ids, title) {
  ids = ids.filter(id => db.purchases.some(p => p.id === id)); if (!ids.length) return;
  const ps = ids.map(id => db.purchases.find(p => p.id === id)), saved = uniq(ps.map(p => num(p.rate) ? String(num(p.rate)) : ''));
  SR = { ids, title, v: saved.length === 1 && ps.every(p => num(p.rate)) ? saved[0] : '' };
  drawRate();
  const d = scanDlg('ratedlg'); if (!d.open) d.showModal();
}
function drawRate() {
  rateOn.c = null;
  const ps = SR.ids.map(id => db.purchases.find(p => p.id === id)).filter(Boolean), eur = ps.reduce((a, p) => a + num(p.qty) * num(p.unitCost), 0);
  const fr = r => (Math.round(r * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const savedN = ps.filter(p => num(p.rate)).length, days = uniq(ps.map(p => p.date)), dayR = uniq(days.map(d => fr(rateOn(d))));
  const now = ps.reduce((a, p) => a + num(p.qty) * num(p.unitCost) * pRate(p), 0), v = num(SR.v);
  scanDlg('ratedlg').innerHTML = `<div class="sdbody" tabindex="-1" autofocus><div class="eyebrow">Exchange rate</div>
    <h2>${esc(SR.title)}</h2>
    <p class="lead">${ps.length} product line${ps.length === 1 ? '' : 's'} · ${fEUR(eur)}${savedN ? ` · ${savedN} with a saved rate` : ''}</p>
    <div class="f"><label>Rate (EGP per €1)</label><input type="text" inputmode="decimal" autocomplete="off" dir="ltr" data-srk="v" value="${esc(SR.v)}" placeholder="${dayR.join(' / ')} · rate of the day"></div>
    <div class="srcmp"><div><span>Now</span><b>${fEGP(now)}</b></div><div><span>With this rate</span><b id="srnew">${fEGP(v ? eur * v : ps.reduce((a, p) => a + num(p.qty) * num(p.unitCost) * rateOn(p.date), 0))}</b></div></div>
    <p class="note">Used for what you paid in EGP and for stock and profit at purchase rates. Suggested selling prices keep using today’s rate (${fr(rate())}). Leave empty to go back to the rate of the purchase day.</p>
    <div class="mact sdact"><button type="button" class="btn" data-sr="save">Save</button><button type="button" class="btn ghost" data-sr="cancel">Cancel</button></div></div>`;
}
function saveRate() {
  const v = num(SR.v); if (SR.v !== '' && !(v > 0)) return toast('⚠ Enter a rate above 0, or leave it empty.');
  let n = 0; SR.ids.forEach(id => { const p = db.purchases.find(x => x.id === id); if (p && num(p.rate) !== v) { p.rate = v || ''; n++; } });
  scanDlg('ratedlg').close();
  if (!n) return toast('Nothing changed.');
  commit(); render(); toast(v ? `✓ Rate ${v} saved on ${n} product line${n === 1 ? '' : 's'}` : `✓ Saved rate removed from ${n} product line${n === 1 ? '' : 's'}`);
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-sr]'); if (b && SR) { if (b.dataset.sr === 'save') saveRate(); else scanDlg('ratedlg').close(); return; }
  const r = e.target.closest('[data-srbox]'); if (!r) return;
  e.preventDefault(); e.stopPropagation();
  const box = r.dataset.srbox, rc = r.dataset.srrc, s = db.shipments.find(x => x.id === box);
  const ids = db.purchases.filter(p => p.shipmentId === box && (rc === undefined || (p.receipt || '').trim() === rc)).map(p => p.id);
  openRate(ids, rc !== undefined ? rc : 'All products in ' + (s ? s.name : 'this box'));
});
document.addEventListener('input', e => {
  if (!SR || !e.target.dataset || e.target.dataset.srk !== 'v') return;
  /* only the preview number changes while typing: redrawing the field would move the cursor to the start */
  SR.v = e.target.value; const ps = SR.ids.map(id => db.purchases.find(p => p.id === id)).filter(Boolean), v = num(SR.v);
  const b = $("#srnew"); if (b) b.textContent = fEGP(ps.reduce((a, p) => a + num(p.qty) * num(p.unitCost) * (v || rateOn(p.date)), 0));
});
document.addEventListener('keydown', e => { if (SR && e.key === 'Enter' && e.target.dataset && e.target.dataset.srk) { e.preventDefault(); saveRate(); } });
