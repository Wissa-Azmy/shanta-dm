/* ---------- cloud: Firebase Firestore with the official SDK ----------
   Each record is a document at ledgers/<ledger>/<collection>/<id>; settings are one document at
   ledgers/<ledger>/meta/settings. The SDK keeps a copy on the device, sends changes as soon as it
   can (also after the app was closed offline) and pushes the other device's changes live.
   The app keeps working on its own `db` object: every commit() sends what differs from Firestore,
   field by field, and every change Firestore reports is copied back into `db`. */
const FB_VER = '13.1.0', FB = s => `https://www.gstatic.com/firebasejs/${FB_VER}/firebase-${s}.js`;
const CLOUD = {
  projectId: 'shanta-dm',
  authDomain: 'shanta-dm.firebaseapp.com',
  apiKey: (window.SHANTA_FIREBASE || {}).apiKey || '',   // in firebase-config.js
  dbUrl: 'https://shanta-dm-default-rtdb.europe-west1.firebasedatabase.app', // old database, read once to move the data
  ledger: 'shared',
  domain: 'shanta-dm.firebaseapp.com' // plain usernames become <username>@this-domain
};
const toEmail = u => { u = String(u || '').trim().toLowerCase(); return u.includes('@') ? u : u.replace(/[^a-z0-9._-]/g, '') + '@' + CLOUD.domain; };
const fDateTime = s => s ? new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const userName = e => String(e || '').endsWith('@' + CLOUD.domain) ? e.slice(0, -CLOUD.domain.length - 1) : e;
const COLLS = ['shipments', 'purchases', 'sales', 'payments', 'expenses', 'transfers'];
const stable = v => Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
  : v && typeof v === 'object' ? '{' + Object.keys(v).filter(k => v[k] !== undefined && v[k] !== null).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
  : JSON.stringify(v);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const within = (p, ms, msg) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(Object.assign(new Error(msg), { timeout: true })), ms))]);

/* ---- reading less ----
   Firestore bills one read per document it sends. Reopening after more than 30 minutes used to resend the
   whole ledger (~800 reads). Now every entry carries _t (when it last changed, set by the server) and
   deletions are listed in meta/deleted, so a device asks only for what changed since its last sync.
   A full download still happens on the first sync, every 3 days, and after switching ledgers. */
const SYNC_KEY = 'shanta-cloud-sync';            // { ledger, since: {coll: ms}, full: ms }
const FULL_EVERY = 3 * 864e5, SINCE_MARGIN = 2 * 6e4, DEL_KEEP = 10 * 864e5;
const delRef = l => F.S.doc(F.fs, 'ledgers', l, 'meta', 'deleted');
const tMs = v => v && typeof v.toMillis === 'function' ? v.toMillis() : 0;
const cleanDoc = (d, id) => { const o = Object.assign({}, d, { id }); delete o._t; return o; };

/* ---- changes not confirmed by the cloud yet ----
   Every entry this device saves stays in this list (on the device) until Firestore confirms it. If Firestore
   refuses a save, it takes the entries back out of its own copy; without this list that looked like "the cloud
   doesn't have them" and they vanished from the screen too. Now they stay visible, are sent again, and are
   always added when the device reconnects, without asking. Keys: "<coll>/<id>" → entry (or null = deleted),
   "settings/<key>" → value */
const OUT_KEY = 'shanta-outbox';
const Outbox = {
  load() { try { const o = JSON.parse(localStorage.getItem(OUT_KEY) || 'null'); return o && o.items ? o : { ledger: '', items: {} }; } catch (e) { return { ledger: '', items: {} }; } },
  items(l) { const o = this.load(); return o.ledger === l ? o.items : {}; },
  save(l, items) { try { if (Object.keys(items).length) localStorage.setItem(OUT_KEY, JSON.stringify({ ledger: l, items })); else localStorage.removeItem(OUT_KEY); } catch (e) { } },
  add(l, vals) { const it = this.items(l); Object.assign(it, vals); this.save(l, it); },
  /* confirmed: drop what was sent, unless it changed again since */
  done(l, sent) { const it = this.items(l); Object.entries(sent).forEach(([k, s]) => { if (k in it && stable(it[k]) === s) delete it[k]; }); this.save(l, it); },
  count(l) { return Object.keys(this.items(l)).length; },
  has(l, k) { return k in this.items(l); },
  /* lay the waiting changes over a copy of the cloud */
  over(s, l) { Object.entries(this.items(l)).forEach(([k, v]) => { const [c, id] = k.split('/');
    if (c === 'settings') { if (v === null) delete s.settings[id]; else s.settings[id] = stable(v); }
    else if (s[c]) { if (v === null) delete s[c][id]; else s[c][id] = stable(v); } }); return s; }
};
/* reads made by this device today, counted from what Firestore sends (an estimate of the bill) */
const Reads = {
  get() { try { const r = JSON.parse(localStorage.getItem('shanta-reads') || 'null'); return r && r.day === today() ? r : { day: today(), n: 0 }; } catch (e) { return { day: today(), n: 0 }; } },
  add(n) { if (!(n > 0)) return; const r = this.get(); r.n += n; try { localStorage.setItem('shanta-reads', JSON.stringify(r)); } catch (e) { } },
  /* a listener: the first answer from the server costs every document sent (at least 1), later ones the changes.
     A single document (settings, deletions) has no list of changes: 1 per update from the server */
  snap(snap, seen, key, all) {
    if (snap.metadata.fromCache) return;
    if (typeof snap.docChanges !== 'function') {
      if (!seen[key] || !snap.metadata.hasPendingWrites) { seen[key] = true; this.add(1); }
      return;
    }
    if (!seen[key]) { seen[key] = true; this.add(Math.max(1, all ? snap.size : snap.docChanges().length)); }
    else this.add(snap.docChanges().length);
  }
};

/* ---- snapshots: { settings: {key: json}, <coll>: {id: json} }, compared as strings ---- */
/* 'autosave' belongs to this device only */
const LOCAL_KEYS = ['autosave'];
const emptySnap = () => { const o = { settings: {} }; COLLS.forEach(c => o[c] = {}); return o; };
const cloneSnap = s => { const o = { settings: Object.assign({}, s.settings) }; COLLS.forEach(c => o[c] = Object.assign({}, s[c] || {})); return o; };
function snapSettings(s) { const o = {}; Object.entries(s || {}).forEach(([k, v]) => { if (!LOCAL_KEYS.includes(k) && v !== undefined && v !== null) o[k] = stable(v); }); return o; }
function snapLocal(d) { const o = { settings: snapSettings(d.settings) }; COLLS.forEach(c => { o[c] = {}; d[c].forEach(r => o[c][r.id] = stable(r._t === undefined ? r : cleanDoc(r, r.id))); }); return o; }
const hasVal = (o, k) => o[k] !== undefined && o[k] !== null;
function fieldDiff(a, b, path, p) {
  new Set(Object.keys(a).concat(Object.keys(b))).forEach(k => {
    if (stable(hasVal(a, k) ? a[k] : null) !== stable(hasVal(b, k) ? b[k] : null)) p[path + '/' + k] = hasVal(a, k) ? a[k] : null;
  });
}
/* what changed from base to cur, as paths: settings/<key>, <coll>/<id> (whole entry or null), <coll>/<id>/<field> */
function snapDiff(cur, base, remote) {
  const p = {};
  Object.entries(cur.settings).forEach(([k, s]) => { if (base.settings[k] !== s) p['settings/' + k] = JSON.parse(s); });
  COLLS.forEach(c => {
    Object.entries(cur[c]).forEach(([id, s]) => {
      if (base[c][id] === s) return;
      /* new here, or deleted on the other device meanwhile: send the whole entry */
      if (!(id in base[c]) || (remote && !(id in remote[c]))) p[c + '/' + id] = JSON.parse(s);
      else fieldDiff(JSON.parse(s), JSON.parse(base[c][id]), c + '/' + id, p);
    });
    Object.keys(base[c]).forEach(id => { if (!(id in cur[c])) p[c + '/' + id] = null; });
  });
  return p;
}
function snapApply(s, patch) {
  Object.entries(patch).forEach(([k, v]) => {
    const [c, id, f] = k.split('/');
    if (c === 'settings') { if (v === null) delete s.settings[id]; else s.settings[id] = stable(v); return; }
    if (f !== undefined) {
      if (!(id in s[c])) return;
      const r = JSON.parse(s[c][id]); if (v === null) delete r[f]; else r[f] = v; s[c][id] = stable(r);
    } else if (v === null) delete s[c][id]; else s[c][id] = stable(v);
  });
  return s;
}
/* bases saved by older versions stored settings as one string: take the cloud's values instead of pushing ours */
function fixBase(base, remote) { if (base && typeof base.settings !== 'object') base.settings = Object.assign({}, remote.settings); return base; }
const snapHasData = s => COLLS.some(c => Object.keys(s[c]).length);

function authMsg(code) {
  code = String(code || '');
  if (/invalid-credential|wrong-password|user-not-found|invalid-email|INVALID_LOGIN/.test(code)) return 'Wrong email or password. Check the user exists under Authentication → Users.';
  if (/api-key/i.test(code)) return 'The Web API key is not valid. Copy it again from Project settings.';
  if (/operation-not-allowed/.test(code)) return 'Email/Password sign-in is not enabled yet (Authentication → Sign-in method).';
  if (/too-many-requests/.test(code)) return 'Too many attempts. Wait a few minutes and try again.';
  if (/user-disabled/.test(code)) return 'This user is disabled in Firebase.';
  if (/network-request-failed/.test(code)) return netMsg;
  return 'Sign-in failed: ' + code;
}
const netMsg = 'Couldn’t reach Firebase. Check your internet connection. If you’re using the preview inside Dia, it may block network access; use the hosted copy of the app instead.';
const offlineMsg = 'Offline: changes are saved on this device and sent when the connection is back.';
const rulesMsg = () => `Firestore refused access. Check that the Firestore database exists and its rules list your email (${Cloud.cfg ? Cloud.cfg.email : ''}). See “Admin” below.`;

/* the Firebase SDK, loaded on first use */
let F = null;
function fb() {
  if (F) return Promise.resolve(F);
  return fb.p || (fb.p = (async () => {
    const [A, U, S] = await Promise.all([import(FB('app')), import(FB('auth')), import(FB('firestore'))]);
    const app = A.initializeApp({ apiKey: CLOUD.apiKey, authDomain: CLOUD.authDomain, projectId: CLOUD.projectId, databaseURL: CLOUD.dbUrl });
    const auth = U.getAuth(app);
    let fs;
    try { fs = S.initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: S.persistentLocalCache({ tabManager: S.persistentMultipleTabManager() }) }); }
    catch (e) { console.warn('No offline cache on this browser', e); fs = S.initializeFirestore(app, { ignoreUndefinedProperties: true }); }
    return F = { U, S, app, auth, fs };
  })().catch(e => { fb.p = null; throw e; }));
}
const docRef = (l, c, id) => F.S.doc(F.fs, 'ledgers', l, c, id);

/* ---- sales: one document per sale ----
   Inside the app a sale is still one record per product line (orderId ties them together). In Firestore each
   sale is one document, named after the sale (orderId, or the line's id for a one-line sale): what all its lines
   share (date, customer, payment…) is stored once, and each product in `lines`. One write per sale instead of
   one per product. Older one-document-per-line entries are still read, and moved to this form once */
