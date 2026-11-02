const { app, BrowserWindow, Menu, ipcMain, safeStorage, shell } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { autoUpdater } = require('electron-updater');

// Where the Hub API runs. Can be overridden per PC (tests, server move)
// with a config.json in the userData folder: { "serverUrl": "http://..." }
const DEFAULT_SERVER_URL = 'http://192.168.0.134:4100';

const userData = app.getPath('userData');
const sessionFile = path.join(userData, 'session.bin');
const logFile = path.join(userData, 'hub-log.txt');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}
const serverUrl = (process.env.HUB_SERVER_URL || readConfig().serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '');

// ── Diagnostics ──────────────────────────────────────────
// The last warnings/errors are attached to tickets so a "it crashed" report
// comes with the actual error.
const recentLogs = [];
function log(level, message) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  recentLogs.push(line);
  if (recentLogs.length > 100) recentLogs.shift();
  try {
    fs.appendFileSync(logFile, `${line}\n`);
  } catch {
    // logging is best-effort
  }
}

process.on('uncaughtException', (err) => log('error', `main: ${err.stack || err}`));
process.on('unhandledRejection', (err) => log('error', `main (promise): ${err?.stack || err}`));

// ── Session (token encrypted with the Windows user account) ─
ipcMain.handle('session:get', () => {
  try {
    if (!fs.existsSync(sessionFile)) return null;
    const raw = fs.readFileSync(sessionFile);
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
});

ipcMain.handle('session:set', (_e, data) => {
  try {
    const json = JSON.stringify(data);
    fs.writeFileSync(sessionFile, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : json);
  } catch (err) {
    log('warn', `session save failed: ${err.message}`);
  }
});

ipcMain.handle('session:clear', () => {
  try {
    fs.rmSync(sessionFile, { force: true });
  } catch {
    // best-effort
  }
});

ipcMain.handle('hub:info', () => ({
  version: app.getVersion(),
  serverUrl,
}));

ipcMain.handle('report:capture', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  const image = await win.webContents.capturePage();
  return image.toDataURL();
});

ipcMain.handle('report:diagnostics', () => ({
  hub_version: app.getVersion(),
  electron: process.versions.electron,
  os: `${os.type()} ${os.release()} ${os.arch()}`,
  computer: os.hostname(),
  windows_user: os.userInfo().username,
  server_url: serverUrl,
  recent_logs: recentLogs.slice(-50),
}));

ipcMain.on('log', (_e, level, message) => log(level, `renderer: ${message}`));

// ── Window ───────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Tacquet Hub',
    icon: path.join(__dirname, '..', 'asset', 'icon-256.png'),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  win.webContents.on('console-message', (details, legacyLevel, legacyMessage) => {
    // Electron ≥ 35 passes a details object; older versions pass positional args.
    const level = details.level ?? ['info', 'info', 'warning', 'error'][legacyLevel];
    const message = details.message ?? legacyMessage;
    if (level === 'warning' || level === 'error') log(level, `renderer: ${message}`);
  });
  win.webContents.on('render-process-gone', (_e, d) => log('error', `renderer gone: ${d.reason}`));

  // Links open in the normal browser, never inside the Hub.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.key === 'F12') win.webContents.toggleDevTools();
    });
  }
  return win;
}

// ── Auto-update from GitHub Releases ─────────────────────
function setupUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.on('error', (err) => log('warn', `updater: ${err.message}`));
  autoUpdater.on('update-downloaded', (info) => log('info', `update ${info.version} downloaded, installs on quit`));
  autoUpdater.checkForUpdatesAndNotify().catch((err) => log('warn', `updater: ${err.message}`));
  setInterval(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 4 * 60 * 60 * 1000);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    log('info', `Tacquet Hub ${app.getVersion()} started, server ${serverUrl}`);
    createWindow();
    setupUpdater();
  });

  app.on('window-all-closed', () => app.quit());
}
