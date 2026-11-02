// Progress window of an update (renderer/update.html).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updater', {
  onProgress: (cb) => ipcRenderer.on('update:progress', (_e, data) => cb(data)),
  onInstalling: (cb) => ipcRenderer.on('update:installing', () => cb()),
  onFailed: (cb) => ipcRenderer.on('update:failed', (_e, message) => cb(message)),
});
