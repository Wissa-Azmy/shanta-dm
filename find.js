/* ---------- find barcodes by product name, and link them ----------
   Goes through the products that have no barcode yet, one at a time: searches dm's product search,
   Open Beauty Facts and Open Food Facts for brand + name, shows the closest matches with where each
   came from, and links the one you pick to every line of that product. Nothing is linked without a tap.
   dm products try dm first; the others try Open Beauty Facts first. Sources are tried in order until a
   close match turns up; "Search more sources" tries the rest. The open databases allow about
   10 name searches a minute and ask apps not to search while typing, so searches only run on demand
   and are spaced out. dm's search doesn't answer other sites, so it goes through the relay whose
   address is in Settings → Barcode search (dm-worker.js on Cloudflare). Without one, dm is tried
   directly and, when the browser blocks it, skipped for the session. */
const OBFS = {};            // search results per source + query, for this session
let FINDER = null, DMOFF = false;
const dmRelay = () => String(db.settings.dmProxy || '').trim().replace(/\/+$/, '');
const OBF_GAP = 6500;       // ms between two searches on the same open database
function offUrl(site, q) {
  return `https://world.${site}.org/cgi/search.pl?action=process&json=1&search_simple=1&page_size=12&sort_by=unique_scans_n`
    + '&fields=code,product_name,product_name_de,brands,quantity,image_front_small_url,image_small_url,image_front_url,image_url&search_terms=' + encodeURIComponent(q);
}
const offMap = j => (j.products || []).map(x => ({ code: normEan(String(x.code || '')), name: (x.product_name_de || x.product_name || '').trim(),
  brand: (x.brands || '').split(',')[0].trim(), qty: x.quantity || '', img: x.image_front_small_url || x.image_small_url || x.image_front_url || x.image_url || '' }));
const FSRC = {
  dm: { name: 'dm', gap: 0, last: 0,
    url: q => (dmRelay() ? dmRelay() + '/search' : 'https://product-search.services.dmtech.com/de/search') + '?pageSize=12&query=' + encodeURIComponent(q),
    map: j => (j.products || j.results || []).map(x => { const t = x.tileData || {}, ti = String(x.title || (t.title && t.title.tileHeadline) || '');
      const sz = ti.match(/,\s*([\d.,]+\s*(?:ml|l|g|kg|stück|st\.?|blatt|paar))\s*$/i);
      return { code: normEan(String(x.gtin || t.gtin || x.ean || '')), name: (sz ? ti.slice(0, sz.index) : ti).trim(), qty: sz ? sz[1] : '',
        brand: String(x.brandName || (t.brand && t.brand.name) || (typeof x.brand === 'string' ? x.brand : x.brand && x.brand.name) || ''),
        img: ((t.images || x.images || [])[0] || {}).tileSrc || x.imageUrl || '',
        price: (((t.price || {}).price || {}).current || {}).value || '' }; }) },
  obf: { name: 'Open Beauty Facts', gap: OBF_GAP, last: 0, url: q => offUrl('openbeautyfacts', q), map: offMap },
  off: { name: 'Open Food Facts', gap: OBF_GAP, last: 0, url: q => offUrl('openfoodfacts', q), map: offMap }
};

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
/* one search on one source; errors: 'busy' (rate limit), 'blocked' (dm refused this site, no relay),
   'relaysite' (the relay doesn't accept this site), 'relay' (the relay didn't answer), 'net' */
function srcSearch(k, q) {
  const S = FSRC[k], ck = k + '|' + q, relay = k === 'dm' && dmRelay();
  if (OBFS[ck]) return Promise.resolve(OBFS[ck]);
  const wait = Math.max(0, S.last + S.gap - Date.now());
  FINDER && (FINDER.waitUntil = Date.now() + wait);
  return new Promise(res => setTimeout(res, wait)).then(() => {
    S.last = Date.now();
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), k === 'dm' ? 8000 : 12000);
    return fetch(S.url(q), { signal: ctl.signal, credentials: 'omit' })
      .then(r => { if (!r.ok) throw new Error(r.status === 429 || r.status === 503 ? 'busy' : relay ? (r.status === 403 ? 'relaysite' : 'relay') : k === 'dm' && (r.status === 401 || r.status === 403) ? 'blocked' : 'net'); return r.json(); },
        e => { throw new Error(relay ? (e.name === 'AbortError' || navigator.onLine === false ? 'net' : 'relay') : k === 'dm' && e.name !== 'AbortError' && navigator.onLine !== false ? 'blocked' : 'net'); })
      .then(j => OBFS[ck] = S.map(j).filter(x => x.name && eanOK(x.code)).map(x => Object.assign(x, { src: k })))
      .finally(() => clearTimeout(t));
  });
}

