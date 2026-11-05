/* ---------- find barcodes on Open Beauty Facts by product name, and link them ----------
   Goes through the products that have no barcode yet, one at a time: searches Open Beauty Facts for
   brand + name, shows the closest matches, and links the one you pick to every line of that product.
   Nothing is linked without a tap. Open Beauty Facts allows about 10 name searches a minute and asks
   apps not to search while typing, so searches only run on demand and are spaced out. */
const OBFS = {};            // search results per query, for this session
let FB = null, obfLast = 0;
const OBF_GAP = 6500;       // ms between two searches

/* products still without a barcode, one entry per product (same name + brand), most bought first */
function noEanGroups(only) {
  const g = new Map();
  db.purchases.forEach(p => {
    if (p.ean || (only && !only.includes(p.id))) return;
    if (!only && eanFor(p.product, p.brand)) return;
    const k = grpKey(p); const x = g.get(k) || g.set(k, { key: k, p, ids: [], units: 0 }).get(k);
    x.ids.push(p.id); x.units += num(p.qty);
  });
  return [...g.values()].sort((a, b) => b.units - a.units);
}
const obfWords = s => String(s || '').toLowerCase().replace(/\d+([.,]\d+)?\s*(ml|g|kg|l|stk|st|x)\b/g, ' ')
  .replace(/[^a-z0-9äöüßéè]+/g, ' ').split(' ').filter(w => w.length > 1);
const obfQuery = (p, noBrand) => [...new Set([...(noBrand ? [] : obfWords(p.brand)), ...obfWords(p.product)])].slice(0, 8).join(' ');

/* how close a result is to our product: share of our words found in its name and brand, plus the size */
function obfScore(p, r) {
  const mine = obfWords((p.brand || '') + ' ' + p.product), theirs = new Set(obfWords(r.brand + ' ' + r.name + ' ' + r.qty));
  if (!mine.length) return 0;
  let s = mine.filter(w => theirs.has(w) || [...theirs].some(t => t.length > 3 && (t.startsWith(w) || w.startsWith(t)))).length / mine.length;
  if (p.brand && r.brand && obfWords(p.brand).some(w => obfWords(r.brand).includes(w))) s += 0.15;
  const a = num(p.netG), b = parseWeightG(r.qty || '');
  if (a && b) s += Math.abs(a - b) < 1 ? 0.15 : -0.15;
  return Math.max(0, Math.min(1, s));
}
function obfSearch(q) {
  if (OBFS[q]) return Promise.resolve(OBFS[q]);
  const wait = Math.max(0, obfLast + OBF_GAP - Date.now());
  FB && (FB.waitUntil = Date.now() + wait);
  return new Promise(res => setTimeout(res, wait)).then(() => {
    obfLast = Date.now();
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 12000);
    const u = 'https://world.openbeautyfacts.org/cgi/search.pl?action=process&json=1&search_simple=1&page_size=12&sort_by=unique_scans_n'
      + '&fields=code,product_name,product_name_de,brands,quantity,image_front_small_url&search_terms=' + encodeURIComponent(q);
    return fetch(u, { signal: ctl.signal }).then(r => { if (!r.ok) throw new Error(r.status === 429 || r.status === 503 ? 'busy' : 'http'); return r.json(); })
      .then(j => OBFS[q] = (j.products || []).map(x => ({ code: normEan(String(x.code || '')), name: (x.product_name_de || x.product_name || '').trim(),
        brand: (x.brands || '').split(',')[0].trim(), qty: x.quantity || '', img: x.image_front_small_url || '' })).filter(x => x.name && eanOK(x.code)))
      .finally(() => clearTimeout(t));
  });
}

