/* ---------- cloud sync: Firebase Realtime Database over plain REST ----------
   No SDK and no server. Each record lives at ledgers/<ledger>/<collection>/<id>,
   so two people editing different records never overwrite each other.
   Sync = pull remote, re-apply local changes made since the last sync, push only those. */
const CLOUD = {
  dbUrl: 'https://shanta-dm-default-rtdb.europe-west1.firebasedatabase.app',
  apiKey: 'AIzaSyAa9fTvt1RxGFDGf1rWFLBB_gvVlaOkphM',
  ledger: 'shared',
  domain: 'shanta-dm.firebaseapp.com' // plain usernames become <username>@this-domain
};
const toEmail = u => { u = String(u || '').trim().toLowerCase(); return u.includes('@') ? u : u.replace(/[^a-z0-9._-]/g, '') + '@' + CLOUD.domain; };
const fDateTime = s => s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const userName = e => String(e || '').endsWith('@' + CLOUD.domain) ? e.slice(0, -CLOUD.domain.length - 1) : e;
const COLLS = ['shipments', 'purchases', 'sales', 'expenses', 'transfers'];
const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).filter(k => v[k] !== undefined && v[k] !== null).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
  : JSON.stringify(v);
const emptySnap = () => { const o = { settings: '' }; COLLS.forEach(c => o[c] = {}); return o; };
function snapLocal(d) { const o = { settings: stable(d.settings) }; COLLS.forEach(c => { o[c] = {}; d[c].forEach(r => o[c][r.id] = stable(r)); }); return o; }
function snapRemote(r) {
  r = r || {};
  const o = { settings: r.settings ? stable(Object.assign(DEFAULT_DB().settings, r.settings)) : '' };
  COLLS.forEach(c => { o[c] = {}; Object.entries(r[c] || {}).forEach(([id, rec]) => o[c][id] = stable(Object.assign({ id }, rec))); });
  return o;
}
function snapDiff(cur, base) {
  const p = {};
  if (cur.settings && cur.settings !== base.settings) p.settings = JSON.parse(cur.settings);
  COLLS.forEach(c => {
    Object.entries(cur[c]).forEach(([id, s]) => { if (base[c][id] !== s) p[c + '/' + id] = JSON.parse(s); });
    Object.keys(base[c]).forEach(id => { if (!(id in cur[c])) p[c + '/' + id] = null; });
  });
  return p;
}
function snapApply(s, patch) {
  Object.entries(patch).forEach(([k, v]) => {
    if (k === 'settings') { s.settings = stable(v); return; }
    const [c, id] = k.split('/');
    if (v === null) delete s[c][id]; else s[c][id] = stable(v);
  });
  return s;
}
const snapToData = s => { const o = { settings: s.settings ? JSON.parse(s.settings) : db.settings }; COLLS.forEach(c => o[c] = Object.values(s[c]).map(x => JSON.parse(x))); return o; };
const snapHasData = s => COLLS.some(c => Object.keys(s[c]).length);

function authMsg(code) {
  code = String(code || '');
  if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(code)) return 'Wrong email or password. Check the user exists under Authentication → Users.';
  if (/API_KEY|API key/i.test(code)) return 'The Web API key is not valid. Copy it again from Project settings.';
  if (/OPERATION_NOT_ALLOWED/.test(code)) return 'Email/Password sign-in is not enabled yet (Authentication → Sign-in method).';
  if (/TOO_MANY_ATTEMPTS/.test(code)) return 'Too many attempts. Wait a few minutes and try again.';
  if (/USER_DISABLED/.test(code)) return 'This user is disabled in Firebase.';
  return 'Sign-in failed: ' + code;
}
const netMsg = 'Couldn’t reach Firebase. Check your internet connection. If you’re using the preview inside Dia, it may block network access; use the hosted copy of the app instead.';

