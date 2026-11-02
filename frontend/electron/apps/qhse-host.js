// Runs QHSE's own main process (apps/qhse/electron/main.js) inside the Hub,
// unchanged. QHSE keeps exactly its database access, IPC handlers, exports
// and admin checks; the Hub only swaps what that one file gets from `require`:
//
// - electron: a stand-in where "windows" are the Hub's QHSE view, IPC
//   channels are prefixed "qhse:" (no clash with the Hub or other apps),
//   dialogs open over the Hub window, and app-level calls (quit, userData,
//   version) stay inside QHSE's own folder.
// - ./updater: disabled — the Hub updates QHSE as part of itself.
// - ./db: the real database module, except the two "remember me" functions:
//   the logged-in person comes from the Hub, matched by email to their QHSE
//   account, and nothing is written to the users table.
//
// QHSE's startup then runs as usual: it finds a session, loads the user and
// opens epi.html — in the Hub's view.

const electron = require('electron');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const appRoot = path.join(__dirname, '..', '..', 'apps', 'qhse');
const mainPath = path.join(appRoot, 'electron', 'main.js');
const dbPath = path.join(appRoot, 'electron', 'db.js');

let current = null;    // modules handed to QHSE's main.js for the current Hub user
let registered = [];   // IPC channels QHSE registered, removed on unload
let realDb = null;     // database module + connection pool, kept across user switches
let initPromise = null;

// QHSE's main.js requires ./db lazily (after startup), so the swap stays in
// place — but only ever applies to requests made by that one file.
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (current && parent && parent.filename === mainPath) {
    if (request === 'electron') return current.electron;
    if (request === './updater') return { checkForUpdate() {} };
    if (request === './db') return current.db;
  }
  return originalLoad.call(this, request, parent, isMain);
};

function version() {
  try {
    return JSON.parse(fs.readFileSync(path.join(appRoot, '..', 'manifest.json'), 'utf8')).qhse.version;
  } catch {
    return '0.0.0';
  }
}

// What QHSE sees as "the current user", in the shape its db.js returns.
async function identityFor(hub) {
  const email = (hub.user.company_email || hub.user.username || '').toLowerCase();
  const accounts = await realDb.users.getAll();
  const account = accounts.find((u) => (u.email || u.username || '').toLowerCase() === email);
  return {
    id: account ? account.id : `hub-${hub.user.id}`,
    username: account ? account.username : email,
    email: account ? account.email : email,
    nom: (account && account.nom) || hub.user.full_name,
    // The role chosen in the Hub's admin page.
    role: hub.role === 'admin' ? 'admin' : 'user',
    // Passwords are managed by the Hub; QHSE must not force its own change.
    must_change_password: false,
  };
}

function fakeElectronFor({ view, hubWindow, userData, onLogout }) {
  let owner = null; // the stand-in window currently shown in the view

  class HubWindow extends EventEmitter {
    constructor() {
      super();
      owner = this;
      this.webContents = view.webContents;
      this.closed = false;
    }
    loadFile(file) {
      // QHSE shows its login page after "Déconnexion": in the Hub, logging
      // out of QHSE means logging out of the Hub.
      if (path.basename(file) === 'login.html') {
        onLogout();
        return Promise.resolve();
      }
      return view.webContents.loadFile(file);
    }
    once(event, listener) {
      if (event === 'ready-to-show') view.webContents.once('did-finish-load', listener);
      else super.once(event, listener);
      return this;
    }
    isDestroyed() { return this.closed; }
    close() { this.closed = true; }
    maximize() {}
    show() {}
    focus() {}
    setMenuBarVisibility() {}
  }
  HubWindow.fromWebContents = (wc) => (wc === view.webContents ? owner : electron.BrowserWindow.fromWebContents(wc));
  HubWindow.getAllWindows = () => (owner ? [owner] : []);

  // dialog.showXxx(window, options) or dialog.showXxx(options): QHSE's
  // "windows" become the real Hub window.
  const overHub = (fn) => (win, opts) => (opts === undefined
    ? fn.call(electron.dialog, hubWindow, win)
    : fn.call(electron.dialog, win instanceof HubWindow ? hubWindow : win, opts));

  return {
    ...electron,
    BrowserWindow: HubWindow,
    dialog: {
      ...electron.dialog,
      showSaveDialog: overHub(electron.dialog.showSaveDialog),
      showOpenDialog: overHub(electron.dialog.showOpenDialog),
      showMessageBox: overHub(electron.dialog.showMessageBox),
    },
    ipcMain: {
      handle(channel, fn) {
        const name = `qhse:${channel}`;
        electron.ipcMain.removeHandler(name);
        electron.ipcMain.handle(name, fn);
        registered.push(name);
      },
      removeHandler(channel) { electron.ipcMain.removeHandler(`qhse:${channel}`); },
      on() {},
    },
    app: {
      whenReady: () => Promise.resolve(),
      getPath: (name) => (name === 'userData' ? userData : electron.app.getPath(name)),
      getVersion: version,
      isPackaged: electron.app.isPackaged,
      on() {},
      quit() {},
    },
  };
}

function dbFor(hub, sessionToken, onError) {
  const db = {
    async init() {
      if (!realDb) realDb = require(dbPath);
      if (!initPromise) initPromise = realDb.init().catch((err) => { initPromise = null; throw err; });
      try {
        await initPromise;
      } catch (err) {
        // QHSE's own startup would stop silently on a blank window.
        onError(err);
        throw err;
      }
      return db;
    },
  };
  // Every database function passes straight through, except "remember me".
  for (const key of ['epi', 'formation', 'chantier', 'personnel', 'attribution', 'historique', 'meta', 'planningExterne', 'genId']) {
    Object.defineProperty(db, key, { enumerable: true, get: () => realDb[key] });
  }
  db.users = new Proxy({}, {
    get(_, key) {
      if (key === 'getByRememberToken') return async (token) => (token === sessionToken ? identityFor(hub) : null);
      if (key === 'setRememberToken') return async () => {};
      return realDb.users[key];
    },
  });
  return db;
}

function load({ view, hubWindow, hub, onLogout, onError, log }) {
  const userData = path.join(electron.app.getPath('userData'), 'apps', 'qhse');
  fs.mkdirSync(userData, { recursive: true });
  // The session QHSE's startup looks for; its token only means something to
  // the db stand-in above, never to the database.
  const sessionToken = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(userData, 'session.json'), JSON.stringify({ userId: 'hub', token: sessionToken }));

  current = {
    electron: fakeElectronFor({ view, hubWindow, userData, onLogout }),
    db: dbFor(hub, sessionToken, onError),
  };
  delete require.cache[mainPath];
  require(mainPath);
  log('info', `QHSE ${version()} loaded for ${hub.user.username} (role ${hub.role})`);
}

// Hub logout: the next person gets a fresh QHSE.
function unload() {
  for (const name of registered) electron.ipcMain.removeHandler(name);
  registered = [];
  current = null;
  delete require.cache[mainPath];
}

module.exports = { load, unload };
