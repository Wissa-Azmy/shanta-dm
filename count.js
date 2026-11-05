/* ---------- count what's left in Egypt, and sell the rest in one sale ----------
   Takes the stock of the delivered boxes (the ones in Egypt). You scan every unit that is still there;
   each scan counts one unit as kept. Everything not scanned goes into one new sale, oldest purchases first,
   at the suggested price, so you only add the customer and check the prices before saving.
   The count is kept on this device until you start over, so closing the window doesn't lose it. */
const CNT_KEY = 'shanta_count';
let CNT = null;

const cntBoxes = () => { const R = calc();
  return db.shipments.filter(s => s.status === 'Delivered' && Object.values(R.lots).some(l => l.p.shipmentId === s.id && l.left > 0)); };
/* one item per product: by barcode, or by name + brand when it has none */
function cntItems() {
  const R = calc(), m = new Map();
  Object.values(R.lots).filter(l => l.left > 0 && CNT.boxes.includes(l.p.shipmentId)).forEach(l => {
    const k = l.p.ean || 'n:' + grpKey(l.p);
    const x = m.get(k) || m.set(k, { key: k, name: l.p.product, brand: l.p.brand || '', ean: l.p.ean || '', lots: [], total: 0 }).get(k);
    x.lots.push(l); x.total += l.left;
  });
  m.forEach(x => x.lots.sort((a, b) => (a.p.date || '').localeCompare(b.p.date || '')));
  return [...m.values()];
}
const cntSave = () => { try { localStorage.setItem(CNT_KEY, JSON.stringify({ boxes: CNT.boxes, kept: CNT.kept, at: CNT.at })); } catch (e) { } };
function openCount() {
  const boxes = cntBoxes();
  if (!boxes.length) return toast('No delivered box has products left.');
  let old = null; try { old = JSON.parse(localStorage.getItem(CNT_KEY) || 'null'); } catch (e) { }
  CNT = { boxes: boxes.map(s => s.id), kept: {}, at: today(), q: '' };
  if (old && old.kept && Object.keys(old.kept).length) Object.assign(CNT, { boxes: old.boxes.filter(id => boxes.some(s => s.id === id)), kept: old.kept, at: old.at || today() });
  if (!CNT.boxes.length) CNT.boxes = boxes.map(s => s.id);
  const d = scanDlg('cntdlg'); drawCount(); if (!d.open) d.showModal();
}
const kept = x => Math.min(x.total, CNT.kept[x.key] || 0);
function drawCount() {
  const items = cntItems(), boxes = cntBoxes();
  const tot = items.reduce((a, x) => a + x.total, 0), k = items.reduce((a, x) => a + kept(x), 0), sell = tot - k;
  const q = CNT.q.trim().toLowerCase();
  const shown = items.filter(x => !q || (x.name + ' ' + x.brand + ' ' + x.ean).toLowerCase().includes(q))
    .sort((a, b) => (kept(b) > 0) - (kept(a) > 0) || a.name.localeCompare(b.name));
  const row = x => { const n = kept(x);
    return `<li class="cntr${n ? ' kept' : ''}"><span class="cx"><span class="cname"><b class="notr">${esc(x.name)}</b>${typeof dmLink === 'function' ? dmLink(x.lots[0].p) : ''}</span><span class="sub"><span class="notr">${esc(x.brand)}</span>${x.ean ? ` · <span class="mono notr">${esc(x.ean)}</span>` : ' · <span class="warnline">no barcode, count it by hand</span>'}</span></span>
      <span class="cstep"><button type="button" class="ib" data-cnt="dec:${esc(x.key)}"${n ? '' : ' disabled'} aria-label="One less">−</button><b>${n}<small>/${x.total}</small></b><button type="button" class="ib" data-cnt="inc:${esc(x.key)}"${n < x.total ? '' : ' disabled'} aria-label="One more">+</button></span>
      <span class="csell">${x.total - n ? `sell ${x.total - n}` : 'keep all'}</span></li>`; };
  scanDlg('cntdlg').innerHTML = `<div class="sdbody" tabindex="-1" autofocus><div class="eyebrow">Stock count · Egypt</div>
    <h2>Scan what’s still in Egypt</h2>
    <p class="lead">Scan every unit you still have. Everything you don’t scan is sold in one sale.</p>
    <div class="cntboxes">${boxes.map(s => `<label class="chip"><input type="checkbox" data-cntbox="${s.id}"${CNT.boxes.includes(s.id) ? ' checked' : ''}> <span class="notr">${esc(s.name)}</span></label>`).join('')}</div>
    <div class="cntsum"><div><small>In these boxes</small><b>${tot}</b></div><div><small>Still here (scanned)</small><b>${k}</b></div><div class="sell"><small>To sell</small><b>${sell}</b></div></div>
    <button type="button" class="btn full cntscan" data-cnt="scan">${SCANICON} Scan what’s left</button>
    <div class="toolbar"><input type="search" data-cntq value="${esc(CNT.q)}" placeholder="Find a product" autocomplete="off"></div>
    <ul class="cntlist">${shown.map(row).join('') || '<li class="note">No products match.</li>'}</ul>
    ${k ? '<button type="button" class="rlink" data-cnt="reset">Start the count over</button>' : ''}
    <div class="mact sdact"><button type="button" class="btn ghost" data-cnt="close">Close</button><button type="button" class="btn" data-cnt="sell"${sell ? '' : ' disabled'}>Sell the rest (${sell})</button></div></div>`;
}
/* one scan = one unit kept */
function countCode(code) {
  const items = cntItems(), x = items.find(i => i.ean === code);
  if (!x) { const p = eanLines(code)[0];
    return { kind: 'warn', name: p ? p.product : code, brand: p ? p.brand : '', note: p ? 'Not in the selected delivered boxes, or none left' : 'This barcode isn’t linked to a product' }; }
  if (kept(x) >= x.total) return { kind: 'warn', name: x.name, brand: x.brand, note: `All ${x.total} already counted. Check for a double scan.` };
  CNT.kept[x.key] = kept(x) + 1; cntSave();
  return { kind: 'ok', name: x.name, brand: x.brand, n: kept(x), unit: `of ${x.total} here` };
}
function sellRest() {
  const lines = [];
  cntItems().forEach(x => { let rest = x.total - kept(x);
    x.lots.forEach(l => { if (rest <= 0) return; const q = Math.min(rest, l.left); rest -= q; lines.push({ purchaseId: l.p.id, qty: q, unitPrice: suggestEGP(l) }); }); });
  if (!lines.length) return toast('Nothing left to sell.');
  const n = lines.reduce((a, x) => a + x.qty, 0);
  if (!confirm(`Put ${n} units in one new sale?\n\nCheck the customer and the prices before saving it. The ${Object.values(CNT.kept).reduce((a, v) => a + v, 0)} units you scanned stay in stock.`)) return;
  scanDlg('cntdlg').close();
  openOrder(null, { lines, notes: `Sale of the rest after the stock count in Egypt on ${fDate(CNT.at)}` });
}
document.addEventListener('click', e => {
  if (e.target.closest('[data-count]')) { e.preventDefault(); return openCount(); }
  const b = e.target.closest('[data-cnt]'); if (!b || !CNT || b.disabled) return;
  const [a, key] = b.dataset.cnt.split(/:(.*)/s);
  if (a === 'close') return scanDlg('cntdlg').close();
  if (a === 'sell') return sellRest();
  if (a === 'scan') return Scan.read('Scan what’s still in Egypt', code => { if (!CNT) return null; const r = countCode(code); drawCount(); return r; });
  if (a === 'reset') { if (!confirm('Start the count over? The units you scanned go back to 0.')) return; CNT.kept = {}; CNT.at = today(); cntSave(); }
  if (a === 'inc' || a === 'dec') { const x = cntItems().find(i => i.key === key); if (!x) return;
    CNT.kept[key] = Math.max(0, Math.min(x.total, kept(x) + (a === 'inc' ? 1 : -1))); if (!CNT.kept[key]) delete CNT.kept[key]; cntSave(); }
  drawCount();
});
document.addEventListener('change', e => {
  const c = e.target.closest && e.target.closest('[data-cntbox]'); if (!c || !CNT) return;
  CNT.boxes = c.checked ? [...new Set([...CNT.boxes, c.dataset.cntbox])] : CNT.boxes.filter(id => id !== c.dataset.cntbox);
  cntSave(); drawCount();
});
document.addEventListener('input', e => {
  if (!CNT || !e.target.matches || !e.target.matches('[data-cntq]')) return;
  CNT.q = e.target.value; const pos = e.target.selectionStart; drawCount();
  const i = $('#cntdlg [data-cntq]'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (x) { } }
});
document.addEventListener('close', e => { if (e.target.id === 'cntdlg') CNT = null; }, true);