const saleKey = r => r.orderId || r.id;
function packSale(lines) {
  const keys = new Set(), head = {};
  lines.forEach(r => Object.keys(r).forEach(k => keys.add(k)));
  keys.forEach(k => { if (k === 'id' || k === 'lines') return; const v = stable(lines[0][k]); if (lines.every(r => k in r && stable(r[k]) === v)) head[k] = lines[0][k]; });
  head.lines = lines.map(r => { const o = {}; Object.keys(r).forEach(k => { if (!(k in head) || k === 'id') o[k] = r[k]; }); return o; });
  return head;
}
/* a Firestore document → [id, record] for each entry in it */
function entriesOf(c, id, data) {
  if (c === 'sales' && Array.isArray(data.lines)) {
    const h = Object.assign({}, data); delete h.lines; delete h._t;
    return data.lines.filter(x => x && x.id).map(x => { const r = Object.assign({}, h, x); return [r.id, r]; });
  }
  return [[id, cleanDoc(data, id)]];
}
/* entries ({id: stable}) → the documents that store them */
function docsOf(c, coll) {
  if (c !== 'sales') return Object.entries(coll).map(([id, s]) => [id, JSON.parse(s)]);
  const by = {};
  Object.values(coll).forEach(s => { const r = JSON.parse(s), k = saleKey(r); (by[k] = by[k] || []).push(r); });
  return Object.entries(by).map(([k, ls]) => [k, packSale(ls)]);
}
const setRef = l => F.S.doc(F.fs, 'ledgers', l, 'meta', 'settings');
const infoRef = l => F.S.doc(F.fs, 'ledgers', l, 'meta', 'info');
const backupsCol = () => F.S.collection(F.fs, 'ledgers', CLOUD.ledger, 'backups');
/* Firestore errors in words */
function fsMsg(e) {
  const c = e && e.code || '';
  if (c === 'permission-denied' || c === 'unauthenticated') return rulesMsg();
  if (c === 'not-found' || c === 'failed-precondition' && /database/i.test(e.message)) return 'The Firestore database hasn’t been created yet. See “Admin” below.';
  if (c === 'unavailable' || e && e.timeout) return offlineMsg;
  if (c === 'resource-exhausted') return 'Firestore’s free daily limit is used up (it resets at 09:00). Changes stay on this device and are sent then. Don’t edit on two devices until it’s back.';
  return 'Cloud error: ' + (e && (e.message || c) || e);
}

