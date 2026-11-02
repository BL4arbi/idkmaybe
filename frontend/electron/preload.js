const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hub', {
  info: () => ipcRenderer.invoke('hub:info'),
  getSession: () => ipcRenderer.invoke('session:get'),
  setSession: (data) => ipcRenderer.invoke('session:set', data),
  clearSession: () => ipcRenderer.invoke('session:clear'),
  captureScreenshot: () => ipcRenderer.invoke('report:capture'),
  diagnostics: () => ipcRenderer.invoke('report:diagnostics'),
  log: (level, message) => ipcRenderer.send('log', level, String(message)),
});
