/* ---------- import a dm invoice (PDF or pasted text) into a shipment ---------- */
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';
const BRANDS = ['Balea PROFESSIONAL', 'Balea MEN', 'Balea med', 'Balea', 'alverde NATURKOSMETIK', 'alverde', 'Denkmit', 'CATRICE', 'essence', 'ebelin', 'Mivolis', 'Dontodent', 'LANGHAARMÄDCHEN', 'Sundance', 'SEINZ', 'S-quitofree', 'babylove', 'Jessa', 'profissimo', 'trend !t up', 'Maybelline', 'L\'Oréal Paris', 'NIVEA', 'Garnier', 'CeraVe', 'The Ordinary'];
const RX = { items: [], meta: {}, warn: [], o: {} };
const deNum = s => parseFloat(String(s).replace(/\./g, '').replace(',', '.')) || 0;

function guessCategory(t) {
  t = t.toLowerCase();
  if (/mivolis|vitamin|tablett|kapsel|brause|kollagen|omega|zink|calcium|magnesium|biotin|salbe|kopfschmerz|fett ?blocker|fettstoffwechsel/.test(t)) return 'Health & vitamins';
  if (/haar|shampoo|conditioner|leichtkämm|kopfhaut|keratin|plex|hitzeschutz|styling/.test(t)) return 'Hair care';
  if (/mascara|make-up|makeup|lippen|lipstick|eyeliner|nagel|puder|concealer|catrice|essence|rouge|lidschatten/.test(t)) return 'Make-up';
  if (/parfum|parfüm|eau de|duft/.test(t) && !/raum/.test(t)) return 'Fragrance';
  if (/baby|windel|kinder/.test(t)) return 'Baby';
  if (/gesicht|serum|tagescreme|nachtcreme|bb creme|toner|augen|maske|peel-off|aufheller|q10|hyaluron|niacinamid|retinol|lsf/.test(t)) return 'Skin care';
  if (/deo|antitranspirant|dusch|körper|fuß|fuss|hand|bodylotion|pflegemilch|pflegeöl|massage|peeling|hornhaut|urea/.test(t)) return 'Body care';
  return 'Other';
}
function splitBrand(lines) {
  if (lines.length >= 2) return [lines[0], lines.slice(1).join(' ')];
  const s = lines[0] || '';
  const b = BRANDS.find(b => s.toLowerCase().startsWith(b.toLowerCase() + ' '));
  return b ? [s.slice(0, b.length), s.slice(b.length).trim()] : ['', s];
}

