// Same API as the Tracker's own preload (window.electronAPI). The session
// comes from the Hub: the Tracker opens already logged in.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  generateSolidWorksPreview: (nativeFilePath) => ipcRenderer.invoke('tracker:sw-preview', nativeFilePath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  getSession: () => ipcRenderer.invoke('tracker:get-session'),
  setSession: (data) => ipcRenderer.invoke('tracker:set-session', data),
  clearSession: () => ipcRenderer.invoke('tracker:clear-session'),
});