const Cloud = {
  cfg: JSON.parse(localStorage.getItem('shanta-cloud') || 'null'),
  /* the last state this device saw confirmed by the server: anything in db that differs from it
     was changed here and is (re)sent when the app connects */
  base: JSON.parse(localStorage.getItem('shanta-cloud-base') || 'null'),
  remote: null, ready: false, state: 'off', msg: '', last: null, busy: false, unsubs: [], backups: null, dellog: {}, unstamped: {}, since: {}, fullAt: 0, src: null, docLines: null, legacy: new Set(),
  on() { return !!(this.cfg && this.cfg.fs); },
  /* signed in with the previous version of the app: needs to sign in once more */
  legacy() { return !!(this.cfg && !this.cfg.fs); },
  ledger() { return (this.cfg && this.cfg.ledger) || CLOUD.ledger; },
  saveCfg() { localStorage.setItem('shanta-cloud', JSON.stringify(this.cfg)); },
  saveBase() { clearTimeout(this.bt); this.bt = setTimeout(() => { if (!this.ready || !this.on()) return;
    localStorage.setItem('shanta-cloud-base', JSON.stringify(this.base));
    /* where to continue next time: saved together with the copy it belongs to */
    if (!this.isBackup() && this.fullAt) {
      /* which sale document each sale line is in (only those not stored under their own id) */
      const src = {}; Object.entries((this.src && this.src.sales) || {}).forEach(([id, d]) => { if (d !== id && id in this.base.sales) src[id] = d; });
      localStorage.setItem(SYNC_KEY, JSON.stringify({ v: 2, ledger: this.ledger(), since: this.since, full: this.fullAt, src, legacy: [...(this.legacy || [])] }));
    }
    else localStorage.removeItem(SYNC_KEY); }, 800); },
  set(state, msg) { this.state = state; this.msg = msg || ''; renderFile(); cloudBanner(); const c = $('#cloudcard'); if (c) { if (this.on() !== (c.dataset.mode === 'on')) { c.outerHTML = this.settingsHTML(); this.fillBackups(); } else { const m = $('#cl_msg'); if (m) { m.textContent = this.msg; m.hidden = !this.msg; } } } const gm = $("#g_msg"); if (gm) { gm.textContent = this.msg; gm.hidden = !this.msg; } const lm = $("#ldmsg"); if (lm && this.msg) lm.textContent = this.msg; },

  async connect(email, pw) {
    let f; try { f = await fb(); } catch (e) { throw new Error(netMsg); }
    try { await f.U.signInWithEmailAndPassword(f.auth, email, pw); } catch (e) { throw new Error(authMsg(e.code || e.message)); }
    /* a base from the old app that belongs to a backup ledger must not be replayed onto the live one */
    if (this.legacy() && this.cfg.ledger !== CLOUD.ledger) this.base = null;
    this.cfg = { fs: 1, email, ledger: CLOUD.ledger }; this.saveCfg();
    await this.start();
  },
  /* Google: the account comes back from Google's own button as a token (works where third-party cookies are
     blocked); a popup is the fallback. Access is still decided by the email list in the rules */
  async connectGoogle(idToken) {
    let f; try { f = await fb(); } catch (e) { throw new Error(netMsg); }
    const popup = () => { const pr = new f.U.GoogleAuthProvider(); pr.setCustomParameters({ prompt: 'select_account' }); return f.U.signInWithPopup(f.auth, pr); };
    try { await (idToken ? f.U.signInWithCredential(f.auth, f.U.GoogleAuthProvider.credential(idToken)) : popup()); }
    catch (e) { throw new Error(/popup-closed|cancelled-popup/.test(e.code || '') ? 'The Google window closed before signing you in. Try again.' : /operation-not-allowed/.test(e.code || '') ? 'Google sign-in is not enabled yet (Authentication → Sign-in method).' : authMsg(e.code || e.message)); }
    const email = f.auth.currentUser && f.auth.currentUser.email;
    if (this.legacy() && this.cfg.ledger !== CLOUD.ledger) this.base = null;
    this.cfg = { fs: 1, email, ledger: CLOUD.ledger, via: 'google' }; this.saveCfg();
    await this.start();
  },
  async disconnect() {
    this.stopListen();
    /* forget the login first, so the sign-out isn't mistaken for an expired login */
    /* on the live ledger, keep what the cloud last confirmed: signing in again then only sends real
       unsent changes, with no question. A backup ledger's base must never meet the live one */
    if (this.isBackup()) { this.base = null; localStorage.removeItem('shanta-cloud-base'); }
    else if (this.ready && this.base) localStorage.setItem('shanta-cloud-base', JSON.stringify(this.base));
    this.cfg = null; this.ready = false; this.started = false;
    localStorage.removeItem('shanta-cloud');
    try { if (F) await F.U.signOut(F.auth); } catch (e) { }
    this.set('off'); toast('Signed out. Your data stays on this device.'); localStorage.removeItem('shanta-offline'); showGate();
  },

  /* sign-in restored, data moved over if needed, listeners on */
  async start() {
    if (!this.on() || this.starting) return this.starting;
    return this.starting = (async () => {
      this.set('syncing');
      let f;
      for (;;) { try { f = await fb(); break; } catch (e) { this.set('offline', 'Couldn’t load the cloud library. Check your internet connection.'); await sleep(8000); } }
      const user = await new Promise(r => { const u = f.U.onAuthStateChanged(f.auth, x => { u(); r(x); }); });
      if (!user) { this.cfg = null; localStorage.removeItem('shanta-cloud'); this.set('off', 'Please sign in again.'); showGate('Please sign in again.'); return; }
      if (!this.watchingAuth) {
        this.watchingAuth = true;
        f.U.onAuthStateChanged(f.auth, x => { if (!x && this.on()) { this.stopListen(); this.cfg = null; localStorage.removeItem('shanta-cloud'); this.set('off', 'Your cloud login expired. Please connect again.'); showGate('Your cloud login expired. Please connect again.'); } });
      }
      try { await this.ensureMoved(); } catch (e) { console.warn(e); this.set('error', e.message || fsMsg(e)); return; }
      this.started = true;
      this.listen();
    })().finally(() => { this.starting = null; });
  },

  /* ---- one-time move from the Realtime Database ---- */
  async ensureMoved() {
    for (;;) {
      let d;
      try { const s = await within(F.S.getDocFromServer(infoRef(CLOUD.ledger)), 20000, offlineMsg); Reads.add(1); d = s.exists() ? s.data() : {}; }
      catch (e) {
        if (e.code === 'permission-denied' || e.code === 'not-found' || e.code === 'failed-precondition') throw new Error(fsMsg(e));
        this.set('offline', navigator.onLine ? 'Can’t reach Firestore. If this stays, check that the Firestore database was created (see “Admin” in Settings).' : offlineMsg); await sleep(6000); continue;
      }
      this.info = d;
      if (d.movedAt) return;
      const me = this.cfg.email, fresh = d.movingAt && Date.now() - Date.parse(d.movingAt) < 180000;
      if (fresh && d.movingBy !== me) { this.set('syncing', 'Moving the shared ledger to the new database…'); await sleep(4000); continue; }
      try { await this.move(); return; }
      catch (e) {
        console.warn(e);
        if (e.code === 'permission-denied') throw new Error(fsMsg(e));
        this.set('offline', e.message || offlineMsg); await sleep(8000);
      }
    }
  },
  async move() {
    this.set('syncing', 'Moving the shared ledger to the new database…');
    const me = this.cfg.email;
    const go = await F.S.runTransaction(F.fs, async t => {
      const s = await t.get(infoRef(CLOUD.ledger)), d = s.exists() ? s.data() : {};
      if (d.movedAt || (d.movingAt && Date.now() - Date.parse(d.movingAt) < 180000 && d.movingBy !== me)) return false;
      t.set(infoRef(CLOUD.ledger), { movingAt: new Date().toISOString(), movingBy: me }, { merge: true });
      return true;
    });
    if (!go) return this.ensureMoved();
    this.set('syncing', 'Moving the shared ledger to the new database…');
    const token = await F.auth.currentUser.getIdToken();
    let raw = {};
    try {
      const r = await within(fetch(`${CLOUD.dbUrl}/ledgers/${encodeURIComponent(CLOUD.ledger)}.json?auth=${encodeURIComponent(token)}`, { cache: 'no-store' }), 30000, offlineMsg);
      if (!r.ok) throw new Error('Couldn’t read the old database (' + r.status + ').');
      raw = await r.json() || {};
    } catch (e) { throw new Error(e.message || netMsg); }
    const ops = [], counts = {};
    COLLS.forEach(c => { const o = raw[c] || {}; counts[c] = Object.keys(o).length; Object.entries(o).forEach(([id, rec]) => ops.push(b => b.set(docRef(CLOUD.ledger, c, id), Object.assign({}, rec, { id })))); });
    const st = {}; Object.entries(raw.settings || {}).forEach(([k, v]) => { if (!LOCAL_KEYS.includes(k) && v !== null && v !== undefined) st[k] = v; });
    if (Object.keys(st).length) ops.push(b => b.set(setRef(CLOUD.ledger), st, { merge: true }));
    await this.writeAll(ops);
    await this.verify(CLOUD.ledger, counts, 'The move to the new database could not be verified. It will be tried again.');
    await within(F.S.setDoc(infoRef(CLOUD.ledger), { movedAt: new Date().toISOString(), movedBy: me, counts, from: 'realtime-database' }, { merge: true }), 30000, offlineMsg);
    toast('The shared ledger was moved to the new database');
  },

  /* ---- live listeners ---- */
  stopListen() { this.unsubs.forEach(u => { try { u(); } catch (e) { } }); this.unsubs = []; this.ready = false; },
  listen() {
    const wasReady = this.ready;
    this.stopListen(); clearTimeout(this.rt); this.rt = null;
    const l = this.ledger(), got = {}, S = F.S;
    /* the last state confirmed by the server is what this device's own changes are measured against. A retry
       after a failed start (offline, daily limit used up) keeps it: the half-filled base of the failed try
       would make this device's old copy look like new changes and overwrite the other device's work */
    if (this.switching) this.base0 = null;
    else if (wasReady || !this.base0) this.base0 = this.base ? cloneSnap(this.base) : null;
    /* only what changed since the last sync, when this device has a complete, recent copy to start from */
    const sy = this.syncInfo(), base0 = this.base0;
    const delta = !!(base0 && sy && sy.v === 2 && sy.ledger === l && Date.now() - num(sy.full) < FULL_EVERY && !this.isBackup()
      && this.info && this.info.stampedAt && COLLS.every(c => typeof sy.since[c] === 'number'));
    this.mode = delta ? 'delta' : 'full';
    this.since = delta ? Object.assign({}, sy.since) : {}; COLLS.forEach(c => { if (typeof this.since[c] !== 'number') this.since[c] = 0; });
    this.fullAt = delta ? num(sy.full) : 0;
    this.unstamped = {}; this.dellog = {};
    /* which Firestore document each entry lives in (a sale document holds several entries) */
    this.src = {}; this.docLines = {}; COLLS.forEach(c => { this.src[c] = {}; this.docLines[c] = {}; });
    this.legacy = new Set(delta ? sy.legacy || [] : []);
    this.remote = delta ? cloneSnap(base0) : emptySnap(); this.base = delta ? cloneSnap(base0) : emptySnap();
    if (delta) { const ex = sy.src || {}; COLLS.forEach(c => Object.keys(this.remote[c]).forEach(id => this.link(c, id, (c === 'sales' && ex[id]) || id))); }
    const seen = {};
    const done = k => { got[k] = true; if (!this.ready && ['settings', 'deleted'].concat(COLLS).every(x => got[x])) this.becomeReady(); };
    /* a listener that fails stops for good: start them all again after a pause, instead of waiting for a
       page refresh. Each retry costs reads, so the pause grows: 20 s, 1 min, 3 min … up to 15 min */
    const fail = e => {
      console.warn(e); this.set(e.code === 'unavailable' ? 'offline' : 'error', fsMsg(e));
      if (this.rt) return;
      this.failN = (this.failN || 0) + 1;
      const wait = e.code === 'resource-exhausted' ? 15 * 6e4 : e.code === 'permission-denied' || e.code === 'unauthenticated' ? Math.min(15 * 6e4, 2e4 * Math.pow(3, this.failN - 1)) : Math.min(6e4, 5000 * this.failN);
      this.rt = setTimeout(() => { this.rt = null; if (this.on() && this.unsubs.length) this.listen(); }, wait);
    };
    COLLS.forEach(c => {
      const col = S.collection(F.fs, 'ledgers', l, c);
      const q = delta ? S.query(col, S.where('_t', '>', S.Timestamp.fromMillis(Math.max(0, this.since[c] - SINCE_MARGIN)))) : col;
      this.unsubs.push(S.onSnapshot(q, { includeMetadataChanges: true }, snap => {
        Reads.snap(snap, seen, c, !delta);
        snap.docChanges({ includeMetadataChanges: true }).forEach(ch => {
          const id = ch.doc.id, ok = !ch.doc.metadata.hasPendingWrites;
          /* with "changed since", leaving the answer isn't a deletion (meta/deleted says what was deleted) */
          if (ch.type === 'removed') { if (!delta) { this.dropDoc(c, id, true); if (c === 'sales') this.legacy.delete(id); } return; }
          const data = ch.doc.data(), t = tMs(data._t);
          this.putDoc(c, id, entriesOf(c, id, data), ok);
          if (c === 'sales') { if (Array.isArray(data.lines)) this.legacy.delete(id); else this.legacy.add(id); }
          if (ok) {
            if (t > this.since[c]) this.since[c] = t;
            if (!t) this.unstamped[c + '/' + id] = 1; else delete this.unstamped[c + '/' + id];
          }
        });
        if (!snap.metadata.fromCache) done(c);
        this.changed(c);
      }, fail));
    });
    this.unsubs.push(S.onSnapshot(setRef(l), { includeMetadataChanges: true }, d => {
      Reads.snap(d, seen, 'settings', true);
      this.remote.settings = snapSettings(d.exists() ? d.data() : {});
      if (!d.metadata.hasPendingWrites) this.base.settings = Object.assign({}, this.remote.settings);
      if (!d.metadata.fromCache) done('settings');
      this.changed('settings');
    }, fail));
    /* deletions: { <coll>: { <id>: when } } */
    this.unsubs.push(S.onSnapshot(delRef(l), { includeMetadataChanges: true }, d => {
      Reads.snap(d, seen, 'deleted', true);
      this.dellog = d.exists() ? d.data() : {};
      COLLS.forEach(c => Object.keys(this.dellog[c] || {}).forEach(id => { this.dropDoc(c, id, !d.metadata.hasPendingWrites); if (c === 'sales') this.legacy.delete(id); }));
      if (!d.metadata.fromCache) done('deleted');
      this.changed('deleted');
    }, fail));
  },
  /* entry ↔ document bookkeeping */
  link(c, id, d) { const o = this.src[c][id]; if (o === d) return; if (o && this.docLines[c][o]) this.docLines[c][o].delete(id); this.src[c][id] = d; (this.docLines[c][d] = this.docLines[c][d] || new Set()).add(id); },
  unlink(c, id) { const o = this.src[c][id]; if (o && this.docLines[c][o]) this.docLines[c][o].delete(id); delete this.src[c][id]; },
  /* a document arrived: its entries replace what came from it before. Entries it no longer holds are dropped
     from the cloud's copy; from the confirmed copy (base) only once the server has confirmed it */
  putDoc(c, d, entries, ok) {
    const now = new Set(entries.map(e => e[0]));
    [...(this.docLines[c][d] || [])].forEach(id => { if (!now.has(id) && this.src[c][id] === d) { delete this.remote[c][id]; if (ok) { delete this.base[c][id]; this.unlink(c, id); } } });
    entries.forEach(([id, rec]) => { const s = stable(rec); this.remote[c][id] = s; if (ok) this.base[c][id] = s; this.link(c, id, d); });
  },
  dropDoc(c, d, ok) {
    [...(this.docLines[c][d] || [])].forEach(id => { if (this.src[c][id] !== d) return; delete this.remote[c][id]; if (ok) { delete this.base[c][id]; this.unlink(c, id); } });
  },
  syncInfo() { try { const s = JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); return s && s.since ? s : null; } catch (e) { return null; } },
  /* once per full download: give entries without a change time one (needed for "changed since"),
     and drop deletions older than 10 days (every device has had a full download since) */
  async tidy() {
    if (this.isBackup() || this.mode !== 'full' || this.tidying) return;
    this.tidying = true;
    try {
      const l = this.ledger(), S = F.S, ts = S.serverTimestamp(), ops = [];
      /* once: sales stored one document per product line become one document per sale (a backup first) */
      if (this.legacy.size && !this.moving) await this.moveSales();
      Object.keys(this.unstamped).forEach(k => { const [c, id] = k.split('/'); if (c === 'sales' && this.legacy.has(id)) return; if (this.docLines[c][id] && this.docLines[c][id].size) ops.push(b => b.update(docRef(l, c, id), { _t: ts })); });
      const old = {}, cut = Date.now() - DEL_KEEP;
      COLLS.forEach(c => Object.entries(this.dellog[c] || {}).forEach(([id, t]) => { const m = tMs(t); if (m && m < cut) (old[c] = old[c] || {})[id] = S.deleteField(); }));
      if (Object.keys(old).length) ops.push(b => b.set(delRef(l), old, { merge: true }));
      if (ops.length) await this.writeAll(ops);
      this.unstamped = {};
      if (!(this.info && this.info.stampedAt)) {
        await within(S.setDoc(infoRef(l), { stampedAt: new Date().toISOString() }, { merge: true }), 30000, offlineMsg);
        this.info = Object.assign({}, this.info, { stampedAt: new Date().toISOString() });
      }
    } catch (e) { console.warn('tidy', e); }
    this.tidying = false;
  },
  async moveSales() {
    this.moving = true;
    try {
      const ids = new Set(); this.legacy.forEach(d => (this.docLines.sales[d] || []).forEach(id => { if (id in this.remote.sales) ids.add(id); }));
      if (!ids.size) return;
      const name = await this.snapshot('Automatic backup before storing each sale as one document');
      const patch = {}; ids.forEach(id => patch['sales/' + id] = JSON.parse(this.remote.sales[id]));
      this.quiet = true; this.write(patch, true); this.quiet = false;
      await within(F.S.setDoc(infoRef(this.ledger()), { salesDocs: 2, salesMovedAt: new Date().toISOString(), salesBackup: name || '' }, { merge: true }), 30000, offlineMsg);
      toast(`Sales are now stored one document per sale (${new Set([...ids].map(id => saleKey(JSON.parse(this.remote.sales[id])))).size} sales). A backup was made first.`);
    } catch (e) { console.warn('moving sales', e); }
    finally { this.moving = false; this.quiet = false; }
  },
  /* first complete picture from the server: merge in what this device changed while it wasn't connected */
  becomeReady() {
    const remote = this.remote, local = snapLocal(db);
    let pending = {};
    if (!this.switching) {
      const base0 = this.base0;
      if (base0) pending = snapDiff(local, fixBase(base0, remote), remote);
      else {
        /* nothing known about this device: the cloud is the shared ledger. Entries the cloud has never seen
           (e.g. made without signing in) are added when asked; Cancel first keeps a copy of them on this device */
        const own = [];
        COLLS.forEach(c => Object.keys(local[c]).forEach(id => { if (!(id in remote[c]) && !Outbox.has(this.ledger(), c + '/' + id)) own.push(c + '/' + id); }));
        const n = own.length;
        if (n) {
          const add = !snapHasData(remote) || confirm(`This device has ${n} entr${n === 1 ? 'y' : 'ies'} that ${n === 1 ? 'is' : 'are'} not in the shared ledger yet.\n\nOK = add ${n === 1 ? 'it' : 'them'} to the shared ledger (recommended)\nCancel = leave ${n === 1 ? 'it' : 'them'} out (a copy is kept under Settings → Backup & sync → Copies on this device)`);
          if (add) own.forEach(k => { const [c, id] = k.split('/'); pending[k] = JSON.parse(local[c][id]); });
          else LocalCopies.save(`${n} entr${n === 1 ? 'y' : 'ies'} left out of the shared ledger`, db);
        }
        /* an empty cloud gets this device's settings; otherwise the cloud's settings win */
        if (!Object.keys(remote.settings).length) Object.entries(local.settings).forEach(([k, v]) => pending['settings/' + k] = JSON.parse(v));
      }
      /* changes saved here that the cloud never confirmed always go in, whatever happened meanwhile */
      const waiting = Outbox.items(this.ledger());
      Object.entries(waiting).forEach(([k, v]) => { Object.keys(pending).forEach(p => { if (p.startsWith(k + '/')) delete pending[p]; }); pending[k] = v; });
    }
    /* deleting something the cloud no longer has changes nothing: leave it out (and out of the question below) */
    Object.keys(pending).forEach(k => { const [c, id, f] = k.split('/'); if (pending[k] === null && f === undefined && c !== 'settings' && remote[c] && !(id in remote[c])) delete pending[k]; });
    /* many deletions on connecting means this device's copy is behind, not that someone deleted them: ask */
    const dels = Object.keys(pending).filter(k => pending[k] === null && k.split('/').length === 2 && !k.startsWith('settings/') && !Outbox.has(this.ledger(), k));
    if (dels.length >= 10 && !confirm(`This device's copy is missing ${dels.length} entries that are in the shared ledger.\n\nOK = delete them from the shared ledger too\nCancel = keep them (recommended unless you deleted them on purpose while offline)`))
      dels.forEach(k => delete pending[k]);
    this.switching = false; this.base0 = null; this.ready = true; this.failN = 0;
    if (this.mode === 'full') this.fullAt = Date.now();
    setTimeout(() => { if (linkPartnerEmails()) commit(); }, 0);
    this.fromRemote(snapApply(cloneSnap(remote), pending));
    if (Object.keys(pending).length) this.write(pending);
    this.last = new Date(); this.set('ok'); this.saveBase();
    setTimeout(() => this.tidy(), 3000);
    /* always redraw: the screen may still show the loading view */
    render();
    (this.readyWaiters || []).forEach(r => r()); this.readyWaiters = [];
  },
  whenReady(ms) { return this.ready ? Promise.resolve() : within(new Promise(r => (this.readyWaiters = this.readyWaiters || []).push(r)), ms, offlineMsg).catch(() => { }); },
  changed() {
    if (!this.ready) return;
    this.saveBase();
    /* changes still waiting for the cloud stay on screen, even if Firestore took them back */
    clearTimeout(this.ct); this.ct = setTimeout(() => { const l = this.ledger(); this.fromRemote(Outbox.count(l) && !this.isBackup() ? Outbox.over(cloneSnap(this.remote), l) : this.remote); }, 40);
  },
  /* copy a snapshot into db, keeping the order of existing entries */
  fromRemote(s) {
    let diff = false;
    COLLS.forEach(c => {
      const cur = {}; db[c].forEach(r => cur[r.id] = r);
      const ids = db[c].map(r => r.id).filter(id => id in s[c]); Object.keys(s[c]).forEach(id => { if (!(id in cur)) ids.push(id); });
      const next = ids.map(id => cur[id] && stable(cur[id]) === s[c][id] ? cur[id] : JSON.parse(s[c][id]));
      if (next.length !== db[c].length || next.some((r, i) => r !== db[c][i])) { db[c] = next; diff = true; }
    });
    const st = {}; Object.entries(s.settings).forEach(([k, v]) => st[k] = JSON.parse(v));
    if (stable(snapSettings(db.settings)) !== stable(s.settings)) {
      const keep = {}; LOCAL_KEYS.forEach(k => { if (k in db.settings) keep[k] = db.settings[k]; });
      db.settings = Object.assign(DEFAULT_DB().settings, st, keep); diff = true;
    }
    if (diff) { persistLocal(); render(); }
  },

  /* ---- sending changes ---- */
  schedule() { if (this.on() && this.ready) this.push(); },
  push() {
    const patch = snapDiff(snapLocal(db), this.remote, this.remote);
    if (!Object.keys(patch).length) return;
    const dels = Object.entries(patch).filter(([k, v]) => v === null && k.split('/').length === 2 && k.split('/')[0] !== 'settings').length;
    /* many entries deleted at once: copy the ledger first (one Firestore write per entry, so only for big deletions) */
    if (dels >= 20 && !this.isBackup()) {
      const before = cloneSnap(this.remote);
      snapApply(this.remote, patch);
      this.q = (this.q || Promise.resolve()).then(() => this.snapshot(`Automatic backup before deleting ${dels} entries`, before))
        .then(() => this.write(patch, true), e => { console.warn(e); this.remote = before; this.fromRemote(before); alert('The backup failed, so nothing was deleted. ' + (e.message || '')); });
      return;
    }
    this.write(patch);
  },
  /* patch paths → Firestore writes; fields of one entry go in one merge. Each written entry gets the server's
     change time (_t); a deleted one is listed in meta/deleted, and leaves that list if it comes back */
  write(patch, applied) {
    if (!applied) snapApply(this.remote, patch);
    const l = this.ledger(), docs = {}, ops = [], st = {}, gone = {}, S = F.S, ts = S.serverTimestamp();
    const mark = (c, id, v) => (gone[c] = gone[c] || {})[id] = v;
    /* what each touched entry looks like now: kept on the device until the cloud confirms it */
    const keep = {};
    Object.keys(patch).forEach(k => { const [c, id] = k.split('/'); const dk = c + '/' + id;
      keep[dk] = c === 'settings' ? (id in this.remote.settings ? JSON.parse(this.remote.settings[id]) : null) : (id in this.remote[c] ? JSON.parse(this.remote[c][id]) : null); });
    if (!this.isBackup()) Outbox.add(l, keep);
    const what = this.quiet ? '' : describePatch(patch), job = what ? SaveStatus.start(what) : 0;
    let parts = 0, failed = false;
    Object.entries(patch).forEach(([k, v]) => {
      const [c, id, f] = k.split('/'), dk = c + '/' + id;
      if (c === 'sales') return;   // whole sale documents, below
      if (c === 'settings') st[id] = v === null ? S.deleteField() : v;
      else if (f === undefined) {
        if (v === null) { ops.push({ k: dk, f: b => b.delete(docRef(l, c, id)) }); mark(c, id, ts); this.unlink(c, id); }
        else { ops.push({ k: dk, f: b => b.set(docRef(l, c, id), Object.assign({}, v, { _t: ts })) }); if (this.dellog[c] && id in this.dellog[c]) mark(c, id, S.deleteField()); this.link(c, id, id); }
      }
      else { const d = docs[dk] || (docs[dk] = { c, id, v: { _t: ts } }); d.v[f] = v === null ? S.deleteField() : v; }
    });
    /* sales: every sale touched is written again as one whole document (with all its lines); a sale left with
       no lines is deleted; an older one-line document whose line now sits in a sale document goes */
    const saleDocs = new Map(), addTo = (d, dk) => { if (d) (saleDocs.get(d) || saleDocs.set(d, new Set()).get(d)).add(dk); };
    Object.keys(patch).forEach(k => { const [c, id] = k.split('/'); if (c !== 'sales') return;
      addTo(this.src.sales[id], 'sales/' + id); if (id in this.remote.sales) addTo(saleKey(JSON.parse(this.remote.sales[id])), 'sales/' + id); });
    if (saleDocs.size) {
      const byKey = {};
      Object.values(this.remote.sales).forEach(s => { const r = JSON.parse(s), k = saleKey(r); (byKey[k] = byKey[k] || []).push(r); });
      [...saleDocs.keys()].forEach(d => (byKey[d] || []).forEach(r => { const o = this.src.sales[r.id]; if (o && o !== d && !saleDocs.has(o)) saleDocs.set(o, new Set()); }));
      saleDocs.forEach((keys, d) => {
        const lines = byKey[d] || [];
        if (lines.length) {
          const data = Object.assign(packSale(lines), { _t: ts });
          ops.push({ k: [...keys], f: b => b.set(docRef(l, 'sales', d), data) });
          if (this.dellog.sales && d in this.dellog.sales) mark('sales', d, S.deleteField());
        } else { ops.push({ k: [...keys], f: b => b.delete(docRef(l, 'sales', d)) }); mark('sales', d, ts); }
      });
      saleDocs.forEach((k, d) => (byKey[d] || []).forEach(r => this.link('sales', r.id, d)));
      Object.keys(patch).forEach(k => { const [c, id] = k.split('/'); if (c === 'sales' && !(id in this.remote.sales)) this.unlink('sales', id); });
    }
    Object.entries(docs).forEach(([dk, d]) => ops.push({ k: dk, f: b => b.set(docRef(l, d.c, d.id), d.v, { merge: true }) }));
    if (Object.keys(st).length) ops.push({ k: Object.keys(st).map(id => 'settings/' + id), f: b => b.set(setRef(l), st, { merge: true }) });
    if (Object.keys(gone).length) ops.push({ k: [], f: b => b.set(delRef(l), gone, { merge: true }) });
    for (let i = 0; i < ops.length; i += 400) {
      const part = ops.slice(i, i + 400), b = F.S.writeBatch(F.fs), sent = {};
      part.forEach(o => { o.f(b); [].concat(o.k).forEach(k => { sent[k] = stable(keep[k]); }); });
      parts++;
      b.commit().then(() => { Outbox.done(l, sent); this.confirmed(sent); this.outFail = 0; if (!Outbox.count(l)) cloudBanner(); if (document.querySelector('.pill.unsent')) render(); if (job && !--parts && !failed) SaveStatus.ok(job); })
        .catch(e => { console.warn(e); this.set('error', fsMsg(e)); this.retryOut(); if (job && !failed) { failed = true; SaveStatus.fail(job, fsMsg(e)); } });
    }
    this.set('syncing');
    clearTimeout(this.wt); this.wt = setTimeout(() => this.settle(), 50);
  },
  /* the server accepted a save: it's now the confirmed state too. Without this, a phone put away right after
     saving kept the old copy as "confirmed", and on reopening the replaced entries looked deleted on this device */
  confirmed(sent) {
    if (this.isBackup() || !this.base) return;
    Object.entries(sent).forEach(([k, s]) => { const [c, id] = k.split('/'), into = c === 'settings' ? this.base.settings : this.base[c], now = c === 'settings' ? this.remote.settings : this.remote[c];
      if (!into || !now) return;
      if (s === 'null' || s === undefined) { if (!(id in now)) delete into[id]; }
      else if (now[id] === s) into[id] = s; });
    this.saveBase();
  },
  /* the cloud refused or lost a save: send what's still waiting again, after a growing pause */
  retryOut() {
    if (this.ot) return;
    this.outFail = (this.outFail || 0) + 1;
    const wait = Math.min(15 * 6e4, 15000 * Math.pow(2, this.outFail - 1));
    this.ot = setTimeout(() => { this.ot = null; this.resend(); }, wait);
  },
  resend() {
    if (!this.on() || !this.ready || this.isBackup()) return;
    const it = Outbox.items(this.ledger()); if (!Object.keys(it).length) return;
    const patch = {}; Object.entries(it).forEach(([k, v]) => patch[k] = v);
    this.write(patch);
  },
  async settle() {
    try { await within(F.S.waitForPendingWrites(F.fs), 15000, offlineMsg); if (this.state !== 'error') { this.last = new Date(); this.set('ok'); } }
    catch (e) { if (this.state !== 'error') this.set('offline', offlineMsg); }
  },
  /* writes that must reach the server before going on (move, backups, restore) */
  async writeAll(ops) {
    for (let i = 0; i < ops.length; i += 400) {
      const b = F.S.writeBatch(F.fs); ops.slice(i, i + 400).forEach(o => o(b));
      await within(b.commit(), 60000, 'Couldn’t reach the cloud. Check your internet connection.');
    }
  },
  async verify(l, counts, msg) {
    for (const c of COLLS) {
      const n = (await within(F.S.getCountFromServer(F.S.collection(F.fs, 'ledgers', l, c)), 30000, offlineMsg)).data().count;
      if (n < (counts[c] || 0)) throw new Error(msg);
    }
  },
  /* used before actions that need everything uploaded: resolves when connected and nothing is pending */
  async sync() {
    if (!this.on()) return;
    if (!this.started) await this.start();
    else if (!this.ready) this.listen();
    await this.whenReady(15000);
    if (!this.ready) { this.set('offline', offlineMsg); return; }
    if (this.state === 'error' || this.outFail) { clearTimeout(this.ot); this.ot = null; this.outFail = 0; this.resend(); } else this.push();
    await this.settle();
  },
  /* a whole ledger from the server */
  async readLedger(l) {
    const o = emptySnap();
    o.docIds = {};
    for (const c of COLLS) { const q = await within(F.S.getDocsFromServer(F.S.collection(F.fs, 'ledgers', l, c)), 30000, offlineMsg); Reads.add(Math.max(1, q.size));
      o.docIds[c] = q.docs.map(d => d.id); q.forEach(d => entriesOf(c, d.id, d.data()).forEach(([id, r]) => o[c][id] = stable(r))); }
    const s = await within(F.S.getDocFromServer(setRef(l)), 30000, offlineMsg);
    o.settings = snapSettings(s.exists() ? s.data() : {});
    return o;
  },

  /* ---- backups: a backup is a full copy stored as its own ledger, listed in ledgers/shared/backups ---- */
  async snapshot(reason, src, from = this.ledger()) {
    src = src || (this.ready && from === this.ledger() ? cloneSnap(this.remote) : await this.readLedger(from));
    const docs = {}, counts = {}; COLLS.forEach(c => { docs[c] = docsOf(c, src[c]); counts[c] = docs[c].length; });
    if (!COLLS.some(c => counts[c])) return null;
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const name = `backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const ops = [];
    COLLS.forEach(c => docs[c].forEach(([id, data]) => ops.push(b => b.set(docRef(name, c, id), data))));
    const st = {}; Object.entries(src.settings).forEach(([k, v]) => st[k] = JSON.parse(v));
    ops.push(b => b.set(setRef(name), st));
    ops.push(b => b.set(infoRef(name), { backupOf: from, createdAt: d.toISOString(), by: this.cfg.email, reason }));
    await this.writeAll(ops);
    await this.verify(name, counts, 'The backup could not be verified, so nothing was deleted.');
    await within(F.S.setDoc(F.S.doc(backupsCol(), name), { createdAt: d.toISOString(), by: this.cfg.email, reason, from, counts }), 30000, offlineMsg);
    this.backups = null;
    return name;
  },
  async backupAndClear(reason) {
    await this.sync();
    if (this.state !== 'ok') throw new Error('Couldn’t reach the cloud, so nothing was deleted. ' + this.msg);
    this.busy = true;
    try {
      const name = await this.snapshot(reason);
      const l = this.ledger(), ops = [];
      const gone = {}, ts = F.S.serverTimestamp();
      COLLS.forEach(c => Object.keys(this.docLines[c]).filter(d => this.docLines[c][d].size).forEach(id => { ops.push(b => b.delete(docRef(l, c, id))); (gone[c] = gone[c] || {})[id] = ts; }));
      if (Object.keys(gone).length) ops.push(b => b.set(delRef(l), gone, { merge: true }));
      await this.writeAll(ops);
      COLLS.forEach(c => { db[c] = []; this.remote[c] = {}; }); persistLocal();
      return name;
    } finally { this.busy = false; }
  },
  async backupNow() {
    await this.sync();
    if (this.state !== 'ok') throw new Error('Couldn’t reach the cloud, so no backup was made. ' + this.msg);
    const name = await this.snapshot('Manual backup', null, CLOUD.ledger);
    if (!name) throw new Error('The live ledger is empty, so there is nothing to back up.');
    return name;
  },
  /* copy a backup over the live ledger, after saving the live ledger as a backup itself */
  async restore(name) {
    await this.sync();
    if (this.state !== 'ok') throw new Error('Couldn’t reach the cloud, so nothing was restored. ' + this.msg);
    this.busy = true;
    try {
      const src = await this.readLedger(name);
      if (!snapHasData(src)) throw new Error('That backup is empty, so nothing was restored.');
      const live = await this.readLedger(CLOUD.ledger);
      const when = (this.backups || []).find(b => b.name === name);
      await this.snapshot(`Automatic backup before restoring the backup from ${when ? fDateTime(when.createdAt) : name}`, live, CLOUD.ledger);
      const ops = [], gone = {}, ts = F.S.serverTimestamp();
      COLLS.forEach(c => {
        const put = docsOf(c, src[c]), keepIds = new Set(put.map(d => d[0]));
        (live.docIds[c] || []).forEach(id => { if (!keepIds.has(id)) { ops.push(b => b.delete(docRef(CLOUD.ledger, c, id))); (gone[c] = gone[c] || {})[id] = ts; } });
        put.forEach(([id, data]) => ops.push(b => b.set(docRef(CLOUD.ledger, c, id), Object.assign(data, { _t: ts }))));
      });
      const st = {}; Object.entries(src.settings).forEach(([k, v]) => st[k] = JSON.parse(v));
      if (Object.keys(st).length) ops.push(b => b.set(setRef(CLOUD.ledger), st));
      /* restored entries may have been deleted before: start the deletion list afresh */
      ops.unshift(b => b.set(delRef(CLOUD.ledger), gone));
      await this.writeAll(ops);
      this.backups = null;
    } finally { this.busy = false; }
    await this.openLedger(CLOUD.ledger);
  },
  async listBackups() {
    await fb();
    const q = await within(F.S.getDocs(backupsCol()), 20000, offlineMsg); Reads.add(Math.max(1, q.size)); this.backupsAt = Date.now();
    this.backups = q.docs.map(d => Object.assign({ name: d.id }, d.data())).sort((a, b) => b.name.localeCompare(a.name));
    return this.backups;
  },
  async openLedger(name) {
    await this.sync();
    if (this.state !== 'ok') throw new Error('Couldn’t reach the cloud. ' + this.msg);
    this.cfg.ledger = name; this.saveCfg();
    /* show exactly what is in that ledger; nothing from the previous one is carried over */
    this.switching = true; this.base = null; localStorage.removeItem('shanta-cloud-base'); localStorage.removeItem(SYNC_KEY);
    this.listen();
    await this.whenReady(30000);
    if (!this.ready) throw new Error('Couldn’t reach the cloud. ' + offlineMsg);
    render();
  },
  isBackup() { return this.on() && this.ledger() !== CLOUD.ledger; },
  /* signed in, nothing on this device yet and the first data from the cloud hasn't arrived:
     show a loading view instead of the empty "welcome" screen */
  loading() {
    if (!this.on() || this.ready || COLLS.some(c => db[c].length)) return false;
    if (!this.loadingSince) this.loadingSince = Date.now();
    return true;
  },
  loadingHTML() {
    const slow = Date.now() - this.loadingSince > 12000;
    if (!this.slowTimer) this.slowTimer = setTimeout(() => { this.slowTimer = null; if (this.loading()) render(); }, 12500);
    const bar = w => `<i style="width:${w}%"></i>`;
    return `<div class="loadview" aria-busy="true">
      <div class="ldhead"><span class="spin" aria-hidden="true"></span><div><b>Loading the shared ledger…</b><p class="note" id="ldmsg">${esc(this.msg || (slow ? 'This is taking longer than usual. Check the internet connection.' : 'Getting your shipments, purchases and sales from the cloud.'))}</p></div></div>
      ${slow ? '<div class="row"><button class="btn sm" data-act="cloud-sync">Try again</button></div>' : ''}
      <div class="skel">
        <div class="sk-tiles">${'<div class="sk-tile">' + bar(40) + bar(70) + '</div>'}${'<div class="sk-tile">' + bar(55) + bar(60) + '</div>'}${'<div class="sk-tile">' + bar(35) + bar(75) + '</div>'}</div>
        <div class="sk-card">${[72, 58, 84, 64, 76, 52].map(w => `<div class="sk-row">${bar(w)}${bar(18)}</div>`).join('')}</div>
      </div></div>`;
  },
  bannerHTML() {
    if (!this.isBackup()) return '';
    const b = (this.backups || []).find(x => x.name === this.cfg.ledger);
    return `<div class="bkbanner"><span>📦 You are looking at a <b>backup</b>${b ? ' from ' + esc(fDateTime(b.createdAt)) : ' (' + esc(this.cfg.ledger) + ')'}. Changes here only affect this backup.</span><span class="row"><button class="btn sm terra" data-act="cloud-restore" data-ledger="${esc(this.cfg.ledger)}">Restore this backup</button><button class="btn sm" data-act="cloud-live">Back to the live ledger</button></span></div>`;
  },
  backupsHTML() {
    const list = this.backups;
    const cur = this.ledger();
    return `<div class="bklist"><h4>Ledger in use: ${cur === CLOUD.ledger ? '<span class="pill ok">Live (shared)</span>' : '<span class="pill warn">Backup</span>'}<button class="btn sm" data-act="cloud-backup" style="margin-left:auto">Back up now</button></h4>
      ${list === undefined || list === null ? '<p class="note">Loading backups…</p>' : !list.length ? '<p class="note">No backups yet. One is made automatically before data is cleared or many entries are deleted at once.</p>' :
      `<ul class="mini">${list.map(b => `<li><span><b>${esc(fDateTime(b.createdAt))}</b><span class="sub note">${esc(b.reason || '')} · ${COLLS.reduce((a, c) => a + num(b.counts && b.counts[c]), 0)} entries · by ${esc(userName(b.by || ''))}</span></span>
        <span class="r">${b.name === cur ? '<span class="pill warn">Open</span>' : `<button class="btn sm ghost" data-act="cloud-open" data-ledger="${esc(b.name)}">Open</button>`}<button class="btn sm ghost terra-text" data-act="cloud-restore" data-ledger="${esc(b.name)}">Restore</button></span></li>`).join('')}</ul>`}
      ${cur !== CLOUD.ledger ? '<button class="btn sm" data-act="cloud-live">Back to the live ledger</button>' : ''}</div>`;
  },
  async fillBackups() {
    const el = $('#cl_backups'); if (!el || !this.on()) return;
    el.innerHTML = this.backupsHTML();
    /* Settings is redrawn after every change: list the backups once, then again only after 10 minutes */
    if (this.backups && Date.now() - (this.backupsAt || 0) < 10 * 6e4) return;
    try { await this.listBackups(); } catch (e) { this.backups = []; }
    const el2 = $('#cl_backups'); if (el2) el2.innerHTML = this.backupsHTML();
  },

  statusHTML() {
    if (!this.on()) return '';
    const t = this.last ? this.last.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    const map = { syncing: ['', 'Syncing…'], ok: ['ok', 'Shared in the cloud'], offline: ['bad', 'Offline, saved on this device'], error: ['bad', 'Cloud needs attention'], off: ['', 'Cloud'] };
    const [dot, st] = map[this.state] || map.off;
    const n = waitingN();
    return `<div class="cloudline"><div class="st"><span class="dot ${n && this.state !== 'syncing' ? 'bad' : dot}"></span>${st}</div><p>${esc(userName(this.cfg.email))}${t ? ' · ' + t : ''}${n ? `<br><b>${n} change${n === 1 ? '' : 's'} not sent yet</b>` : ''}${this.msg ? '<br>' + esc(this.msg) : ''}</p>
      <div class="row"><button class="btn sm ghost" data-act="cloud-sync">Sync now</button></div></div>`;
  },
  /* the two emails the rules let in. Remembered in the shared settings, so the rules can be copied again
     later from either device without retyping them (a missing one used to become friend@example.com) */
  admins() { const p = [pemail('me'), pemail('friend')].filter(Boolean), s = (p.length === 2 ? p : db.settings.adminEmails || []).map(e => String(e || '').trim()).filter(Boolean);
    const me = this.cfg && this.cfg.email ? toEmail(this.cfg.email) : '';
    if (me && !s.map(toEmail).includes(me)) s.unshift(me);
    return [s[0] || '', s[1] || '']; },
  rules(a, b) {
    if (a === undefined) [a, b] = this.admins();
    const list = [a || 'you@example.com', b || 'friend@example.com'].map(e => `'${toEmail(e)}'`).join(', ');
    return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function admin() {
      return request.auth != null
        && request.auth.token.email in [${list}];
    }
    match /ledgers/{path=**} {
      allow read, write: if admin();
    }
    // online shop: anyone can read the catalog, only you two change it
    match /catalog/{id} {
      allow read: if true;
      allow write: if admin();
    }
    match /shop/{id} {
      allow read: if true;
      allow write: if admin();
    }
    // shop customers: signed in with their phone (verified by SMS) or Google (number typed in, not verified);
    // credit and down payment are yours to set
    function me(uid) {
      return request.auth != null && request.auth.uid == uid;
    }
    function changes() {
      return request.resource.data.diff(resource.data).affectedKeys();
    }
    function smsPhone() {
      return request.auth.token.get('phone_number', '');
    }
    // the SMS-checked number, or for Google customers a typed one marked unverified
    function okPhone() {
      return smsPhone() != ''
        ? request.resource.data.phone == smsPhone() && request.resource.data.verified == true
        : request.resource.data.phone is string && request.resource.data.phone.matches('^[+][0-9]{10,15}$') && request.resource.data.verified == false;
    }
    match /customers/{uid} {
      allow read: if admin() || me(uid);
      allow create: if me(uid)
        && okPhone()
        && request.resource.data.keys().hasOnly(['name', 'phone', 'verified', 'email', 'address', 'createdAt', 'updatedAt']);
      allow update: if admin() || (me(uid)
        && changes().hasOnly(['name', 'address', 'phone', 'updatedAt', 'creditRefundTo', 'creditRefundAt'])
        && (!changes().hasAny(['phone']) || (smsPhone() == '' && request.resource.data.phone.matches('^[+][0-9]{10,15}$'))));
      allow delete: if admin();
    }
    match /orders/{id} {
      allow read: if admin() || (request.auth != null && resource.data.uid == request.auth.uid);
      allow create: if request.auth != null
        && request.resource.data.uid == request.auth.uid
        && okPhone()
        && request.resource.data.status in ['new', 'requested']
        && request.resource.data.keys().hasOnly(['uid', 'phone', 'verified', 'email', 'name', 'address', 'note', 'lang', 'kind', 'status', 'method',
             'lines', 'goods', 'delivery', 'creditUsed', 'total', 'downPct', 'down', 'group', 'code', 'createdAt'])
        && (request.resource.data.creditUsed == 0
            || request.resource.data.creditUsed <= get(/databases/$(database)/documents/customers/$(request.auth.uid)).data.get('credit', 0))
        && get(/databases/$(database)/documents/shop/settings).data.open == true
        // once the order server is switched on, orders only come in through it (it holds the stock)
        && get(/databases/$(database)/documents/shop/settings).data.get('orderApi', '') == '';
      allow update: if admin() || (request.auth != null && resource.data.uid == request.auth.uid
        && changes().hasOnly(['status', 'proof', 'proofAt', 'refund', 'refundTo', 'cancelledAt', 'updatedAt'])
        && (request.resource.data.status == resource.data.status
            || (resource.data.status in ['new', 'requested', 'offered'] && request.resource.data.status == 'cancelled')
            || (resource.data.status == 'offered' && request.resource.data.status == 'new'))
        && (!changes().hasAny(['proof']) || request.resource.data.proof == true));
      allow delete: if admin();
    }
    // InstaPay screenshots, one per order, kept apart so the order list stays small and fast
    match /proofs/{id} {
      allow read: if admin();
      allow create, update: if admin() || (request.auth != null
        && get(/databases/$(database)/documents/orders/$(id)).data.uid == request.auth.uid
        && request.resource.data.uid == request.auth.uid
        && request.resource.data.keys().hasOnly(['uid', 'data', 'at'])
        && request.resource.data.data is string && request.resource.data.data.size() < 700000);
      allow delete: if admin();
    }
  }
}`;
  },
  loginFields(p) {
    return `<div class="f"><label for="${p}_user">Email</label><input id="${p}_user" type="email" inputmode="email" autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false"></div>
      <div class="f"><label for="${p}_pw">Password</label><input id="${p}_pw" type="password" autocomplete="current-password"></div>`;
  },
  settingsHTML() {
    if (this.on()) return `<div class="card" id="cloudcard" data-mode="on"><h3>Shared online ledger</h3>
      <p class="note">Signed in as <b>${esc(whoAmI() ? pname(whoAmI()) + ' (' + userName(this.cfg.email) + ')' : userName(this.cfg.email))}</b>. Changes appear on ${esc(partnerName())}’s phone within seconds. Without internet everything keeps working: changes are saved on this device and sent when the connection is back. The file on disk still works as an extra backup.</p>
      ${this.msg ? `<p class="note"><b>${esc(this.msg)}</b></p>` : ''}
      <div class="topact"><button class="btn" data-act="cloud-sync">Sync now</button><button class="btn ghost" data-act="cloud-off">Sign out on this device</button></div>
      <details class="admin" id="signins"><summary>Sign-in methods: Google and password</summary><div class="silist"></div></details>
      ${this.usageHTML()}
      <div id="cl_backups"></div>
      ${this.adminHTML()}</div>`;
    return `<div class="card" id="cloudcard" data-mode="off"><h3>Sign in to the shared ledger</h3>
      <p class="note">Sign in so you and ${esc(partnerName())} work on the same numbers from any phone or laptop.</p>
      <form class="fgrid" data-login="cl">${this.loginFields('cl')}<div class="f span"><button class="btn" style="align-self:flex-start">Sign in</button></div></form>
      <div class="gor"><span>or</span></div><div class="agsi" data-agsi="cl"></div>
      <div class="err" id="cl_msg"${this.msg ? '' : ' hidden'}>${esc(this.msg)}</div>
      ${this.adminHTML()}</div>`;
  },
  /* how much this device reads: the free plan allows 50,000 a day for both of you together */
  usageHTML() {
    const n = Reads.get().n, sy = this.syncInfo(), d = ms => esc(fDateTime(new Date(ms).toISOString()));
    return `<p class="note usage"><span>Reads by this device today:</span> <b class="notr">${n.toLocaleString('en-GB')}</b> <span>(free: 50,000 a day for both of you together).</span>
      ${this.mode === 'delta' && sy && sy.full ? `<br><span>Only changes are downloaded.</span> <span>Last full download:</span> <b class="notr">${d(sy.full)}</b> · <span>next one around</span> <b class="notr">${d(sy.full + FULL_EVERY)}</b>`
      : this.ready ? '<br><span>This device downloaded the whole ledger. From the next sync on, only changes are downloaded.</span>' : ''}</p>`;
  },
  adminHTML() {
    return `<details class="admin"><summary>Admin: add a person or update the access rules</summary>
      <ol class="setup">
        <li>In the Firebase console open <b>Authentication → Users → Add user</b>. Enter the person’s email address and choose a password for them.</li>
        <li>Type both email addresses below and copy the rules. In <b>Firestore Database → Rules</b>, paste them and press <b>Publish</b>. (First time only: <b>Firestore Database → Create database</b>, a location in Europe, production mode.)</li>
        <li>Send the person the app link with their email and password. That is all they need.</li>
      </ol>
      <div class="fgrid">
        <div class="f"><label>Your email</label><input id="ad_a" type="email" data-rules="1" autocapitalize="none" value="${esc(this.admins()[0])}"></div>
        <div class="f"><label>Friend’s email</label><input id="ad_b" type="email" data-rules="1" autocapitalize="none" value="${esc(this.admins()[1])}"></div>
        <div class="f span"><textarea id="cl_rules" readonly rows="52" style="font:12px var(--mono)">${esc(this.rules())}</textarea><button type="button" class="btn sm ghost" style="align-self:flex-start" data-act="cloud-copy">Copy rules</button></div>
      </div>
      <p class="note">Forgotten password: in Firebase open Users, click ⋮ next to the person and choose Reset password; they get an email to set a new one. Nothing in the ledger is lost.</p></details>`;
  }
};

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act^="cloud-"]'); if (!t) return;
  const a = t.dataset.act;
  if (a === 'cloud-sync') {
    await Cloud.sync();
    toast(Cloud.state === 'ok' ? 'Synced' : (Cloud.msg || offlineMsg));
  }
  if (a === 'cloud-off') { if (confirm('Disconnect this device from the shared cloud ledger?')) Cloud.disconnect(); }
  if (a === 'cloud-copy') {
    const ea = toEmail($('#ad_a').value), eb = toEmail($('#ad_b').value), okE = e => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !/@example\.com$/.test(e);
    /* rules with only one email lock the other person out of the ledger */
    if (!okE(ea) || !okE(eb) || ea === eb) return toast('⚠ Type both email addresses first: yours and your friend’s. Rules with only one lock the other person out.');
    db.settings.adminEmails = [ea, eb];
    /* keep the partners' sign-in emails in step when they weren't linked yet */
    if (!pemail('me') && !pemail('friend')) linkPartnerEmails();
    commit();
    const ta = $('#cl_rules'); ta.value = Cloud.rules(ea, eb); ta.select(); try { await navigator.clipboard.writeText(ta.value); } catch (x) { document.execCommand('copy'); } toast('Rules copied for ' + ea + ' and ' + eb);
  }
  if (a === 'cloud-skip') { localStorage.setItem('shanta-offline', '1'); hideGate(); }
  if (a === 'cloud-backup') {
    t.disabled = true; t.textContent = 'Backing up…';
    try { await Cloud.backupNow(); toast('Backup saved'); } catch (x) { toast(x.message); }
    render();
  }
  if (a === 'cloud-restore') {
    const b = (Cloud.backups || []).find(x => x.name === t.dataset.ledger);
    const label = b ? fDateTime(b.createdAt) : t.dataset.ledger;
    if (!confirm(`Restore the backup from ${label}?\n\nIt replaces ALL shipments, purchases, sales, expenses, transfers and settings in the live ledger, for you and ${partnerName()}.\nThe current live data is saved as a backup first, so you can undo this.`)) return;
    t.disabled = true; t.textContent = 'Restoring…';
    try { await Cloud.restore(t.dataset.ledger); toast('Backup restored to the live ledger'); go('overview'); }
    catch (x) { console.warn(x); alert(x.message); render(); }
  }
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
    await Cloud.connect(toEmail(user), pw);
    localStorage.removeItem('shanta-offline'); hideGate();
    toast('Welcome, ' + userName(Cloud.cfg.email)); render();
  } catch (x) {
    console.warn(x);
    if (!Cloud.on()) { Cloud.set('off', /Wrong email or password/.test(x.message) ? 'Wrong email or password.' : x.message); btn.textContent = 'Sign in'; btn.disabled = false; }
    else { hideGate(); Cloud.set('error', x.message); render(); }
  }
});
document.addEventListener('input', e => {
  if (!e.target.dataset.rules) return;
  const ta = $('#cl_rules'); if (ta) ta.value = Cloud.rules($('#ad_a').value.trim(), $('#ad_b').value.trim());
});

