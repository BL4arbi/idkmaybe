const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  info: () => ipcRenderer.invoke('hub:info'),
  getSession: () => ipcRenderer.invoke('session:get'),
  setSession: (data) => ipcRenderer.invoke('session:set', data),
  clearSession: () => ipcRenderer.invoke('session:clear'),
  captureScreenshot: () => ipcRenderer.invoke('report:capture'),
  diagnostics: () => ipcRenderer.invoke('report:diagnostics'),
  log: (level, message) => ipcRenderer.send('log', level, String(message)),

  // Apps inside the Hub
  setIdentity: (hub) => ipcRenderer.invoke('hub:set-identity', hub),
  clearIdentity: () => ipcRenderer.invoke('hub:clear-identity'),
  openApp: (key) => ipcRenderer.invoke('apps:open', key),
  preloadApps: () => ipcRenderer.invoke('apps:preload'),
  showHub: () => ipcRenderer.invoke('apps:show-hub'),
  setAppBounds: (rect) => ipcRenderer.send('apps:bounds', rect),
  setOverlay: (on) => ipcRenderer.send('apps:overlay', on),
  appVersions: () => ipcRenderer.invoke('apps:versions'),
  onLogoutRequest: (cb) => ipcRenderer.on('hub:logout-request', () => cb()),
  onNotice: (cb) => ipcRenderer.on('hub:notice', (_e, message) => cb(message)),
});
