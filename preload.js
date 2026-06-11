const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  isAlwaysOnTop: () => ipcRenderer.invoke('is-always-on-top')
});
