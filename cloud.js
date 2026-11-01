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
  apiKey: 'AIzaSyAa9fTvt1RxGFDGf1rWFLBB_gvVlaOkphM',
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

/* ---- snapshots: { settings: {key: json}, <coll>: {id: json} }, compared as strings ---- */
/* 'autosave' belongs to this device only */
const LOCAL_KEYS = ['autosave'];
const emptySnap = () => { const o = { settings: {} }; COLLS.forEach(c => o[c] = {}); return o; };
const cloneSnap = s => { const o = { settings: Object.assign({}, s.settings) }; COLLS.forEach(c => o[c] = Object.assign({}, s[c] || {})); return o; };
function snapSettings(s) { const o = {}; Object.entries(s || {}).forEach(([k, v]) => { if (!LOCAL_KEYS.includes(k) && v !== undefined && v !== null) o[k] = stable(v); }); return o; }
function snapLocal(d) { const o = { settings: snapSettings(d.settings) }; COLLS.forEach(c => { o[c] = {}; d[c].forEach(r => o[c][r.id] = stable(r)); }); return o; }
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
const setRef = l => F.S.doc(F.fs, 'ledgers', l, 'meta', 'settings');
const infoRef = l => F.S.doc(F.fs, 'ledgers', l, 'meta', 'info');
const backupsCol = () => F.S.collection(F.fs, 'ledgers', CLOUD.ledger, 'backups');
/* Firestore errors in words */
function fsMsg(e) {
  const c = e && e.code || '';
  if (c === 'permission-denied' || c === 'unauthenticated') return rulesMsg();
  if (c === 'not-found' || c === 'failed-precondition' && /database/i.test(e.message)) return 'The Firestore database hasn’t been created yet. See “Admin” below.';
  if (c === 'unavailable' || e && e.timeout) return offlineMsg;
  return 'Cloud error: ' + (e && (e.message || c) || e);
}

