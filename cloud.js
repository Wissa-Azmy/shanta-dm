/* ---------- cloud sync: Firebase Realtime Database over plain REST ----------
   No SDK and no server. Each record lives at ledgers/<ledger>/<collection>/<id>,
   so two people editing different records never overwrite each other.
   Sync = pull remote, re-apply local changes made since the last sync, push only those. */
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
  set(state, msg) { this.state = state; this.msg = msg || ''; renderFile(); const c = $('#cloudcard'); if (!c) return; if (this.on() || c.dataset.mode === 'on') c.outerHTML = this.settingsHTML(); else { const m = $('#cl_msg'); if (m) { m.textContent = this.msg; m.hidden = !this.msg; } } },

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
  async req(method, body, retry = true) {
    const url = `${this.cfg.dbUrl}/ledgers/${encodeURIComponent(this.cfg.ledger)}.json?auth=${encodeURIComponent(await this.token())}`;
    const { r, j } = await this.fetchJSON(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && retry && !/Permission denied/i.test(j && j.error || '')) { await this.token(true); return this.req(method, body, false); }
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
    this.set('off'); toast('Disconnected from the cloud. Your data stays on this device.');
  },
  schedule() { if (!this.on()) return; clearTimeout(this.timer); this.timer = setTimeout(() => this.sync(), 600); },
  async sync() {
    if (!this.on()) return;
    if (this.busy) { this.again = true; return; }
    this.busy = true; this.set('syncing');
    try {
      const merged = snapRemote(await this.req('GET'));
      const patch = snapDiff(snapLocal(db), this.base || emptySnap());
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
    return `<div class="cloudline"><div class="st"><span class="dot ${dot}"></span>${st}</div><p>${esc(this.cfg.email)} · ledger “${esc(this.cfg.ledger)}”${t ? ' · ' + t : ''}${this.msg ? '<br>' + esc(this.msg) : ''}</p>
      <div class="row"><button class="btn sm ghost" data-act="cloud-sync">Sync now</button></div></div>`;
  },
  rules(a, b) {
    const cond = `auth != null && (auth.token.email == '${a || 'you@example.com'}' || auth.token.email == '${b || 'friend@example.com'}')`;
    return JSON.stringify({ rules: { ledgers: { $ledger: { '.read': cond, '.write': cond } } } }, null, 2);
  },
  settingsHTML() {
    if (this.on()) return `<div class="card span2" id="cloudcard" data-mode="on"><h3>Shared cloud database</h3>
      <p class="note">Connected as <b>${esc(this.cfg.email)}</b> to ledger <b>“${esc(this.cfg.ledger)}”</b>. Every change is sent within a second and pulled every 20 seconds, so you and ${esc(db.settings.friendName)} see the same numbers. The file on disk still works as an extra backup.</p>
      <p class="note">${esc(this.cfg.dbUrl)}${this.msg ? ' · <b>' + esc(this.msg) + '</b>' : ''}</p>
      <div class="topact"><button class="btn" data-act="cloud-sync">Sync now</button><button class="btn ghost" data-act="cloud-off">Disconnect this device</button></div></div>`;
    return `<div class="card span2" id="cloudcard" data-mode="off"><h3>Share online: free cloud database (Firebase)</h3>
      <p class="note">Takes about 10 minutes, once. Free plan, no credit card, nothing to maintain. You both log in with your own email and password and work on the same ledger.</p>
      <ol class="setup">
        <li>Go to <b>console.firebase.google.com</b> → <b>Create a project</b> (you can switch Google Analytics off).</li>
        <li><b>Build → Authentication → Get started</b>, enable <b>Email/Password</b>. In the <b>Users</b> tab, add one user for you and one for ${esc(db.settings.friendName)}.</li>
        <li><b>Build → Realtime Database → Create database</b>, location <b>Belgium (europe-west1)</b>, start in <b>locked mode</b>. Open the <b>Rules</b> tab, paste the rules below (with your two emails), then <b>Publish</b>. Copy the database URL shown on the <b>Data</b> tab.</li>
        <li><b>Project settings</b> (gear icon) → <b>Your apps</b> → add a <b>Web</b> app (&lt;/&gt;) → copy the <b>apiKey</b> value.</li>
        <li>Fill in the form here and press Connect. ${esc(db.settings.friendName)} does the same on their phone or laptop with their own email and the same ledger name.</li>
      </ol>
      <div class="fgrid">
        <div class="f"><label>Your email</label><input id="cl_email" type="email" autocomplete="username" data-rules="1"></div>
        <div class="f"><label>Friend’s email (only for the rules)</label><input id="cl_email2" type="email" data-rules="1"></div>
        <div class="f span"><label>Database rules: paste into Realtime Database → Rules</label><textarea id="cl_rules" readonly rows="11" style="font:12px var(--mono)">${esc(this.rules())}</textarea><button class="btn sm ghost" style="align-self:flex-start" data-act="cloud-copy">Copy rules</button></div>
        <div class="f span"><label>Database URL</label><input id="cl_url" placeholder="e.g. https://shanta-dm-default-rtdb.europe-west1.firebasedatabase.app"></div>
        <div class="f"><label>Web API key</label><input id="cl_key" value="AIzaSyAa9fTvt1RxGFDGf1rWFLBB_gvVlaOkphM"></div>
        <div class="f"><label>Ledger name (same for both of you)</label><input id="cl_ledger" value="shared"></div>
        <div class="f"><label>Your password</label><input id="cl_pw" type="password" autocomplete="current-password"></div>
        <div class="f" style="justify-content:flex-end"><button class="btn" data-act="cloud-connect">Connect</button></div>
      </div>
      <div class="err" id="cl_msg"${this.msg ? '' : ' hidden'}>${esc(this.msg)}</div>
      <p class="note">The password is used once to log in and is not stored; the app keeps a login token on this device. The API key is not a secret; the rules are what keep your data private.</p></div>`;
  }
};

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act^="cloud-"]'); if (!t) return;
  const a = t.dataset.act;
  if (a === 'cloud-sync') { await Cloud.sync(); if (Cloud.state === 'ok') toast('Synced'); }
  if (a === 'cloud-off') { if (confirm('Disconnect this device from the shared cloud ledger?')) Cloud.disconnect(); }
  if (a === 'cloud-copy') { const ta = $('#cl_rules'); ta.select(); try { await navigator.clipboard.writeText(ta.value); } catch (x) { document.execCommand('copy'); } toast('Rules copied'); }
  if (a === 'cloud-connect') {
    const v = id => ($('#' + id) || {}).value || '';
    const f = { url: v('cl_url'), key: v('cl_key'), email: v('cl_email').trim(), pw: v('cl_pw'), ledger: v('cl_ledger') };
    if (!f.url || !f.key || !f.email || !f.pw) { Cloud.set('off', 'Fill in database URL, API key, email and password.'); return; }
    t.textContent = 'Connecting…';
    try { await Cloud.connect(f); toast('Connected. Your ledger is now shared.'); render(); }
    catch (x) { console.warn(x); Cloud.cfg = null; localStorage.removeItem('shanta-cloud'); Cloud.set('off', x.message); }
  }
});
document.addEventListener('input', e => {
  if (!e.target.dataset.rules) return;
  const ta = $('#cl_rules'); if (ta) ta.value = Cloud.rules($('#cl_email').value.trim(), $('#cl_email2').value.trim());
});
window.addEventListener('focus', () => Cloud.on() && Cloud.sync());
window.addEventListener('online', () => Cloud.on() && Cloud.sync());
