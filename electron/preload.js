const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('aceswarm', {
  list: () => ipcRenderer.invoke('pages:list'),
  resolve: (id, context) => ipcRenderer.invoke('pages:resolve', id, context),
  status: () => ipcRenderer.invoke('services:status'),
  items: (kind) => ipcRenderer.invoke('workspace:list', kind),
  create: (kind, name) => ipcRenderer.invoke('workspace:create', kind, name),
});