function parseReceipt(raw) {
  const text = String(raw).replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n');
  const meta = {};
  const d = text.match(/Rechnungsdatum:?\s*(\d{2})\.(\d{2})\.(\d{4})/) || text.match(/Auftragsdatum:?\s*(\d{2})\.(\d{2})\.(\d{4})/) || text.match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (d) meta.date = `${d[3]}-${d[2]}-${d[1]}`;
  const inv = text.match(/Rechnungsnummer:?\s*([A-Z0-9-]+)/); if (inv) meta.invoice = inv[1];
  const ord = text.match(/Bestellnummer:?\s*(\d+)/); if (ord) meta.order = ord[1];
  const sum = text.match(/Summe Artikel\s*([\d.]+,\d{2})\s*€/); if (sum) meta.sum = deNum(sum[1]);
  const paid = text.match(/Zahlungsbetrag\s*([\d.]+,\d{2})\s*€/) || text.match(/Rechnungsbetrag[^\d]*([\d.]+,\d{2})\s*€/); if (paid) meta.paid = deNum(paid[1]);
  meta.method = /PayPal/i.test(text) ? 'PayPal' : /Kreditkarte|Karte|EC-?Karte|girocard/i.test(text) ? 'Card' : /bar\b|Bargeld/i.test(text) ? 'Cash' : 'Card';
  meta.online = !!ord || /dm\.de/i.test(text);

  const re = /(\d{1,3},\d{2}) ?€\s*(?:\((\d)\))?\s*(?:\([§#]\)\s*)*(?:[\d.]+,\d{2} ?€ je [\d,]+ ?[A-Za-zÄÖÜäöü]+\.?\s*)?(\d{1,3})\s+([\d.]{1,6},\d{2}) ?€/g;
  const items = [], warn = [];
  let m, last = 0, zero = 0, odd = 0;
  while ((m = re.exec(text))) {
    const unit = deNum(m[1]), qty = parseInt(m[3], 10), total = deNum(m[4]);
    let chunk = text.slice(last, m.index);
    last = re.lastIndex;
    if (Math.abs(unit * qty - total) > 0.015) { odd++; continue; }
    if (chunk.includes('Gesamtpreis')) chunk = chunk.slice(chunk.lastIndexOf('Gesamtpreis') + 'Gesamtpreis'.length);
    const lines = chunk.split('\n').map(s => s.replace(/\([§#]\)/g, '').trim()).filter(s => s && !/^Artikelbezeichnung|^Einzelpreis|^Menge$/.test(s));
    if (!lines.length) { odd++; continue; }
    if (qty === 0) { zero++; continue; }
    const [brand, product] = splitBrand(lines.slice(-2));
    items.push({ on: true, brand, product: product || brand, qty, unit, total, category: guessCategory(brand + ' ' + product) });
  }
  const parsed = items.reduce((a, x) => a + x.total, 0);
  if (zero) warn.push(`${zero} line${zero > 1 ? 's' : ''} with quantity 0 (not delivered) skipped.`);
  if (odd) warn.push(`${odd} line${odd > 1 ? 's' : ''} could not be read reliably. Compare with the receipt.`);
  if (meta.sum && Math.abs(parsed - meta.sum) > 0.02) warn.push(`Lines found add up to ${fEUR(parsed)}, but the receipt says ${fEUR(meta.sum)}. Some lines may be missing.`);
  return { items, meta, warn };
}

async function pdfToText(file) {
  const pdfjs = await import(PDFJS + 'pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    let lastY = null;
    tc.items.forEach(it => {
      if (typeof it.str !== 'string') return;
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n';
      else if (out && !/[\s]$/.test(out) && it.str && !it.str.startsWith(' ')) out += ' ';
      out += it.str; if (it.hasEOL) out += '\n';
      lastY = y;
    });
    out += '\n';
  }
  return out;
}

/* ---------- dialog ---------- */
function rdlg() {
  let d = $('#rdlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'rdlg'; d.innerHTML = '<div id="rbody"></div>'; document.body.appendChild(d); }
  return d;
}
function openReceipt(shipmentId) {
  RX.items = []; RX.meta = {}; RX.warn = []; RX.err = ''; RX.busy = false;
  RX.o = { shipmentId: shipmentId || '', paidBy: 'me', method: 'Card', date: today(), receipt: '', place: 'dm.de', spread: true };
  const d = rdlg(); drawReceipt(); if (!d.open) d.showModal();
}
function factor() {
  const m = RX.meta;
  return RX.o.spread && m.sum && m.paid && m.paid < m.sum ? m.paid / m.sum : 1;
}
function rTotals() {
  const f = factor(), on = RX.items.filter(x => x.on);
  return { lines: on.length, units: on.reduce((a, x) => a + num(x.qty), 0), total: on.reduce((a, x) => a + num(x.qty) * num(x.unit) * f, 0) };
}
function drawReceipt() {
  const o = RX.o, m = RX.meta, f = factor(), t = rTotals();
  const dup = m.invoice && db.purchases.some(p => p.receipt === m.invoice || p.receipt === m.order);
  const sel = (k, opts) => `<select data-ro="${k}">${opts.map(x => Array.isArray(x) ? x : [x, x]).map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(o[k]) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  $('#rbody').innerHTML = `<div class="rhead"><div><h2>Import dm receipt</h2><p class="lead">Every product line on the receipt becomes a purchase in the chosen box. Check the list, fix anything that looks off, then import.</p></div>
    <button type="button" class="ib" data-rx="close" title="Close">✕</button></div>
    ${!RX.items.length ? `<div class="rdrop">
        <label class="btn" for="rx_file">${RX.busy ? 'Reading…' : 'Choose PDF receipt'}</label><input type="file" id="rx_file" accept="application/pdf,.pdf" hidden>
        <p class="note">dm.de invoices (“Rechnung”) as PDF. The file stays on your device.</p>
        <details${RX.err ? ' open' : ''}><summary>Or paste the receipt text</summary>
          <p class="note">Open the PDF, press ⌘A (Ctrl+A) then ⌘C (Ctrl+C), and paste here.</p>
          <textarea id="rx_text" rows="7" placeholder="Paste the receipt text…"></textarea>
          <button type="button" class="btn sm" data-rx="paste">Read text</button></details>
        ${RX.err ? `<div class="err">${esc(RX.err)}</div>` : ''}</div>` : `
    <div class="fgrid rx-opts">
      <div class="f"><label>Shipment</label>${sel('shipmentId', shipOpts())}</div>
      <div class="f"><label>Date bought</label><input type="date" data-ro="date" value="${esc(o.date)}"></div>
      <div class="f"><label>Paid by</label>${sel('paidBy', PEOPLE.map(p => [p, pname(p)]))}</div>
      <div class="f"><label>Paid with</label>${sel('method', OPT.payDE)}</div>
      <div class="f"><label>Receipt / order no.</label><input data-ro="receipt" value="${esc(o.receipt)}"></div>
      <div class="f"><label>Where</label><input data-ro="place" value="${esc(o.place)}"></div>
      ${m.sum && m.paid && m.paid < m.sum ? `<div class="f chk span"><input type="checkbox" id="rx_spread" data-ro="spread"${o.spread ? ' checked' : ''}><label for="rx_spread">Spread the coupon discount of ${fEUR(m.sum - m.paid)} over the products (you paid ${fEUR(m.paid)} instead of ${fEUR(m.sum)})</label></div>` : ''}
    </div>
    ${dup ? `<div class="err">This receipt (${esc(m.invoice)}) looks like it was imported before. Importing again will add the products twice.</div>` : ''}
    ${RX.warn.map(w => `<div class="info">${esc(w)}</div>`).join('')}
    <div class="tablewrap rx-table"><table class="t"><thead><tr><th><input type="checkbox" data-rx="all"${RX.items.every(x => x.on) ? ' checked' : ''}></th><th>Brand</th><th>Product</th><th>Category</th><th class="num">Qty</th><th class="num">Per unit${f < 1 ? ' (after coupons)' : ''}</th><th class="num">Total</th></tr></thead><tbody>
    ${RX.items.map((x, i) => `<tr class="${x.on ? '' : 'off'}"><td><input type="checkbox" data-ri="${i}" data-rk="on"${x.on ? ' checked' : ''}></td>
      <td><input class="cell" data-ri="${i}" data-rk="brand" value="${esc(x.brand)}"></td>
      <td><input class="cell wide" data-ri="${i}" data-rk="product" value="${esc(x.product)}"></td>
      <td><select class="cell" data-ri="${i}" data-rk="category">${OPT.category.map(c => `<option${c === x.category ? ' selected' : ''}>${c}</option>`).join('')}</select></td>
      <td class="num"><input class="cell n" type="number" min="1" step="1" data-ri="${i}" data-rk="qty" value="${x.qty}"></td>
      <td class="num">${fEUR(x.unit * f)}${f < 1 ? `<span class="sub">${fEUR(x.unit)}</span>` : ''}</td>
      <td class="num" id="rt_${i}">${fEUR(num(x.qty) * x.unit * f)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td></td><td colspan="3" id="rx_sum">${t.lines} lines · ${t.units} units</td><td></td><td></td><td class="num" id="rx_tot">${fEUR(t.total)}</td></tr></tfoot></table></div>
    <div class="mact"><button type="button" class="btn ghost" data-rx="reset">Use another receipt</button><button type="button" class="btn ghost" data-rx="close">Cancel</button>
      <button type="button" class="btn" data-rx="import" id="rx_go">Import ${t.lines} products</button></div>`}`;
}
function loadText(text) {
  const r = parseReceipt(text);
  if (!r.items.length) { RX.err = 'No product lines were found. If this is a dm.de invoice, try pasting its text instead; paper till receipts are not supported yet.'; RX.busy = false; drawReceipt(); return; }
  Object.assign(RX, r, { err: '', busy: false });
  Object.assign(RX.o, { date: r.meta.date || RX.o.date, receipt: r.meta.invoice || r.meta.order || '', method: r.meta.method || RX.o.method, place: r.meta.online ? 'dm.de (online)' : db.settings.cityDE });
  drawReceipt();
}
function doImport() {
  const f = factor(), o = RX.o, on = RX.items.filter(x => x.on && num(x.qty) > 0 && x.product.trim());
  if (!on.length) return toast('Nothing selected to import');
  on.forEach(x => db.purchases.push({ id: uid(), date: o.date, place: o.place, product: x.product.trim(), brand: x.brand.trim(), category: x.category,
    qty: num(x.qty), unitCost: Math.round(x.unit * f * 1000) / 1000, paidBy: o.paidBy, method: o.method, shipmentId: o.shipmentId, receipt: o.receipt,
    notes: f < 1 ? `Receipt price ${fEUR(x.unit)}, coupons spread` : '' }));
  commit(); rdlg().close();
  toast(`${on.length} products imported${o.shipmentId ? ' into ' + shipName(o.shipmentId) : ''}`);
}

document.addEventListener('click', e => {
  const r = e.target.closest('[data-receipt]');
  if (r) { e.preventDefault(); return openReceipt(r.dataset.receipt); }
  const b = e.target.closest('[data-rx]'); if (!b) return;
  const a = b.dataset.rx;
  if (a === 'close') rdlg().close();
  if (a === 'reset') { RX.items = []; RX.err = ''; drawReceipt(); }
  if (a === 'paste') { const t = $('#rx_text').value; if (t.trim()) loadText(t); }
  if (a === 'import') doImport();
});
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'rx_file' && t.files[0]) {
    RX.busy = true; RX.err = ''; drawReceipt();
    try { loadText(await pdfToText(t.files[0])); }
    catch (x) { console.warn(x); RX.busy = false; RX.err = 'This PDF could not be read here (the PDF reader needs an internet connection and may be blocked in previews). Use “paste the receipt text” below instead.'; drawReceipt(); }
    return;
  }
  if (t.dataset.rx === 'all') { RX.items.forEach(x => x.on = t.checked); drawReceipt(); return; }
  if (t.dataset.ro) { RX.o[t.dataset.ro] = t.type === 'checkbox' ? t.checked : t.value; if (t.dataset.ro === 'spread') drawReceipt(); return; }
  if (t.dataset.rk === 'on' || t.dataset.rk === 'category') { RX.items[+t.dataset.ri][t.dataset.rk] = t.type === 'checkbox' ? t.checked : t.value; if (t.type === 'checkbox') drawReceipt(); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.ro && t.type !== 'checkbox') { RX.o[t.dataset.ro] = t.value; return; }
  if (!t.dataset.rk || t.dataset.rk === 'on') return;
  const x = RX.items[+t.dataset.ri]; x[t.dataset.rk] = t.dataset.rk === 'qty' ? num(t.value) : t.value;
  if (t.dataset.rk === 'qty') {
    const f = factor(), tt = rTotals();
    $('#rt_' + t.dataset.ri).textContent = fEUR(num(x.qty) * x.unit * f);
    $('#rx_sum').textContent = `${tt.lines} lines · ${tt.units} units`; $('#rx_tot').textContent = fEUR(tt.total);
  }
});
