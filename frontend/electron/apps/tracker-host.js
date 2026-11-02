// Main-process side of the SolidWorks Team Tracker inside the Hub: the same
// IPC its own main process offered (session + SolidWorks preview), with the
// session coming from the Hub instead of the Tracker's login screen.

const { ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEFAULT_TRACKER_API = 'http://192.168.0.134:4000';

function setup({ getHub, trackerApi = DEFAULT_TRACKER_API, notify, log }) {
  let session = null;    // { token, user } in use for this Hub login
  let loggedOut = false; // the person used the Tracker's own "Déconnexion"

  // Exchanges the Hub login for a Tracker session (Tracker server route
  // /api/auth/hub-login). If that route isn't deployed yet, or the person
  // has no Tracker account, the Tracker simply shows its own login page.
  async function hubLogin() {
    const hub = getHub();
    if (!hub) return null;
    try {
      const res = await fetch(`${trackerApi}/api/auth/hub-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hub_token: hub.token }),
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) return { token: data.token, user: data.user };
      log('warn', `tracker hub-login ${res.status}: ${data.error || 'route absente'}`);
      // A plain 404 means the Tracker server hasn't got the route yet: its
      // login page shows, as before, with nothing to report.
      if (res.status !== 404 || data.code === 'NO_ACCOUNT') notify(`Tracker : ${data.error || `connexion automatique impossible (${res.status})`}`);
    } catch (err) {
      log('warn', `tracker hub-login: ${err.message}`);
      notify(`Tracker : serveur injoignable (${trackerApi})`);
    }
    return null;
  }

  ipcMain.handle('tracker:get-session', async () => {
    if (session || loggedOut) return session;
    session = await hubLogin();
    return session;
  });
  ipcMain.handle('tracker:set-session', (_e, data) => {
    session = data;
    loggedOut = false;
  });
  ipcMain.handle('tracker:clear-session', () => {
    session = null;
    loggedOut = true;
  });

  ipcMain.handle('tracker:sw-preview', async (_e, nativeFilePath) => {
    const file = path.join(__dirname, '..', '..', 'apps', 'tracker', 'electron', 'solidworksPreview.js');
    const { generateSolidWorksPreview } = await import(pathToFileURL(file).href);
    return generateSolidWorksPreview(nativeFilePath);
  });

  // New Hub user: forget the previous person's Tracker session.
  return {
    reset() {
      session = null;
      loggedOut = false;
    },
  };
}

module.exports = { setup, DEFAULT_TRACKER_API };
