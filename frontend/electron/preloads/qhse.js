// Same API as QHSE's own preload (window.electronAPI.invoke / on), with its
// channels prefixed so they reach the QHSE handlers inside the Hub.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, ...args) => ipcRenderer.invoke(`qhse:${channel}`, ...args),
  on: (channel, callback) => {
    const listener = (event, ...args) => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