/* ---------- full-screen sign-in on first open ---------- */
function showGate(msg) {
  if ($('#gate')) return;
  const g = document.createElement('div'); g.id = 'gate';
  g.innerHTML = `<div class="gatebox"><div class="logo">€<span>⇄</span>£E</div><h1>Shanta dm</h1><p class="note">${esc(msg || 'Sign in to open the shared ledger')}</p>
    <form data-login="g">${Cloud.loginFields('g')}<button class="btn">Sign in</button></form>
    <div class="gor"><span>or</span></div><div class="agsi" data-agsi="g"></div>
    <div class="err" id="g_msg" hidden></div>
    <button type="button" class="linkbtn" data-act="cloud-skip">Use without signing in on this device</button></div>`;
  document.body.appendChild(g);
  setTimeout(() => $('#g_user') && $('#g_user').focus(), 50);
}
function hideGate() { const g = $('#gate'); if (g) g.remove(); }
if (Cloud.legacy()) { localStorage.removeItem('shanta-offline'); showGate('The app now uses a new, faster database. Please sign in once more; nothing is lost.'); }
else if (!Cloud.on() && !localStorage.getItem('shanta-offline')) showGate();

/* ---------- Sign in with Google ----------
   Google's own button needs the Web client ID. It is in Settings → Online shop, and also in the shop's
   public settings, so a new device can show the button before anyone has signed in. */
