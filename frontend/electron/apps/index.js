// Opens the Tacquet apps inside the Hub window. Each app gets its own view
// (own storage, own preload), created the first time it is opened — or
// preloaded in the background after login — and then kept alive: switching
// apps only shows/hides views, so it is instant and every app stays exactly
// where the person left it.

const { app, WebContentsView } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const qhseHost = require('./qhse-host');

const appsDir = path.join(__dirname, '..', '..', 'apps');
const preloads = path.join(__dirname, '..', 'preloads');

const DEFS = {
  measure: {
    entry: path.join(appsDir, 'measure', 'index.html'),
    legacyUserData: 'tacquet-measure',
  },
  tracker: {
    entry: path.join(appsDir, 'tracker', 'dist', 'index.html'),
    preload: path.join(preloads, 'tracker.js'),
    legacyUserData: 'solidworks-tracker',
  },
  qhse: {
    // QHSE's own main process opens its first page (see qhse-host.js).
    preload: path.join(preloads, 'qhse.js'),
    legacyUserData: 'qhse-tacquet',
  },
};

// First time an app runs in the Hub: bring over what the standalone app
// kept in its local storage (QHSE dashboard layout, Tracker theme…).
// Read-only on the old folder; skipped once the Hub has its own copy.
function importLegacyStorage(key) {
  const def = DEFS[key];
  const target = path.join(app.getPath('userData'), 'Partitions', `app-${key}`, 'Local Storage');
  const source = path.join(app.getPath('appData'), def.legacyUserData, 'Local Storage');
  if (fs.existsSync(target) || !fs.existsSync(source)) return;
  try {
    fs.cpSync(source, target, { recursive: true });
  } catch {
    fs.rmSync(target, { recursive: true, force: true }); // old app open: try again next time
  }
}

function errorPage(title, detail) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8">
<body style="font:14px system-ui,'Segoe UI',sans-serif;background:#16171d;color:#c9c8cf;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="max-width:520px;padding:28px;border:1px solid #2e303a;border-radius:10px;background:#1d1e26">
<h2 style="color:#f3f4f6;margin:0 0 10px;font-size:17px">${esc(title)}</h2>
<p style="margin:0 0 14px">${esc(detail)}</p>
<p style="margin:0;color:#8f8e98;font-size:12px">Vérifiez la connexion au réseau Tacquet, puis rouvrez l’application depuis le Hub. Si le problème continue, utilisez « Signaler un problème ».</p>
</div></body>`)}`;
}

class AppManager {
  constructor({ window, log, onLogoutRequest }) {
    this.window = window;
    this.log = log;
    this.onLogoutRequest = onLogoutRequest;
    this.views = new Map();
    this.hub = null;       // { token, user, apps: [{ key, role }] }
    this.activeKey = null;
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
    this.overlay = false;  // a Hub menu/dialog is open over the content area
  }

  roleFor(key) {
    return this.hub?.apps.find((a) => a.key === key)?.role || null;
  }

  // Login, logout (null) or a refresh of the access list.
  setIdentity(hub) {
    const sameUser = hub && this.hub && hub.user.id === this.hub.user.id;
    if (!sameUser) this.closeAll();
    else {
      // Access removed by the admin since the last refresh: close those apps.
      for (const key of [...this.views.keys()]) if (!hub.apps.some((a) => a.key === key)) this.close(key);
    }
    this.hub = hub;
  }

  ensureView(key) {
    if (this.views.has(key)) return this.views.get(key);
    const def = DEFS[key];
    importLegacyStorage(key);
    const view = new WebContentsView({
      webPreferences: {
        preload: def.preload,
        partition: `persist:app-${key}`,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    view.setVisible(false);
    view.setBackgroundColor('#16171d');
    this.window.contentView.addChildView(view);
    this.views.set(key, view);

    const wc = view.webContents;
    wc.on('render-process-gone', (_e, d) => {
      this.log('error', `${key} renderer gone: ${d.reason}`);
      this.close(key);
    });
    wc.on('console-message', (details, legacyLevel, legacyMessage) => {
      const level = details.level ?? ['info', 'info', 'warning', 'error'][legacyLevel];
      if (level === 'warning' || level === 'error') this.log(level, `${key}: ${details.message ?? legacyMessage}`);
    });
    if (!app.isPackaged) {
      wc.on('before-input-event', (_e, input) => {
        if (input.key === 'F12' && input.type === 'keyDown') wc.toggleDevTools();
      });
    }

    if (key === 'qhse') {
      try {
        qhseHost.load({
          view,
          hubWindow: this.window,
          hub: { token: this.hub.token, user: this.hub.user, role: this.roleFor('qhse') },
          onLogout: () => this.onLogoutRequest(),
          onError: (err) => wc.loadURL(errorPage('QHSE ne peut pas joindre sa base de données', err.message)),
          log: this.log,
        });
      } catch (err) {
        this.log('error', `qhse load: ${err.stack || err}`);
        wc.loadURL(errorPage('QHSE n’a pas pu démarrer', err.message));
      }
    } else {
      wc.loadFile(def.entry);
    }
    return view;
  }

  open(key) {
    if (!DEFS[key]) throw new Error(`Application inconnue : ${key}`);
    if (!this.roleFor(key)) throw new Error('Vous n’avez pas accès à cette application.');
    const view = this.ensureView(key);
    this.activeKey = key;
    this.layout();
    view.webContents.focus();
  }

  // Background start of the apps this person can open, so the first click is instant too.
  preload() {
    for (const { key } of this.hub?.apps || []) {
      if (DEFS[key]) {
        try {
          this.ensureView(key);
        } catch (err) {
          this.log('warn', `preload ${key}: ${err.message}`);
        }
      }
    }
  }

  showHub() {
    this.activeKey = null;
    this.layout();
  }

  setBounds(rect) {
    this.bounds = {
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)),
    };
    this.layout();
  }

  setOverlay(on) {
    this.overlay = on;
    this.layout();
  }

  layout() {
    for (const [key, view] of this.views) {
      const visible = key === this.activeKey && !this.overlay;
      if (visible) view.setBounds(this.bounds);
      view.setVisible(visible);
    }
  }

  activeView() {
    return this.activeKey ? this.views.get(this.activeKey) : null;
  }

  close(key) {
    const view = this.views.get(key);
    if (!view) return;
    this.views.delete(key);
    if (key === 'qhse') qhseHost.unload();
    if (this.activeKey === key) this.activeKey = null;
    this.window.contentView.removeChildView(view);
    view.webContents.close();
  }

  closeAll() {
    for (const key of [...this.views.keys()]) this.close(key);
  }
}

module.exports = { AppManager, APP_KEYS: Object.keys(DEFS) };
