// Updates from GitHub Releases, the same way as QHSE: when a new version is
// published the person is asked ("Mettre à jour" / "Plus tard"); on yes, a
// small window shows the download percentage, then "Installation…", and the
// Hub restarts on the new version by itself. Nothing is installed silently.

const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const lockFile = () => path.join(app.getPath('userData'), 'update.lock');

// While the installer runs (a few seconds after the Hub closed), reopening
// the Hub would start the old version and get in the installer's way. The
// lock holds the version being installed: the Hub the installer restarts
// itself is that version, and starts normally.
function installInProgress() {
  try {
    const lock = JSON.parse(fs.readFileSync(lockFile(), 'utf8'));
    const fresh = Date.now() - lock.timestamp < 3 * 60 * 1000;
    if (fresh && lock.targetVersion !== app.getVersion()) return true;
    fs.rmSync(lockFile(), { force: true });
  } catch {
    // no lock: no update in progress
  }
  return false;
}

function progressWindow(parent) {
  const win = new BrowserWindow({
    width: 420,
    height: 190,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false,
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    modal: Boolean(parent && !parent.isDestroyed()),
    title: 'Mise à jour de Tacquet Hub',
    icon: path.join(__dirname, '..', 'asset', 'icon-256.png'),
    backgroundColor: '#16171d',
    webPreferences: {
      preload: path.join(__dirname, 'preloads', 'update.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'update.html'));
  return win;
}

function setup({ getWindow, log }) {
  if (!app.isPackaged) return;
  // A question or a download is already on screen. "Plus tard" is asked
  // again at the next check (next start, or within 4 hours).
  let asking = false;

  autoUpdater.on('error', (err) => log('warn', `updater: ${err.message}`));

  autoUpdater.on('update-available', async (info) => {
    if (asking) return;
    asking = true;
    const parent = getWindow();
    log('info', `update ${info.version} available`);
    const { response } = await dialog.showMessageBox(parent, {
      type: 'info',
      title: 'Mise à jour disponible',
      message: `Tacquet Hub ${info.version} est disponible`,
      detail: `Version installée : ${app.getVersion()}\nNouvelle version : ${info.version}\n\n`
        + 'Enregistrez votre travail en cours dans les applications : le Hub va se fermer, '
        + 'installer la mise à jour et se rouvrir tout seul.',
      buttons: ['Mettre à jour', 'Plus tard'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) {
      asking = false;
      log('info', `update ${info.version} postponed`);
      return;
    }

    const progress = progressWindow(parent);
    const send = (channel, data) => { if (!progress.isDestroyed()) progress.webContents.send(channel, data); };
    const onProgress = (p) => send('update:progress', { percent: p.percent });
    autoUpdater.on('download-progress', onProgress);

    autoUpdater.once('update-downloaded', () => {
      autoUpdater.removeListener('download-progress', onProgress);
      send('update:installing');
      log('info', `update ${info.version} downloaded, installing`);
      try {
        fs.writeFileSync(lockFile(), JSON.stringify({ timestamp: Date.now(), targetVersion: info.version }));
      } catch {
        // the lock only protects against an early manual relaunch
      }
      // Leave "Installation…" on screen a moment so the closing isn't a surprise.
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 2500);
    });

    progress.webContents.once('did-finish-load', () => {
      autoUpdater.downloadUpdate().catch((err) => {
        log('warn', `update download: ${err.message}`);
        autoUpdater.removeListener('download-progress', onProgress);
        send('update:failed', err.message);
        setTimeout(() => {
          if (!progress.isDestroyed()) progress.destroy();
          asking = false;
        }, 4000);
      });
    });
  });

  const check = () => autoUpdater.checkForUpdates().catch((err) => log('warn', `updater: ${err.message}`));
  setTimeout(check, 3000);
  setInterval(() => {
    if (!asking) check();
  }, CHECK_EVERY_MS);
}

module.exports = { setup, installInProgress };