const AGSI_KEY = 'shanta-gid';
async function adminGid() {
  const s = (typeof db !== 'undefined' && db.settings && db.settings.shopGoogleId) || localStorage.getItem(AGSI_KEY);
  if (s) return s;
  try { const f = await fb(), d = await within(f.S.getDoc(f.S.doc(f.fs, 'shop', 'settings')), 8000, offlineMsg);
    const v = d.exists() && d.data().googleClientId; if (v) { localStorage.setItem(AGSI_KEY, v); return v; } } catch (e) { }
  return '';
}
const agsiScript = () => agsiScript.p || (agsiScript.p = new Promise((ok, no) => { const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = ok; s.onerror = () => { agsiScript.p = null; no(new Error('gsi')); }; document.head.appendChild(s); }));
function agsiMsg(el, m) {
  const g = el.dataset.agsi === 'g' ? $('#g_msg') : null;
  if (g) { g.textContent = m; g.hidden = !m; } else Cloud.set('off', m);
}
async function agsiDone(el, token) {
  el.innerHTML = '<p class="note">Signing in…</p>'; agsiMsg(el, '');
  try {
    await Cloud.connectGoogle(token);
    localStorage.removeItem('shanta-offline'); hideGate();
    toast('Welcome, ' + userName(Cloud.cfg.email)); render();
  } catch (x) {
    console.warn(x);
    if (!Cloud.on()) { agsiMsg(el, x.message); delete el.dataset.on; agsiMount(); }
    else { hideGate(); Cloud.set('error', x.message); render(); }
  }
}
async function agsiMount() {
  const els = [...document.querySelectorAll('[data-agsi]:not([data-on])')]; if (!els.length) return;
  els.forEach(el => el.dataset.on = '1');
  const fallback = el => { el.innerHTML = `<button type="button" class="btn ghost gbtn">${'<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.4 5.7c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.7l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>'}Sign in with Google</button>`;
    el.querySelector('button').onclick = () => agsiDone(el, null); };
  const gid = await adminGid();
  if (!gid) return els.forEach(fallback);
  try { await agsiScript(); } catch (e) { return els.forEach(fallback); }
  const id = window.google.accounts.id;
  els.forEach(el => {
    if (!document.body.contains(el)) return;
    /* one callback for the whole page: the button that was tapped last receives the account */
    id.initialize({ client_id: gid, callback: r => agsiDone(agsiMount.last || el, r.credential), ux_mode: 'popup', auto_select: false, use_fedcm_for_button: true });
    el.addEventListener('pointerdown', () => agsiMount.last = el, true);
    id.renderButton(el, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', logo_alignment: 'center',
      locale: document.documentElement.lang === 'ar' ? 'ar' : 'en', width: Math.min(400, Math.max(220, el.clientWidth || 320)) });
  });
}
/* the sign-in boxes are redrawn often (Settings, the opening screen): add the button whenever one appears */
new MutationObserver(() => { if (document.querySelector('[data-agsi]:not([data-on])')) agsiMount(); }).observe(document.body, { childList: true, subtree: true });
agsiMount();

