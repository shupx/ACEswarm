const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('aceswarm', {
  pages: () => ipcRenderer.invoke('control:pages'),
  resolvePage: (id, context) => ipcRenderer.invoke('control:resolve', id, context),
  status: () => ipcRenderer.invoke('control:status'),
  workspaceItems: (kind) => ipcRenderer.invoke('control:items', kind),
  createWorkspaceItem: (kind, name) => ipcRenderer.invoke('control:create', kind, name),
  settingsTarget: () => ipcRenderer.invoke('control:settings'),
  storeTarget: () => ipcRenderer.invoke('control:store'),
  bootstrap: () => ipcRenderer.invoke('control:bootstrap'),
});