function openFind(only) {
  const groups = noEanGroups(only);
  if (!groups.length) return toast(only ? 'This product already has a barcode.' : '✓ Every product already has a barcode.');
  FB = { groups, i: 0, linked: 0, q: '', res: null, busy: false, err: '', noBrand: false };
  const d = scanDlg('obfdlg'); if (!d.open) d.showModal();
  findStep();
}
function findStep() {
  const g = FB.groups[FB.i]; if (!g) return findDone();
  FB.noBrand = false; FB.q = obfQuery(g.p); FB.res = null; FB.err = '';
  drawFind(); runFind();
}
function runFind() {
  const q = FB.q.trim(); if (!q) return;
  const i = FB.i; FB.busy = true; FB.err = ''; drawFind();
  const tick = setInterval(() => { const w = $('#obfwait'); if (w) { const s = Math.ceil((FB.waitUntil - Date.now()) / 1000); w.textContent = s > 0 ? `Waiting ${s}s (Open Beauty Facts allows about 10 searches a minute)…` : 'Searching Open Beauty Facts…'; } }, 400);
  obfSearch(q).then(r => { if (!FB || FB.i !== i) return; const p = FB.groups[i].p;
      FB.res = r.map(x => Object.assign({ score: obfScore(p, x) }, x)).sort((a, b) => b.score - a.score).slice(0, 6); })
    .catch(e => { if (FB) FB.err = e.message === 'busy' ? 'Open Beauty Facts is busy right now. Wait a minute and try again.' : 'Open Beauty Facts couldn’t be reached. Check the connection and try again.'; })
    .finally(() => { clearInterval(tick); if (!FB || FB.i !== i) return; FB.busy = false; drawFind(); });
}
function drawFind() {
  const g = FB.groups[FB.i], p = g.p, n = FB.groups.length;
  const used = code => { const o = db.purchases.find(x => x.ean === code); return o && grpKey(o) !== g.key ? o : null; };
  const card = r => { const o = used(r.code), pc = Math.round(r.score * 100);
    return `<li class="obfr${r.score >= 0.75 ? ' good' : ''}">${r.img ? `<img src="${esc(r.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="noimg"></span>'}
      <span class="ox"><b class="notr">${esc(r.name)}</b><span class="sub notr">${esc([r.brand, r.qty].filter(Boolean).join(' · '))}</span><span class="mono notr">${esc(r.code)}</span>
      ${o ? `<span class="warnline">Already on “${esc(o.product)}”</span>` : ''}</span>
      <span class="oact"><span class="pill ${pc >= 75 ? 'ok' : pc >= 45 ? '' : 'warn'}">${pc}%</span><button type="button" class="btn sm" data-fb="link:${esc(r.code)}">Link</button></span></li>`; };
  scanDlg('obfdlg').innerHTML = `<div class="sdbody" tabindex="-1" autofocus><div class="eyebrow">Find barcodes · ${FB.i + 1} of ${n}${FB.linked ? ` · ${FB.linked} linked` : ''}</div>
    <h2 class="notr">${esc(p.product)}</h2>
    <p class="lead">${storeTag(p)}<span class="notr">${esc(p.brand || '')}</span>${num(p.netG) ? ' · ' + fG(num(p.netG)) : ''} · ${g.units} unit${g.units === 1 ? '' : 's'}${g.ids.length > 1 ? ` · ${g.ids.length} lines` : ''}</p>
    <div class="toolbar obfq"><input type="text" data-fbq value="${esc(FB.q)}" autocomplete="off" dir="ltr" placeholder="Brand and product name"><button type="button" class="btn ghost" data-fb="search"${FB.busy ? ' disabled' : ''}>Search</button></div>
    ${p.brand && !FB.noBrand ? `<button type="button" class="rlink" data-fb="nobrand"${FB.busy ? ' disabled' : ''}>Search without the brand</button>` : ''}
    <div class="obfres">${FB.busy ? `<p class="note" id="obfwait">Searching Open Beauty Facts…</p>`
      : FB.err ? `<p class="err">${esc(FB.err)}</p>`
      : FB.res && !FB.res.length ? '<p class="note">No matches found. Shorten the search (e.g. brand + two words) or skip this product.</p>'
      : FB.res ? `<ul class="obflist">${FB.res.map(card).join('')}</ul>` : ''}</div>
    <p class="note">Check the picture and size before linking. The barcode goes on every line of this product.</p>
    <div class="mact sdact obfnav"><button type="button" class="btn ghost" data-fb="back"${FB.i ? '' : ' disabled'}>Back</button><button type="button" class="btn ghost" data-fb="skip">Skip</button><button type="button" class="btn ghost full" data-fb="done">Done</button></div></div>`;
}
function findDone() {
  const n = FB ? FB.linked : 0; FB = null; scanDlg('obfdlg').close(); render();
  toast(n ? `✓ ${n} product${n === 1 ? '' : 's'} linked to a barcode` : 'No barcodes linked.');
}
document.addEventListener('click', e => {
  const o = e.target.closest('[data-obffind]');
  if (o) { e.preventDefault(); return openFind(o.dataset.obffind ? [o.dataset.obffind] : null); }
  const b = e.target.closest('[data-fb]'); if (!b || !FB || b.disabled) return;
  const [a, code] = b.dataset.fb.split(':'), g = FB.groups[FB.i];
  if (a === 'search') { const i = $('#obfdlg [data-fbq]'); FB.q = i ? i.value : FB.q; runFind(); }
  else if (a === 'nobrand') { FB.noBrand = true; FB.q = obfQuery(g.p, true); runFind(); }
  else if (a === 'skip') { FB.i++; findStep(); }
  else if (a === 'back') { FB.i = Math.max(0, FB.i - 1); findStep(); }
  else if (a === 'done') findDone();
  else if (a === 'link') {
    const other = db.purchases.find(x => x.ean === code && grpKey(x) !== g.key);
    if (other && !confirm(`Barcode ${code} is already on “${other.product}”.\n\nLink it to “${g.p.product}” as well?`)) return;
    linkEan(g.ids, code); FB.linked++;
    toast(`✓ ${g.p.product} · ${code}`);
    FB.i++; findStep();
  }
});
document.addEventListener('keydown', e => { if (FB && e.key === 'Enter' && e.target.matches && e.target.matches('[data-fbq]')) { e.preventDefault(); FB.q = e.target.value; runFind(); } });
document.addEventListener('input', e => { if (FB && e.target.matches && e.target.matches('[data-fbq]')) FB.q = e.target.value; });
document.addEventListener('close', e => { if (e.target.id === 'obfdlg' && FB) { const n = FB.linked; FB = null; if (n) render(); } }, true);