/* ---------- banner while the shared ledger can't be reached ----------
   Offline, Firestore refusing (rules, daily limit), or changes the cloud hasn't confirmed for a minute: what's on
   screen may be only this device's copy. Shown after a short pause so a brief blip doesn't flash it */
const waitingN = () => Cloud.on() && !Cloud.isBackup() ? Outbox.count(Cloud.ledger()) : 0;
function cloudBanner() {
  const n = waitingN(), stuck = n > 0 && Cloud.ready && Date.now() - (Cloud.outSince || Date.now()) > 6e4;
  if (n && !Cloud.outSince) Cloud.outSince = Date.now(); if (!n) Cloud.outSince = 0;
  const bad = Cloud.on() && (Cloud.state === 'offline' || Cloud.state === 'error' || stuck);
  let b = document.getElementById('cloudbanner');
  if (!bad) { clearTimeout(cloudBanner.t); cloudBanner.t = null; if (b) b.remove(); document.body.classList.remove('hasbanner');
    if (n) { clearTimeout(cloudBanner.w); cloudBanner.w = setTimeout(cloudBanner, 61000); } return; }
  const show = () => {
    cloudBanner.t = null;
    const n = waitingN();
    if (!(Cloud.on() && (Cloud.state === 'offline' || Cloud.state === 'error' || n))) return;
    b = document.getElementById('cloudbanner');
    if (!b) { b = document.createElement('div'); b.id = 'cloudbanner'; b.setAttribute('role', 'status'); document.body.prepend(b); }
    const off = Cloud.state === 'offline', wait = n ? ` <b class="cbn">${n} change${n === 1 ? '' : 's'} not sent yet</b>` : '';
    b.className = off ? 'off' : 'err';
    b.innerHTML = `<span class="cbi" aria-hidden="true">${off ? '⚡' : '!'}</span><span class="cbt"><b>${off ? 'Offline' : 'Not syncing with the shared ledger'}</b><span>${off
      ? 'You see this device’s copy. Changes are saved here and sent when the connection is back.'
      : 'You may be seeing an old copy. Changes are kept on this device and sent again. Don’t edit on both devices until this is fixed.'}${Cloud.msg && !off ? ' ' + esc(Cloud.msg) : ''}${wait}</span></span><button type="button" class="btn sm" data-act="cloud-sync">${n ? 'Send now' : 'Try again'}</button>`;
    document.body.classList.add('hasbanner');
  };
  if (b) show(); else if (!cloudBanner.t) cloudBanner.t = setTimeout(show, 4000);
}
window.addEventListener('online', () => { if (Cloud.on() && Cloud.state !== 'ok') Cloud.sync(); });
window.addEventListener('offline', () => { if (Cloud.on()) Cloud.set('offline', offlineMsg); });