function openFind(only) {
  const groups = noEanGroups(only);
  if (!groups.length) return toast(only ? 'This product already has a barcode.' : '✓ Every product already has a barcode.');
  FINDER = { groups, i: 0, linked: 0, q: '', res: null, tried: null, busy: false, errs: {}, noBrand: false, run: 0 };
  const d = scanDlg('obfdlg'); if (!d.open) d.showModal();
  findStep();
}
function findStep() {
  const g = FINDER.groups[FINDER.i]; if (!g) return findDone();
  FINDER.noBrand = false; FINDER.man = ''; FINDER.q = obfQuery(g.p); FINDER.res = null; FINDER.tried = null; FINDER.errs = {};
  drawFind(); runFind();
}
const srcOrder = p => (storeOf(p) === 'dm' ? ['dm', 'obf', 'off'] : ['obf', 'dm', 'off']).filter(k => k !== 'dm' || !DMOFF || dmRelay());
const srcLeft = () => srcOrder(FINDER.groups[FINDER.i].p).filter(k => !(FINDER.tried || []).includes(k));
/* tries the sources in order, merging results, until a close match turns up (or all of them with more) */
async function runFind(more) {
  const q = FINDER.q.trim(); if (!q) return;
  if (!more || FINDER.lastQ !== q || FINDER.lastI !== FINDER.i || !FINDER.tried) { FINDER.res = []; FINDER.tried = []; FINDER.errs = {}; FINDER.lastQ = q; FINDER.lastI = FINDER.i; }
  const i = FINDER.i, run = ++FINDER.run, p = FINDER.groups[i].p, live = () => FINDER && FINDER.run === run;
  FINDER.busy = true; drawFind();
  const tick = setInterval(() => { const w = $('#obfwait'); if (!w || !FINDER) return; const s = Math.ceil((FINDER.waitUntil - Date.now()) / 1000), n = FSRC[FINDER.cur] ? FSRC[FINDER.cur].name : '';
    w.textContent = s > 0 ? `Waiting ${s}s (${n} allows about 10 searches a minute)…` : `Searching ${n}…`; }, 400);
  try {
    for (const k of srcLeft()) {
      if (!live()) return;
      FINDER.cur = k; FINDER.tried.push(k); FINDER.waitUntil = 0; drawFind();
      try {
        const r = await srcSearch(k, q); if (!live()) return;
        r.forEach(x => { const o = FINDER.res.find(y => y.code === x.code);
          if (o) { if (o.src !== x.src && !o.also.includes(x.src)) o.also.push(x.src); if (!o.img && x.img) o.img = x.img; }
          else FINDER.res.push(Object.assign({ score: obfScore(p, x), also: [] }, x)); });
      } catch (e) {
        if (!live()) return;
        if (e.message === 'blocked') { DMOFF = true; FINDER.dmNote = true; }
        else FINDER.errs[k] = e.message;
      }
      FINDER.res.sort((a, b) => b.score - a.score);
      if (!more && FINDER.res.length && FINDER.res[0].score >= 0.8) break;
    }
  } finally {
    clearInterval(tick);
    if (live()) { FINDER.busy = false; FINDER.cur = ''; drawFind(); }
  }
}
const srcTag = k => `<span class="srctag ${k}">${esc(FSRC[k].name)}</span>`;
function drawFind() {
  const g = FINDER.groups[FINDER.i], p = g.p, n = FINDER.groups.length, res = (FINDER.res || []).slice(0, 8), left = FINDER.tried ? srcLeft() : [];
  const used = code => { const o = db.purchases.find(x => x.ean === code); return o && grpKey(o) !== g.key ? o : null; };
  const card = r => { const o = used(r.code), pc = Math.round(r.score * 100);
    return `<li class="obfr${r.score >= 0.75 ? ' good' : ''}">${r.img ? `<img src="${esc(r.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<span class=noimg>No photo</span>'">` : '<span class="noimg">No photo</span>'}
      <span class="ox"><b class="notr">${esc(r.name)}</b><span class="sub notr">${esc([r.brand, r.qty, r.price].filter(Boolean).join(' · '))}</span>
      <span class="srcline"><span class="mono notr">${esc(r.code)}</span>${[r.src, ...r.also].map(srcTag).join('')}</span><span class="chk"><a href="https://www.dm.de/search?query=${esc(r.code)}" target="_blank" rel="noopener">Check on dm</a>${r.src !== 'dm' ? `<a href="https://world.${r.src === 'off' ? 'openfoodfacts' : 'openbeautyfacts'}.org/product/${esc(r.code)}" target="_blank" rel="noopener">Open page</a>` : ''}</span>
      ${o ? `<span class="warnline">Already on “${esc(o.product)}”</span>` : ''}</span>
      <span class="oact"><span class="pill ${pc >= 75 ? 'ok' : pc >= 45 ? '' : 'warn'}">${pc}%</span><button type="button" class="btn sm" data-fb="link:${esc(r.code)}">Link</button></span></li>`; };
  const ERR = { busy: n => `${n} is busy right now. Wait a minute and try again.`,
    relay: () => 'The dm search relay didn’t answer. Check its address in Settings → Barcode search.',
    relaysite: () => 'The dm search relay doesn’t accept this site. Add the site to ALLOWED in the Worker.',
    net: n => `${n} couldn’t be reached. Check the connection and try again.` };
  const errs = Object.keys(FINDER.errs || {}).map(k => `<p class="err">${esc((ERR[FINDER.errs[k]] || ERR.net)(FSRC[k].name))}</p>`).join('');
  const dmNote = FINDER.dmNote ? '<p class="note">dm’s search needs the dm search relay. Set it up in Settings → Barcode search; until then only the open databases are used.</p>' : '';
  const moreBtn = !FINDER.busy && FINDER.tried && left.length ? `<button type="button" class="rlink" data-fb="more">Search more sources: ${left.map(k => FSRC[k].name).join(', ')}</button>` : '';
  scanDlg('obfdlg').innerHTML = `<div class="sdbody" tabindex="-1" autofocus><div class="eyebrow">Find barcodes · ${FINDER.i + 1} of ${n}${FINDER.linked ? ` · ${FINDER.linked} linked` : ''}</div>
    <h2 class="notr">${esc(p.product)}</h2>
    <p class="lead">${storeTag(p)}<span class="notr">${esc(p.brand || '')}</span>${num(p.netG) ? ' · ' + fG(num(p.netG)) : ''} · ${g.units} unit${g.units === 1 ? '' : 's'}${g.ids.length > 1 ? ` · ${g.ids.length} lines` : ''}</p>
    <div class="toolbar obfq"><input type="text" data-fbq value="${esc(FINDER.q)}" autocomplete="off" dir="ltr" placeholder="Brand and product name"><button type="button" class="btn ghost" data-fb="search"${FINDER.busy ? ' disabled' : ''}>Search</button></div>
    ${p.brand && !FINDER.noBrand ? `<button type="button" class="rlink" data-fb="nobrand"${FINDER.busy ? ' disabled' : ''}>Search without the brand</button>` : ''}
    <div class="obfres">${res.length ? `<ul class="obflist">${res.map(card).join('')}</ul>` : ''}
      ${FINDER.busy ? `<p class="note" id="obfwait">Searching ${esc(FSRC[FINDER.cur] ? FSRC[FINDER.cur].name : '')}…</p>`
      : FINDER.tried && !res.length && !errs ? '<p class="note">No matches found. Shorten the search (e.g. brand + two words) or skip this product.</p>' : ''}
      ${errs}${dmNote}${moreBtn}</div>
    <div class="obfman"><label for="fbman">Or type the barcode</label><div class="toolbar"><input id="fbman" type="text" inputmode="numeric" data-fbman value="${esc(FINDER.man || '')}" autocomplete="off" dir="ltr" placeholder="e.g. 4066447985290" maxlength="20"><button type="button" class="btn" data-fb="manual">Link</button></div></div>
    <p class="note">Check the picture and size before linking. The barcode goes on every line of this product.</p>
    <div class="mact sdact obfnav"><button type="button" class="btn ghost" data-fb="back"${FINDER.i ? '' : ' disabled'}>Back</button><button type="button" class="btn ghost" data-fb="skip">Skip</button><button type="button" class="btn ghost full" data-fb="done">Done</button></div></div>`;
}
function findDone() {
  const n = FINDER ? FINDER.linked : 0; FINDER = null; scanDlg('obfdlg').close(); render();
  toast(n ? `✓ ${n} product${n === 1 ? '' : 's'} linked to a barcode` : 'No barcodes linked.');
}
document.addEventListener('click', e => {
  const o = e.target.closest('[data-obffind]');
  if (o) { e.preventDefault(); return openFind(o.dataset.obffind ? [o.dataset.obffind] : null); }
  const b = e.target.closest('[data-fb]'); if (!b || !FINDER || b.disabled) return;
  let [a, code] = b.dataset.fb.split(':'); const g = FINDER.groups[FINDER.i];
  if (a === 'search') { const i = $('#obfdlg [data-fbq]'); FINDER.q = i ? i.value : FINDER.q; runFind(); }
  else if (a === 'more') runFind(true);
  else if (a === 'nobrand') { FINDER.noBrand = true; FINDER.q = obfQuery(g.p, true); runFind(); }
  else if (a === 'skip') { FINDER.i++; findStep(); }
  else if (a === 'back') { FINDER.i = Math.max(0, FINDER.i - 1); findStep(); }
  else if (a === 'done') findDone();
  else if (a === 'manual' || a === 'link') {
    if (a === 'manual') {
      const i = $('#obfdlg [data-fbman]'), raw = i ? i.value : (FINDER.man || '');
      code = normEan(raw);
      if (!code) { toast('⚠ Type the barcode first.'); if (i) i.focus(); return; }
      if (!/^\d{8,14}$/.test(code)) { toast('⚠ A barcode has 8 to 14 digits.'); if (i) i.focus(); return; }
      if (!eanOK(code) && !confirm(`${code} doesn’t look like a valid barcode (the last digit doesn’t match).\n\nLink it anyway?`)) return;
    }
    const other = db.purchases.find(x => x.ean === code && grpKey(x) !== g.key);
    if (other && !confirm(`Barcode ${code} is already on “${other.product}”.\n\nLink it to “${g.p.product}” as well?`)) return;
    linkEan(g.ids, code); FINDER.linked++;
    toast(`✓ ${g.p.product} · ${code}`);
    FINDER.i++; findStep();
  }
});
document.addEventListener('keydown', e => { if (FINDER && e.key === 'Enter' && e.target.matches && e.target.matches('[data-fbq]')) { e.preventDefault(); FINDER.q = e.target.value; runFind(); } });
document.addEventListener('input', e => { if (FINDER && e.target.matches && e.target.matches('[data-fbq]')) FINDER.q = e.target.value; });
document.addEventListener('close', e => { if (e.target.id === 'obfdlg' && FINDER) { const n = FINDER.linked; FINDER = null; if (n) render(); } }, true);
/* Settings → Barcode search → Test: one small search through the relay */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act="dmtest"]'); if (!b) return;
  const i = $('[data-set="dmProxy"]'); if (i) db.settings.dmProxy = i.value.trim();
  const base = dmRelay();
  if (!/^https:\/\//.test(base)) return toast('⚠ Paste the relay address first. It starts with https://');
  b.disabled = true; b.textContent = 'Testing…';
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 10000);
  fetch(base + '/search?pageSize=1&query=balea', { signal: ctl.signal, credentials: 'omit' })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(r.status === 403 ? 'site' : 'http ' + r.status)))
    .then(j => { const x = FSRC.dm.map(j)[0]; DMOFF = false;
      toast(x && x.code ? `✓ dm search works: ${x.brand} ${x.name} · ${x.code}` : '⚠ The relay answered, but dm returned no products.'); })
    .catch(e => toast(e.message === 'site' ? '⚠ The relay doesn’t accept this site. Add the site to ALLOWED in the Worker.' : e.name === 'AbortError' ? '⚠ The relay didn’t answer in time.' : '⚠ The relay didn’t answer. Check the address and that the Worker is deployed.'))
    .finally(() => { clearTimeout(t); b.disabled = false; b.textContent = 'Test'; });
});
/* typed barcode: kept while the results redraw, Enter links it */
document.addEventListener('input', e => { if (FINDER && e.target.matches && e.target.matches('[data-fbman]')) FINDER.man = e.target.value; });
document.addEventListener('keydown', e => { if (FINDER && e.key === 'Enter' && e.target.matches && e.target.matches('[data-fbman]')) { e.preventDefault(); const b = $('#obfdlg [data-fb="manual"]'); if (b) b.click(); } });
