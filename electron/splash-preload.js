const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('startup', {
  onStatus: callback => ipcRenderer.on('aceswarm:startup-status', (_event, status) => callback(status)),
  quit: () => ipcRenderer.send('aceswarm:startup-quit'),
});