/* ---------- copies of the ledger kept on this device ----------
   One a day (the last 7 days), plus one whenever entries are left out on reconnecting. In the browser's own
   database (IndexedDB), so they don't take room from the ledger itself. Settings → Backup & sync lists them */
const LocalCopies = {
  open() {
    return this.p || (this.p = new Promise((ok, no) => {
      const r = indexedDB.open('shanta-copies', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('copies', { keyPath: 'key' });
      r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
    }));
  },
  async tx(mode, fn) { const d = await this.open(); return new Promise((ok, no) => { const t = d.transaction('copies', mode), s = t.objectStore('copies'), r = fn(s); t.oncomplete = () => ok(r && r.result); t.onerror = () => no(t.error); }); },
  async list() { try { const all = await this.tx('readonly', s => s.getAll()); return (all || []).sort((a, b) => String(b.at).localeCompare(String(a.at))); } catch (e) { return []; } },
  async get(key) { try { return await this.tx('readonly', s => s.get(key)); } catch (e) { return null; } },
  count: d => COLLS.reduce((t, c) => t + (d[c] || []).length, 0),
  async save(reason, data, key) {
    try {
      const at = new Date().toISOString();
      await this.tx('readwrite', s => s.put({ key: key || 'x-' + at, at, reason, n: this.count(data), data: JSON.stringify(data) }));
      /* keep the last 7 daily copies and the last 10 others */
      const all = await this.list(), daily = all.filter(c => c.key.startsWith('d-')), other = all.filter(c => !c.key.startsWith('d-'));
      const drop = daily.slice(7).concat(other.slice(10));
      if (drop.length) await this.tx('readwrite', s => { drop.forEach(c => s.delete(c.key)); });
    } catch (e) { console.warn('local copy', e); }
  },
  /* once a day, the first time the ledger is in a good state (synced, or not using the cloud) */
  async daily() {
    const key = 'd-' + today();
    if (this.count(db) === 0 || await this.get(key)) return;
    await this.save('Daily copy', db, key);
  }
};
setTimeout(() => LocalCopies.daily(), 20000); setInterval(() => LocalCopies.daily(), 36e5);

/* "not sent yet" mark for entries the cloud hasn't confirmed (a sale counts if any of its lines is waiting) */
function unsentTag(coll, id) {
  if (!waitingN()) return '';
  const l = Cloud.ledger(), it = Outbox.items(l);
  const hit = coll === 'sales' ? db.sales.some(s => (s.orderId || s.id) === id && ('sales/' + s.id) in it) || ('sales/' + id) in it : (coll + '/' + id) in it;
  return hit ? ' <span class="pill bad unsent" title="Saved on this device, not in the shared ledger yet">not sent</span>' : '';
}
/* the list under Settings → Backup & sync, filled when opened */
document.addEventListener('toggle', async e => {
  if (e.target.id !== 'lcopies' || !e.target.open) return;
  const box = e.target.querySelector('.lclist'), all = await LocalCopies.list();
  box.innerHTML = all.length ? `<ul class="mini">${all.map(c => `<li><span>${esc(fDateTime(c.at))} · ${esc(c.reason)} · <span class="notr">${c.n}</span> entries</span><button type="button" class="btn sm ghost" data-lcopy="${esc(c.key)}">Download</button></li>`).join('')}</ul>`
    : '<p class="note">No copies yet. The first one is made a minute after opening Shanta.</p>';
}, true);
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-lcopy]'); if (!b) return;
  const c = await LocalCopies.get(b.dataset.lcopy); if (!c) return toast('⚠ That copy is gone.');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([c.data], { type: 'application/json' }));
  a.download = `shanta-copy-${c.at.slice(0, 16).replace(/[:T]/g, '-')}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

/* ---------- save status: a card that stays until it's dismissed ----------
   Each change sent to the shared ledger shows what was saved and how it went: sending → saved, failed (with the
   reason, and it's sent again), or offline (kept on this device). Settings-only changes don't show it.
   It sits above open dialogs (popover) so it's seen after any save */
const SAVE_NAMES = { shipments: ['box', 'boxes'], purchases: ['purchase', 'purchases'], sales: ['sale', 'sales'], payments: ['payment', 'payments'], expenses: ['expense', 'expenses'], transfers: ['transfer', 'transfers'] };
function describePatch(patch) {
  const by = {}, del = {}, orders = new Set();
  Object.entries(patch).forEach(([k, v]) => { const [c, id, f] = k.split('/'); if (c === 'settings' || !SAVE_NAMES[c]) return;
    const key = c + '/' + id;
    if (v === null && f === undefined) { (del[c] = del[c] || new Set()).add(id); return; }
    (by[c] = by[c] || new Set()).add(id);
    if (c === 'sales') { const r = db.sales.find(s => s.id === id); orders.add(r ? (r.orderId || r.id) : id); } });
  const parts = [];
  Object.entries(by).forEach(([c, s]) => {
    if (c === 'sales') { const n = orders.size, who = [...orders].map(o => { const r = db.sales.find(s => (s.orderId || s.id) === o); return r && r.customer; }).filter(Boolean);
      parts.push(`${n} ${SAVE_NAMES.sales[n === 1 ? 0 : 1]}${who.length === 1 ? ' for ' + who[0] : ''} (${s.size} line${s.size === 1 ? '' : 's'})`); }
    else parts.push(`${s.size} ${SAVE_NAMES[c][s.size === 1 ? 0 : 1]}`); });
  const nd = Object.entries(del).reduce((t, [c, s]) => t + [...s].filter(id => {
    /* a line taken out of a sale that is saved now is part of that sale's update, not a deleted entry */
    if (c !== 'sales' || !Cloud.base || !Cloud.base.sales[id]) return true;
    const r = JSON.parse(Cloud.base.sales[id]); return !orders.has(r.orderId || r.id); }).length, 0);
  if (nd) parts.push(`${nd} entr${nd === 1 ? 'y' : 'ies'} deleted`);
  return parts.join(' · ');
}
const SaveStatus = {
  seq: 0, jobs: {},
  el() {
    let b = document.getElementById('savestat');
    if (!b) { b = document.createElement('div'); b.id = 'savestat'; b.setAttribute('role', 'status'); b.setAttribute('aria-live', 'polite');
      if ('popover' in b) b.setAttribute('popover', 'manual'); document.body.appendChild(b); }
    return b;
  },
  start(what) { const id = ++this.seq; this.jobs[id] = { what, st: 'sending', at: Date.now() }; this.draw(id);
    this.jobs[id].t = setTimeout(() => { const j = this.jobs[id]; if (j && j.st === 'sending') { j.st = navigator.onLine ? 'slow' : 'offline'; this.draw(id); } }, 6000);
    return id; },
  ok(id) { const j = this.jobs[id]; if (!j) return; clearTimeout(j.t); const late = j.st !== 'sending'; j.st = 'ok'; this.draw(id, late); },
  fail(id, msg) { const j = this.jobs[id]; if (!j) return; clearTimeout(j.t); j.st = 'fail'; j.msg = msg; this.draw(id, true); },
  draw(id, force) {
    const j = this.jobs[id], b = this.el();
    /* a newer save takes the card; an older one only comes back to report something that went wrong or arrived late */
    if (id !== this.cur && !force && this.cur && this.jobs[this.cur] && b.classList.contains('on') && id < this.cur) return;
    this.cur = id;
    const T = { sending: ['…', 'Saving…', 'Sending to the shared ledger.'], ok: ['✓', 'Saved', 'In the shared ledger, so it’s on both of your devices.'],
      slow: ['…', 'Still sending…', 'The connection is slow. It’s kept on this device until it arrives.'],
      offline: ['⚡', 'Saved on this device only', 'You’re offline. It’s sent automatically when the connection is back.'],
      fail: ['!', 'Not saved in the shared ledger', 'It’s kept on this device and sent again automatically.'] }[j.st];
    b.className = 'on ' + j.st;
    b.innerHTML = `<span class="ssi" aria-hidden="true">${T[0]}</span><span class="sst"><b>${T[1]}</b><span class="sswhat notr">${esc(j.what)}</span><span>${T[2]}${j.msg ? ' ' + esc(j.msg) : ''}</span></span>
      <span class="ssact">${j.st === 'fail' || j.st === 'offline' || j.st === 'slow' ? '<button type="button" class="btn sm ghost" data-act="cloud-sync">Try again</button>' : ''}<button type="button" class="btn sm" data-ssclose="">OK</button></span>`;
    try { if (b.matches && b.hasAttribute('popover')) { if (b.matches(':popover-open')) b.hidePopover(); b.showPopover(); } } catch (e) { }
  },
  close() { const b = document.getElementById('savestat'); if (!b) return; b.classList.remove('on'); try { if (b.matches(':popover-open')) b.hidePopover(); } catch (e) { } this.cur = 0; }
};
document.addEventListener('click', e => { if (e.target.closest('[data-ssclose]')) SaveStatus.close(); });

/* ---------- sign-in methods: Google and a password on the same account ----------
   Both sit on one Firebase account (same email), so the access rules treat them the same. Adding Google here,
   while signed in, is the safe way: the first Google sign-in on the sign-in screen for an unverified password
   account lets Google take the account over, and the password stops working */
const SignIns = {
  user() { return F && F.auth && F.auth.currentUser; },
  has(u, p) { return !!(u && u.providerData.some(x => x.providerId === p)); },
  async draw(msg, bad) {
    const box = document.querySelector('#signins .silist'); if (!box) return;
    const u = this.user();
    if (!u) { box.innerHTML = '<p class="note">Connecting to the cloud… Open this again in a moment.</p>'; return; }
    try { await u.reload(); } catch (e) { }
    const g = this.has(u, 'google.com'), pw = this.has(u, 'password'), ok = u.emailVerified;
    const row = (on, name, end) => `<li><span>${on ? '✓' : '–'} <span>${name}</span></span>${end}</li>`;
    box.innerHTML = `<p class="note">Both open the same account (<b class="notr">${esc(u.email || '')}</b>) and the same ledger.</p>
      <ul class="mini sirows">
        ${row(g, 'Google', g ? '<span class="pill ok">on</span>' : '<button type="button" class="btn sm" data-si="google">Add Google sign-in</button>')}
        ${row(pw, 'Email and password', pw ? '<span class="pill ok">on</span>' : '<span class="pill">off</span>')}
        ${row(ok, 'Email address verified', ok ? '<span class="pill ok">yes</span>' : pw ? '<button type="button" class="btn sm ghost" data-si="verify">Send verification email</button>' : '<span class="pill warn">no</span>')}
      </ul>
      ${pw && !g && !ok ? '<p class="note"><b>Add Google here, not on the sign-in screen.</b> Until the email is verified, signing in with Google there replaces the password.</p>' : ''}
      <form class="fgrid" data-siform="1">
        <div class="f"><label for="si_pw">${pw ? 'New password' : 'Password to add'}</label><input id="si_pw" type="password" autocomplete="new-password"></div>
        <div class="f"><label for="si_pw2">Repeat the password</label><input id="si_pw2" type="password" autocomplete="new-password"></div>
        <div class="f span"><button class="btn sm" style="align-self:flex-start">${pw ? 'Change password' : 'Add a password'}</button></div>
      </form>
      <div class="${bad ? 'err' : 'note'}" id="si_msg"${msg ? '' : ' hidden'}>${esc(msg || '')}</div>`;
  },
  err(e) {
    if (e && e.si) return e.si;
    const c = String(e && (e.code || e.message) || e);
    if (/weak-password/.test(c)) return 'The password needs at least 6 characters.';
    if (/requires-recent-login/.test(c)) return 'For safety, Firebase wants a fresh sign-in first: sign out on this device, sign in again, then try once more.';
    if (/credential-already-in-use|email-already-in-use|account-exists/.test(c)) return 'That Google account is already a separate user in Firebase. In Authentication → Users, delete that extra user (not the one with your password), then try again.';
    if (/provider-already-linked/.test(c)) return 'This sign-in method is already on.';
    if (/popup-blocked/.test(c)) return 'The browser blocked the Google window. Allow pop-ups for this site and try again.';
    if (/popup-closed|cancelled-popup/.test(c)) return 'The Google window closed before finishing.';
    if (/too-many-requests/.test(c)) return 'Too many attempts. Wait a few minutes and try again.';
    if (/network/.test(c)) return netMsg;
    return 'That didn’t work: ' + c;
  },
  /* changing sign-in methods needs a recent sign-in; with Google on the account, that is one more Google window */
  async run(fn) {
    const u = this.user(); if (!u) throw { si: 'Not connected to the cloud yet. Try again in a moment.' };
    try { return await fn(u); }
    catch (e) {
      if (!/requires-recent-login/.test(e.code || '') || !this.has(u, 'google.com')) throw e;
      const pr = new F.U.GoogleAuthProvider(); pr.setCustomParameters({ login_hint: u.email || '' });
      await F.U.reauthenticateWithPopup(u, pr);
      return fn(u);
    }
  },
  async addGoogle() {
    await this.run(async u => {
      const pr = new F.U.GoogleAuthProvider(); pr.setCustomParameters({ prompt: 'select_account', login_hint: u.email || '' });
      const r = await F.U.linkWithPopup(u, pr), gi = r.user.providerData.find(x => x.providerId === 'google.com');
      /* another Google account would open this ledger under a different email: take it off again */
      if (gi && gi.email && gi.email.toLowerCase() !== String(u.email || '').toLowerCase()) {
        await F.U.unlink(u, 'google.com');
        throw { si: `That was ${gi.email}. Choose the Google account ${u.email} instead.` };
      }
    });
  },
  async setPassword(pw) {
    await this.run(u => this.has(u, 'password') ? F.U.updatePassword(u, pw) : F.U.linkWithCredential(u, F.U.EmailAuthProvider.credential(u.email, pw)));
  }
};
document.addEventListener('toggle', e => { if (e.target.id === 'signins' && e.target.open) SignIns.draw(); }, true);
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-si]'); if (!b) return;
  b.disabled = true;
  try {
    if (b.dataset.si === 'verify') { const u = SignIns.user(); await F.U.sendEmailVerification(u); SignIns.draw(`Sent to ${u.email}. Open the link in it (check spam too), then open this section again.`); }
    if (b.dataset.si === 'google') { await SignIns.addGoogle(); SignIns.draw('Google sign-in added. Google and the password now both open this account.'); }
  } catch (x) { console.warn(x); SignIns.draw(SignIns.err(x), true); }
  finally { b.disabled = false; }
});
document.addEventListener('submit', async e => {
  if (!e.target.closest('[data-siform]')) return;
  e.preventDefault();
  const a = $('#si_pw').value, b = $('#si_pw2').value;
  if (a.length < 6) return SignIns.draw('The password needs at least 6 characters.', true);
  if (a !== b) return SignIns.draw('The two passwords are different.', true);
  const had = SignIns.has(SignIns.user(), 'password');
  try { await SignIns.setPassword(a); SignIns.draw(had ? 'Password changed.' : 'Password added. You can now also sign in with this email and password.'); }
  catch (x) { console.warn(x); SignIns.draw(SignIns.err(x), true); }
});