const Cloud = {
  cfg: JSON.parse(localStorage.getItem('shanta-cloud') || 'null'),
  base: JSON.parse(localStorage.getItem('shanta-cloud-base') || 'null'),
  state: 'off', msg: '', last: null, busy: false, again: false, timer: null,
  on() { return !!(this.cfg && this.cfg.refreshToken); },
  saveCfg() { localStorage.setItem('shanta-cloud', JSON.stringify(this.cfg)); },
  saveBase() { localStorage.setItem('shanta-cloud-base', JSON.stringify(this.base)); },
  set(state, msg) { this.state = state; this.msg = msg || ''; renderFile(); const c = $('#cloudcard'); if (c) { if (this.on() !== (c.dataset.mode === 'on')) { c.outerHTML = this.settingsHTML(); this.fillBackups(); } else { const m = $('#cl_msg'); if (m) { m.textContent = this.msg; m.hidden = !this.msg; } } } const gm = $('#g_msg'); if (gm) { gm.textContent = this.msg; gm.hidden = !this.msg; } },

  async fetchJSON(url, opts) {
    let r; try { r = await fetch(url, opts); } catch (e) { const x = new Error(netMsg); x.net = true; throw x; }
    let j = null; try { j = await r.json(); } catch (e) { }
    return { r, j };
  },
  async signIn(dbUrl, apiKey, email, password, ledger) {
    const { r, j } = await this.fetchJSON('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(apiKey),
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
    if (!r.ok) throw new Error(authMsg(j && j.error && j.error.message));
    this.cfg = { dbUrl: dbUrl.trim().replace(/\/+$/, ''), apiKey: apiKey.trim(), email, ledger: (ledger || 'shared').trim().replace(/[.#$\[\]\/]/g, '-'),
      refreshToken: j.refreshToken, idToken: j.idToken, exp: Date.now() + (num(j.expiresIn) - 60) * 1000 };
    this.saveCfg();
  },
  async token(force) {
    if (!force && this.cfg.idToken && Date.now() < this.cfg.exp) return this.cfg.idToken;
    const { r, j } = await this.fetchJSON('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(this.cfg.apiKey),
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(this.cfg.refreshToken) });
    if (!r.ok) { const e = new Error('Your cloud login expired. Please connect again.'); e.auth = true; throw e; }
    Object.assign(this.cfg, { idToken: j.id_token, refreshToken: j.refresh_token, exp: Date.now() + (num(j.expires_in) - 60) * 1000 });
    this.saveCfg(); return j.id_token;
  },
  async req(method, body, retry = true, path) {
    const seg = String(path || this.cfg.ledger).split('/').map(encodeURIComponent).join('/');
    const url = `${this.cfg.dbUrl}/ledgers/${seg}.json?auth=${encodeURIComponent(await this.token())}`;
    const { r, j } = await this.fetchJSON(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && retry && !/Permission denied/i.test(j && j.error || '')) { await this.token(true); return this.req(method, body, false, path); }
    if (!r.ok) {
      const m = j && j.error || r.status;
      if (/Permission denied/i.test(m) || r.status === 401) { const e = new Error('Permission denied. Make sure the database rules list your email (' + this.cfg.email + ').'); e.auth = true; throw e; }
      if (r.status === 404) throw new Error('Database not found. Check the database URL.');
      throw new Error('Cloud error: ' + m);
    }
    return j;
  },

  async connect(f) {
    if (!/^https:\/\/.+(firebaseio\.com|firebasedatabase\.app)/.test(f.url.trim())) throw new Error('The database URL should look like https://your-project-default-rtdb.europe-west1.firebasedatabase.app');
    await this.signIn(f.url, f.key, f.email, f.pw, f.ledger);
    const rs = snapRemote(await this.req('GET'));
    const local = snapLocal(db);
    if (snapHasData(rs) && snapHasData(local) && !confirm('The shared ledger in the cloud already has data.\n\nOK = also add the entries from this browser to it\nCancel = use only the cloud data on this device')) {
      this.base = rs; Object.assign(db, snapToData(rs)); persistLocal();
    } else this.base = emptySnap();
    this.saveBase();
    await this.sync();
    this.startPolling();
  },
  disconnect() {
    this.cfg = null; this.base = null; this.stopPolling();
    localStorage.removeItem('shanta-cloud'); localStorage.removeItem('shanta-cloud-base');
    this.set('off'); toast('Signed out. Your data stays on this device.'); localStorage.removeItem('shanta-offline'); showGate();
  },
  schedule() { if (!this.on()) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), 600); },
  async sync() {
    if (!this.on()) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true; this.set('syncing');
    try {
      const raw = await this.req('GET');
      const merged = snapRemote(raw);
      const patch = snapDiff(snapLocal(db), this.base || emptySnap());
      if (!merged.settings && !patch.settings) patch.settings = JSON.parse(stable(db.settings));
      const dels = Object.values(patch).filter(v => v === null).length;
      if (dels >= 3) await this.snapshot(`Automatic backup before deleting ${dels} entries`, raw);
      snapApply(merged, patch);
      if (Object.keys(patch).length) await this.req('PATCH', patch);
      if (stable(merged) !== stable(snapLocal(db))) { Object.assign(db, snapToData(merged)); persistLocal(); render(); }
      this.base = merged; this.saveBase();
      this.last = new Date(); this.set('ok');
    } catch (e) {
      console.warn(e); this.set(e.auth ? 'error' : 'offline', e.message);
    } finally {
      this.busy = false;
      if (this.again) { this.again = false; this.sync(); }
    }
  },

  /* ---- backups: a backup is a full copy stored as its own ledger, listed in shared/_backups ---- */
  async snapshot(reason, raw) {
    raw = raw || await this.req('GET') || {};
    const counts = {}; COLLS.forEach(c => counts[c] = Object.keys(raw[c] || {}).length);
    if (!COLLS.some(c => counts[c])) return null;
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const name = `backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const copy = Object.assign({}, raw); delete copy._backups;
    copy._meta = { backupOf: this.cfg.ledger, createdAt: d.toISOString(), by: this.cfg.email, reason };
    await this.req('PUT', copy, true, name);
    const check = await this.req('GET', null, true, name) || {};
    if (COLLS.some(c => Object.keys(check[c] || {}).length !== counts[c])) throw new Error('The backup could not be verified, so nothing was deleted.');
    await this.req('PATCH', { [name]: { createdAt: d.toISOString(), by: this.cfg.email, reason, from: this.cfg.ledger, counts } }, true, CLOUD.ledger + '/_backups');
    this.backups = null;
    return name;
  },
  async backupAndClear(reason) {
    await this.sync();
    if (this.state !== 'ok') throw new Error('Couldn’t reach the cloud, so nothing was deleted. ' + this.msg);
    this.busy = true;
    try {
      const name = await this.snapshot(reason);
      const wipe = {}; COLLS.forEach(c => wipe[c] = null);
      await this.req('PATCH', wipe);
      const s = db.settings; db = DEFAULT_DB(); db.settings = s; persistLocal();
      this.base = snapLocal(db); this.saveBase();
      return name;
    } finally { this.busy = false; }
  },
  async listBackups() {
    const o = await this.req('GET', null, true, CLOUD.ledger + '/_backups') || {};
    this.backups = Object.entries(o).map(([name, v]) => Object.assign({ name }, v)).sort((a, b) => b.name.localeCompare(a.name));
    return this.backups;
  },
  async openLedger(name) {
    await this.sync();
    if (this.state !== 'ok') throw new Error('Couldn’t reach the cloud. ' + this.msg);
    this.busy = true;
    try {
      const rs = snapRemote(await this.req('GET', null, true, name));
      this.cfg.ledger = name; this.saveCfg();
      const s = db.settings; Object.assign(db, snapToData(rs)); if (!rs.settings) db.settings = s;
      persistLocal(); this.base = rs; this.saveBase();
      this.last = new Date();
    } finally { this.busy = false; }
    this.set('ok'); render();
  },
  isBackup() { return this.on() && this.cfg.ledger !== CLOUD.ledger; },
  bannerHTML() {
    if (!this.isBackup()) return '';
    const b = (this.backups || []).find(x => x.name === this.cfg.ledger);
    return `<div class="bkbanner"><span>📦 You are looking at a <b>backup</b>${b ? ' from ' + esc(fDateTime(b.createdAt)) : ' (' + esc(this.cfg.ledger) + ')'}. Changes here only affect this backup.</span><button class="btn sm" data-act="cloud-live">Back to the live ledger</button></div>`;
  },
  backupsHTML() {
    const list = this.backups;
    const cur = this.cfg.ledger;
    return `<div class="bklist"><h4>Ledger in use: ${cur === CLOUD.ledger ? '<span class="pill ok">Live (shared)</span>' : '<span class="pill warn">Backup</span>'}</h4>
      ${list === undefined || list === null ? '<p class="note">Loading backups…</p>' : !list.length ? '<p class="note">No backups yet. One is made automatically before data is cleared or many entries are deleted at once.</p>' :
      `<ul class="mini">${list.map(b => `<li><span><b>${esc(fDateTime(b.createdAt))}</b><span class="sub note">${esc(b.reason || '')} · ${COLLS.reduce((a, c) => a + num(b.counts && b.counts[c]), 0)} entries · by ${esc(userName(b.by || ''))}</span></span>
        <span class="r">${b.name === cur ? '<span class="pill warn">Open</span>' : `<button class="btn sm ghost" data-act="cloud-open" data-ledger="${esc(b.name)}">Open</button>`}</span></li>`).join('')}</ul>`}
      ${cur !== CLOUD.ledger ? '<button class="btn sm" data-act="cloud-live">Back to the live ledger</button>' : ''}</div>`;
  },
  async fillBackups() {
    const el = $('#cl_backups'); if (!el || !this.on()) return;
    el.innerHTML = this.backupsHTML();
    try { await this.listBackups(); } catch (e) { this.backups = []; }
    const el2 = $('#cl_backups'); if (el2) el2.innerHTML = this.backupsHTML();
  },
  startPolling() {
    this.stopPolling();
    this.poll = setInterval(() => { if (document.visibilityState === 'visible') this.sync(); }, 20000);
  },
  stopPolling() { clearInterval(this.poll); },

  statusHTML() {
    if (!this.on()) return '';
    const t = this.last ? this.last.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    const map = { syncing: ['', 'Syncing…'], ok: ['ok', 'Shared in the cloud'], offline: ['bad', 'Offline, will retry'], error: ['bad', 'Cloud needs attention'], off: ['', 'Cloud'] };
    const [dot, st] = map[this.state] || map.off;
    return `<div class="cloudline"><div class="st"><span class="dot ${dot}"></span>${st}</div><p>${esc(userName(this.cfg.email))}${t ? ' · ' + t : ''}${this.msg ? '<br>' + esc(this.msg) : ''}</p>
      <div class="row"><button class="btn sm ghost" data-act="cloud-sync">Sync now</button></div></div>`;
  },
  rules(a, b) {
    const cond = `auth != null && (auth.token.email == '${toEmail(a || 'you@example.com')}' || auth.token.email == '${toEmail(b || 'friend@example.com')}')`;
    return JSON.stringify({ rules: { ledgers: { $ledger: { '.read': cond, '.write': cond } } } }, null, 2);
  },
  loginFields(p) {
    return `<div class="f"><label for="${p}_user">Email</label><input id="${p}_user" type="email" inputmode="email" autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false"></div>
      <div class="f"><label for="${p}_pw">Password</label><input id="${p}_pw" type="password" autocomplete="current-password"></div>`;
  },
  settingsHTML() {
    if (this.on()) return `<div class="card span2" id="cloudcard" data-mode="on"><h3>Shared online ledger</h3>
      <p class="note">Signed in as <b>${esc(userName(this.cfg.email))}</b>. Every change is sent within a second and pulled every 20 seconds, so you and ${esc(db.settings.friendName)} see the same numbers. The file on disk still works as an extra backup.</p>
      ${this.msg ? `<p class="note"><b>${esc(this.msg)}</b></p>` : ''}
      <div class="topact"><button class="btn" data-act="cloud-sync">Sync now</button><button class="btn ghost" data-act="cloud-off">Sign out on this device</button></div>
      <div id="cl_backups"></div>
      ${this.adminHTML()}</div>`;
    return `<div class="card span2" id="cloudcard" data-mode="off"><h3>Sign in to the shared ledger</h3>
      <p class="note">Sign in so you and ${esc(db.settings.friendName)} work on the same numbers from any phone or laptop.</p>
      <form class="fgrid" data-login="cl">${this.loginFields('cl')}<div class="f span"><button class="btn" style="align-self:flex-start">Sign in</button></div></form>
      <div class="err" id="cl_msg"${this.msg ? '' : ' hidden'}>${esc(this.msg)}</div>
      ${this.adminHTML()}</div>`;
  },
  adminHTML() {
    return `<details class="admin"><summary>Admin: add a person or update the access rules</summary>
      <ol class="setup">
        <li>In the Firebase console open <b>Authentication → Users → Add user</b>. Enter the person’s email address and choose a password for them.</li>
        <li>Type both email addresses below, copy the rules, paste them into <b>Realtime Database → Rules</b> and press <b>Publish</b>.</li>
        <li>Send the person the app link with their email and password. That is all they need.</li>
      </ol>
      <div class="fgrid">
        <div class="f"><label>Your email</label><input id="ad_a" type="email" data-rules="1" autocapitalize="none"></div>
        <div class="f"><label>Friend’s email</label><input id="ad_b" type="email" data-rules="1" autocapitalize="none"></div>
        <div class="f span"><textarea id="cl_rules" readonly rows="11" style="font:12px var(--mono)">${esc(this.rules())}</textarea><button type="button" class="btn sm ghost" style="align-self:flex-start" data-act="cloud-copy">Copy rules</button></div>
      </div>
      <p class="note">Forgotten password: in Firebase open Users, click ⋮ next to the person and choose Reset password; they get an email to set a new one. Nothing in the ledger is lost.</p></details>`;
  }
};

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act^="cloud-"]'); if (!t) return;
  const a = t.dataset.act;
  if (a === 'cloud-sync') { await Cloud.sync(); if (Cloud.state === 'ok') toast('Synced'); }
  if (a === 'cloud-off') { if (confirm('Disconnect this device from the shared cloud ledger?')) Cloud.disconnect(); }
  if (a === 'cloud-copy') { const ta = $('#cl_rules'); ta.select(); try { await navigator.clipboard.writeText(ta.value); } catch (x) { document.execCommand('copy'); } toast('Rules copied'); }
  if (a === 'cloud-skip') { localStorage.setItem('shanta-offline', '1'); hideGate(); }
  if (a === 'cloud-open' || a === 'cloud-live') {
    const name = a === 'cloud-live' ? CLOUD.ledger : t.dataset.ledger;
    t.disabled = true; t.textContent = 'Opening…';
    try { await Cloud.openLedger(name); toast(name === CLOUD.ledger ? 'Back on the live ledger' : 'Backup opened'); go(name === CLOUD.ledger ? 'overview' : view); }
    catch (x) { toast(x.message); render(); }
  }
});

/* Clear / replace everything, but never without a backup first */
async function safeReplace(question, fill) {
  const has = COLLS.some(c => db[c].length);
  if (Cloud.on()) {
    if (has && !confirm(question + '\n\nA full copy of the current ledger is saved first. You can open it any time under Settings → Shared online ledger.')) return;
    try {
      toast('Saving a backup…');
      const name = await Cloud.backupAndClear(question.replace(/\?$/, ''));
      if (fill) fill();
      commit(); go('overview');
      toast(name ? 'Done. A backup was saved first.' : 'Done.');
    } catch (x) { console.warn(x); alert(x.message); }
    return;
  }
  if (has && !confirm(question + '\n\nA backup file of the current data will be downloaded first.')) return;
  if (has) downloadJSON();
  const s = db.settings; db = DEFAULT_DB(); db.settings = s;
  if (fill) fill();
  commit(); go('overview');
}
V.settings.after = () => Cloud.fillBackups();
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act="reset"],[data-act="demo"]'); if (!t) return;
  e.stopImmediatePropagation();
  if (t.dataset.act === 'reset') safeReplace('Clear all shipments, purchases, sales, expenses and transfers?');
  else safeReplace('Replace all data with sample data?', () => { const d = demoData(); COLLS.forEach(c => db[c] = d[c]); });
}, true);
document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-login]'); if (!form) return;
  e.preventDefault();
  const p = form.dataset.login, user = $('#' + p + '_user').value.trim(), pw = $('#' + p + '_pw').value;
  const btn = form.querySelector('button');
  if (!user || !pw) { Cloud.set('off', 'Please type your email and password.'); return; }
  if (!user.includes('@')) { Cloud.set('off', 'Please type your full email address.'); return; }
  btn.textContent = 'Signing in…'; btn.disabled = true;
  try {
    await Cloud.connect({ url: CLOUD.dbUrl, key: CLOUD.apiKey, email: toEmail(user), pw, ledger: CLOUD.ledger });
    localStorage.removeItem('shanta-offline'); hideGate();
    toast('Welcome, ' + userName(Cloud.cfg.email)); render();
  } catch (x) {
    console.warn(x); Cloud.cfg = null; localStorage.removeItem('shanta-cloud');
    Cloud.set('off', /Wrong email or password/.test(x.message) ? 'Wrong email or password.' : x.message);
    btn.textContent = 'Sign in'; btn.disabled = false;
  }
});
document.addEventListener('input', e => {
  if (!e.target.dataset.rules) return;
  const ta = $('#cl_rules'); if (ta) ta.value = Cloud.rules($('#ad_a').value.trim(), $('#ad_b').value.trim());
});

/* ---------- full-screen sign-in on first open ---------- */
function showGate() {
  if ($('#gate')) return;
  const g = document.createElement('div'); g.id = 'gate';
  g.innerHTML = `<div class="gatebox"><div class="logo">€<span>⇄</span>£E</div><h1>Shanta</h1><p class="note">Sign in to open the shared ledger</p>
    <form data-login="g">${Cloud.loginFields('g')}<button class="btn">Sign in</button></form>
    <div class="err" id="g_msg" hidden></div>
    <button type="button" class="linkbtn" data-act="cloud-skip">Use without signing in on this device</button></div>`;
  document.body.appendChild(g);
  setTimeout(() => $('#g_user') && $('#g_user').focus(), 50);
}
function hideGate() { const g = $('#gate'); if (g) g.remove(); }
if (!Cloud.on() && !localStorage.getItem('shanta-offline')) showGate();
window.addEventListener('focus', () => Cloud.on() && Cloud.sync());
window.addEventListener('online', () => Cloud.on() && Cloud.sync());