const Cloud = {
  cfg: JSON.parse(localStorage.getItem('shanta-cloud') || 'null'),
  /* the last state this device saw confirmed by the server: anything in db that differs from it
     was changed here and is (re)sent when the app connects */
  base: JSON.parse(localStorage.getItem('shanta-cloud-base') || 'null'),
  remote: null, ready: false, state: 'off', msg: '', last: null, busy: false, unsubs: [], backups: null,
  on() { return !!(this.cfg && this.cfg.fs); },
  /* signed in with the previous version of the app: needs to sign in once more */
  legacy() { return !!(this.cfg && !this.cfg.fs); },
  ledger() { return (this.cfg && this.cfg.ledger) || CLOUD.ledger; },
  saveCfg() { localStorage.setItem('shanta-cloud', JSON.stringify(this.cfg)); },
  saveBase() { clearTimeout(this.bt); this.bt = setTimeout(() => { if (this.ready && this.on()) localStorage.setItem('shanta-cloud-base', JSON.stringify(this.base)); }, 800); },
  set(state, msg) { this.state = state; this.msg = msg || ''; renderFile(); const c = $('#cloudcard'); if (c) { if (this.on() !== (c.dataset.mode === 'on')) { c.outerHTML = this.settingsHTML(); this.fillBackups(); } else { const m = $('#cl_msg'); if (m) { m.textContent = this.msg; m.hidden = !this.msg; } } } const gm = $("#g_msg"); if (gm) { gm.textContent = this.msg; gm.hidden = !this.msg; } const lm = $("#ldmsg"); if (lm && this.msg) lm.textContent = this.msg; },

  async connect(email, pw) {
    let f; try { f = await fb(); } catch (e) { throw new Error(netMsg); }
    try { await f.U.signInWithEmailAndPassword(f.auth, email, pw); } catch (e) { throw new Error(authMsg(e.code || e.message)); }
    /* a base from the old app that belongs to a backup ledger must not be replayed onto the live one */
    if (this.legacy() && this.cfg.ledger !== CLOUD.ledger) this.base = null;
    this.cfg = { fs: 1, email, ledger: CLOUD.ledger }; this.saveCfg();
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
      try { const s = await within(F.S.getDocFromServer(infoRef(CLOUD.ledger)), 20000, offlineMsg); d = s.exists() ? s.data() : {}; }
      catch (e) {
        if (e.code === 'permission-denied' || e.code === 'not-found' || e.code === 'failed-precondition') throw new Error(fsMsg(e));
        this.set('offline', navigator.onLine ? 'Can’t reach Firestore. If this stays, check that the Firestore database was created (see “Admin” in Settings).' : offlineMsg); await sleep(6000); continue;
      }
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
    this.stopListen();
    const l = this.ledger(), got = {};
    this.base0 = this.switching ? null : (this.base ? cloneSnap(this.base) : null);
    this.remote = emptySnap(); this.base = emptySnap();
    const done = k => { got[k] = true; if (!this.ready && ['settings'].concat(COLLS).every(x => got[x])) this.becomeReady(); };
    /* a listener that fails stops for good: start them all again after a pause, instead of
       waiting for a page refresh */
    const fail = e => {
      console.warn(e); this.set(e.code === 'unavailable' ? 'offline' : 'error', fsMsg(e));
      clearTimeout(this.rt);
      this.rt = setTimeout(() => { if (this.on() && this.unsubs.length) this.listen(); }, e.code === 'permission-denied' ? 20000 : 5000);
    };
    COLLS.forEach(c => this.unsubs.push(F.S.onSnapshot(F.S.collection(F.fs, 'ledgers', l, c), { includeMetadataChanges: true }, snap => {
      snap.docChanges({ includeMetadataChanges: true }).forEach(ch => {
        const id = ch.doc.id;
        if (ch.type === 'removed') { delete this.remote[c][id]; delete this.base[c][id]; return; }
        const s = stable(Object.assign({}, ch.doc.data(), { id }));
        this.remote[c][id] = s;
        if (!ch.doc.metadata.hasPendingWrites) this.base[c][id] = s;
      });
      if (!snap.metadata.fromCache) done(c);
      this.changed(c);
    }, fail)));
    this.unsubs.push(F.S.onSnapshot(setRef(l), { includeMetadataChanges: true }, d => {
      this.remote.settings = snapSettings(d.exists() ? d.data() : {});
      if (!d.metadata.hasPendingWrites) this.base.settings = Object.assign({}, this.remote.settings);
      if (!d.metadata.fromCache) done('settings');
      this.changed('settings');
    }, fail));
  },
  /* first complete picture from the server: merge in what this device changed while it wasn't connected */
  becomeReady() {
    const remote = this.remote, local = snapLocal(db);
    let pending = {};
    if (!this.switching) {
      const base0 = this.base0;
      if (base0) pending = snapDiff(local, fixBase(base0, remote), remote);
      else {
        /* nothing known about this device: the cloud is the shared ledger and wins. Only entries the
           cloud has never seen (e.g. made without signing in) can be added, and only when asked */
        const own = [];
        COLLS.forEach(c => Object.keys(local[c]).forEach(id => { if (!(id in remote[c])) own.push(c + '/' + id); }));
        const n = own.length;
        if (n && (!snapHasData(remote) || confirm(`This device has ${n} entr${n === 1 ? 'y' : 'ies'} that ${n === 1 ? 'is' : 'are'} not in the shared ledger.\n\nOK = add ${n === 1 ? 'it' : 'them'} to the shared ledger\nCancel = use only the shared ledger on this device`)))
          own.forEach(k => { const [c, id] = k.split('/'); pending[k] = JSON.parse(local[c][id]); });
        /* an empty cloud gets this device's settings; otherwise the cloud's settings win */
        if (!Object.keys(remote.settings).length) Object.entries(local.settings).forEach(([k, v]) => pending['settings/' + k] = JSON.parse(v));
      }
    }
    this.switching = false; this.base0 = null; this.ready = true;
    this.fromRemote(snapApply(cloneSnap(remote), pending));
    if (Object.keys(pending).length) this.write(pending);
    this.last = new Date(); this.set('ok'); this.saveBase();
    /* always redraw: the screen may still show the loading view */
    render();
    (this.readyWaiters || []).forEach(r => r()); this.readyWaiters = [];
  },
  whenReady(ms) { return this.ready ? Promise.resolve() : within(new Promise(r => (this.readyWaiters = this.readyWaiters || []).push(r)), ms, offlineMsg).catch(() => { }); },
  changed() {
    if (!this.ready) return;
    this.saveBase();
    clearTimeout(this.ct); this.ct = setTimeout(() => this.fromRemote(this.remote), 40);
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
  /* patch paths → Firestore writes; fields of one entry go in one merge */
  write(patch, applied) {
    if (!applied) snapApply(this.remote, patch);
    const l = this.ledger(), docs = {}, ops = [], st = {};
    Object.entries(patch).forEach(([k, v]) => {
      const [c, id, f] = k.split('/');
      if (c === 'settings') st[id] = v === null ? F.S.deleteField() : v;
      else if (f === undefined) ops.push(v === null ? b => b.delete(docRef(l, c, id)) : b => b.set(docRef(l, c, id), v));
      else { const d = docs[c + '/' + id] || (docs[c + '/' + id] = { c, id, v: {} }); d.v[f] = v === null ? F.S.deleteField() : v; }
    });
    Object.values(docs).forEach(d => ops.push(b => b.set(docRef(l, d.c, d.id), d.v, { merge: true })));
    if (Object.keys(st).length) ops.push(b => b.set(setRef(l), st, { merge: true }));
    for (let i = 0; i < ops.length; i += 400) {
      const b = F.S.writeBatch(F.fs); ops.slice(i, i + 400).forEach(o => o(b));
      b.commit().catch(e => { console.warn(e); this.set('error', fsMsg(e)); });
    }
    this.set('syncing');
    clearTimeout(this.wt); this.wt = setTimeout(() => this.settle(), 50);
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
    this.push();
    await this.settle();
  },
  /* a whole ledger from the server */
  async readLedger(l) {
    const o = emptySnap();
    for (const c of COLLS) (await within(F.S.getDocsFromServer(F.S.collection(F.fs, 'ledgers', l, c)), 30000, offlineMsg)).forEach(d => o[c][d.id] = stable(Object.assign({}, d.data(), { id: d.id })));
    const s = await within(F.S.getDocFromServer(setRef(l)), 30000, offlineMsg);
    o.settings = snapSettings(s.exists() ? s.data() : {});
    return o;
  },

  /* ---- backups: a backup is a full copy stored as its own ledger, listed in ledgers/shared/backups ---- */
  async snapshot(reason, src, from = this.ledger()) {
    src = src || (this.ready && from === this.ledger() ? cloneSnap(this.remote) : await this.readLedger(from));
    const counts = {}; COLLS.forEach(c => counts[c] = Object.keys(src[c]).length);
    if (!COLLS.some(c => counts[c])) return null;
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const name = `backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const ops = [];
    COLLS.forEach(c => Object.entries(src[c]).forEach(([id, s]) => ops.push(b => b.set(docRef(name, c, id), JSON.parse(s)))));
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
      COLLS.forEach(c => Object.keys(this.remote[c]).forEach(id => ops.push(b => b.delete(docRef(l, c, id)))));
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
      const ops = [];
      COLLS.forEach(c => {
        Object.keys(live[c]).forEach(id => { if (!(id in src[c])) ops.push(b => b.delete(docRef(CLOUD.ledger, c, id))); });
        Object.entries(src[c]).forEach(([id, s]) => ops.push(b => b.set(docRef(CLOUD.ledger, c, id), JSON.parse(s))));
      });
      const st = {}; Object.entries(src.settings).forEach(([k, v]) => st[k] = JSON.parse(v));
      if (Object.keys(st).length) ops.push(b => b.set(setRef(CLOUD.ledger), st));
      await this.writeAll(ops);
      this.backups = null;
    } finally { this.busy = false; }
    await this.openLedger(CLOUD.ledger);
  },
  async listBackups() {
    await fb();
    const q = await within(F.S.getDocs(backupsCol()), 20000, offlineMsg);
    this.backups = q.docs.map(d => Object.assign({ name: d.id }, d.data())).sort((a, b) => b.name.localeCompare(a.name));
    return this.backups;
  },
  async openLedger(name) {
    await this.sync();
    if (this.state !== 'ok') throw new Error('Couldn’t reach the cloud. ' + this.msg);
    this.cfg.ledger = name; this.saveCfg();
    /* show exactly what is in that ledger; nothing from the previous one is carried over */
    this.switching = true; this.base = null; localStorage.removeItem('shanta-cloud-base');
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
    try { await this.listBackups(); } catch (e) { this.backups = []; }
    const el2 = $('#cl_backups'); if (el2) el2.innerHTML = this.backupsHTML();
  },

  statusHTML() {
    if (!this.on()) return '';
    const t = this.last ? this.last.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    const map = { syncing: ['', 'Syncing…'], ok: ['ok', 'Shared in the cloud'], offline: ['bad', 'Offline, saved on this device'], error: ['bad', 'Cloud needs attention'], off: ['', 'Cloud'] };
    const [dot, st] = map[this.state] || map.off;
    return `<div class="cloudline"><div class="st"><span class="dot ${dot}"></span>${st}</div><p>${esc(userName(this.cfg.email))}${t ? ' · ' + t : ''}${this.msg ? '<br>' + esc(this.msg) : ''}</p>
      <div class="row"><button class="btn sm ghost" data-act="cloud-sync">Sync now</button></div></div>`;
  },
  rules(a, b) {
    const list = [a || 'you@example.com', b || 'friend@example.com'].map(e => `'${toEmail(e)}'`).join(', ');
    return `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /ledgers/{path=**} {
      allow read, write: if request.auth != null
        && request.auth.token.email in [${list}];
    }
  }
}`;
  },
  loginFields(p) {
    return `<div class="f"><label for="${p}_user">Email</label><input id="${p}_user" type="email" inputmode="email" autocomplete="email" autocapitalize="none" autocorrect="off" spellcheck="false"></div>
      <div class="f"><label for="${p}_pw">Password</label><input id="${p}_pw" type="password" autocomplete="current-password"></div>`;
  },
  settingsHTML() {
    if (this.on()) return `<div class="card span2" id="cloudcard" data-mode="on"><h3>Shared online ledger</h3>
      <p class="note">Signed in as <b>${esc(userName(this.cfg.email))}</b>. Changes appear on ${esc(db.settings.friendName)}’s phone within seconds. Without internet everything keeps working: changes are saved on this device and sent when the connection is back. The file on disk still works as an extra backup.</p>
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
        <li>Type both email addresses below and copy the rules. In <b>Firestore Database → Rules</b>, paste them and press <b>Publish</b>. (First time only: <b>Firestore Database → Create database</b>, a location in Europe, production mode.)</li>
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
  if (a === 'cloud-sync') {
    await Cloud.sync();
    toast(Cloud.state === 'ok' ? 'Synced' : (Cloud.msg || offlineMsg));
  }
  if (a === 'cloud-off') { if (confirm('Disconnect this device from the shared cloud ledger?')) Cloud.disconnect(); }
  if (a === 'cloud-copy') { const ta = $('#cl_rules'); ta.select(); try { await navigator.clipboard.writeText(ta.value); } catch (x) { document.execCommand('copy'); } toast('Rules copied'); }
  if (a === 'cloud-skip') { localStorage.setItem('shanta-offline', '1'); hideGate(); }
  if (a === 'cloud-backup') {
    t.disabled = true; t.textContent = 'Backing up…';
    try { await Cloud.backupNow(); toast('Backup saved'); } catch (x) { toast(x.message); }
    render();
  }
  if (a === 'cloud-restore') {
    const b = (Cloud.backups || []).find(x => x.name === t.dataset.ledger);
    const label = b ? fDateTime(b.createdAt) : t.dataset.ledger;
    if (!confirm(`Restore the backup from ${label}?\n\nIt replaces ALL shipments, purchases, sales, expenses, transfers and settings in the live ledger, for you and ${db.settings.friendName}.\nThe current live data is saved as a backup first, so you can undo this.`)) return;
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
    <div class="err" id="g_msg" hidden></div>
    <button type="button" class="linkbtn" data-act="cloud-skip">Use without signing in on this device</button></div>`;
  document.body.appendChild(g);
  setTimeout(() => $('#g_user') && $('#g_user').focus(), 50);
}
function hideGate() { const g = $('#gate'); if (g) g.remove(); }
if (Cloud.legacy()) { localStorage.removeItem('shanta-offline'); showGate('The app now uses a new, faster database. Please sign in once more; nothing is lost.'); }
else if (!Cloud.on() && !localStorage.getItem('shanta-offline')) showGate();
