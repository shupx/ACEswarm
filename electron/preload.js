const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, callback, map = false) => ipcRenderer.on(channel, (_event, payload) => callback(map ? payload : undefined));
contextBridge.exposeInMainWorld('aceswarmControl', {
  pages: () => ipcRenderer.invoke('control:pages'), resolvePage: (id, context) => ipcRenderer.invoke('control:resolve', id, context),
  status: () => ipcRenderer.invoke('control:status'), workspaceItems: (kind) => ipcRenderer.invoke('control:items', kind),
  createWorkspaceItem: (kind, name) => ipcRenderer.invoke('control:create', kind, name), settingsTarget: () => ipcRenderer.invoke('control:settings'),
  storeTarget: () => ipcRenderer.invoke('control:store'), bootstrap: () => ipcRenderer.invoke('control:bootstrap'),
});
contextBridge.exposeInMainWorld('aceswarm', {
  pages: () => ipcRenderer.invoke('control:pages'), resolvePage: (id, context) => ipcRenderer.invoke('control:resolve', id, context), status: () => ipcRenderer.invoke('control:status'),
  workspaceItems: (kind) => ipcRenderer.invoke('control:items', kind), createWorkspaceItem: (kind, name) => ipcRenderer.invoke('control:create', kind, name),
  settingsTarget: () => ipcRenderer.invoke('control:settings'), storeTarget: () => ipcRenderer.invoke('control:store'), bootstrap: () => ipcRenderer.invoke('control:bootstrap'),
});
contextBridge.exposeInMainWorld('aivudaShell', {
  onRecordingError: (callback) => on('aivuda-shell:recording-error', callback, true),
  authorizeUrl: (url) => ipcRenderer.invoke('aivuda-shell:authorize-url', url),
  routePagePopup: (url) => ipcRenderer.invoke('aivuda-shell:route-page-popup', url),
  getStartup: () => ipcRenderer.invoke('aivuda-shell:get-startup'), getGpuStatus: () => ipcRenderer.invoke('aivuda-shell:get-gpu-status'),
  clearBrowserData: () => ipcRenderer.invoke('aivuda-shell:clear-browser-data'), saveShellState: (state) => ipcRenderer.invoke('aivuda-shell:save-shell-state', state),
  openPath: (p) => ipcRenderer.invoke('aivuda-shell:open-path', p), showItemInFolder: (p) => ipcRenderer.invoke('aivuda-shell:show-item-in-folder', p),
  prepareWindowRecording: () => ipcRenderer.invoke('aivuda-shell:prepare-window-recording'), saveRecordingFile: (p) => ipcRenderer.invoke('aivuda-shell:save-recording-file', p),
  startFfmpegWindowRecording: () => ipcRenderer.invoke('aivuda-shell:start-ffmpeg-window-recording'), startFfmpegX11Recording: () => ipcRenderer.invoke('aivuda-shell:start-ffmpeg-x11-recording'),
  pauseFfmpegWindowRecording: () => ipcRenderer.invoke('aivuda-shell:pause-ffmpeg-window-recording'), resumeFfmpegWindowRecording: () => ipcRenderer.invoke('aivuda-shell:resume-ffmpeg-window-recording'),
  stopFfmpegWindowRecording: () => ipcRenderer.invoke('aivuda-shell:stop-ffmpeg-window-recording'), registerWebview: (id) => ipcRenderer.send('aivuda-shell:register-webview', id),
  onCloseCurrentTab: (cb) => on('aivuda-shell:close-current-tab', cb), onClearBrowserData: (cb) => on('aivuda-shell:clear-browser-data', cb),
  onHideBrowserChrome: (cb) => on('aivuda-shell:hide-browser-chrome', cb), onHidePerformanceOverlay: (cb) => on('aivuda-shell:hide-performance-overlay', cb),
  onNewTab: (cb) => on('aivuda-shell:new-tab', cb, true), onOpenUrlInNewTab: (cb) => on('aivuda-shell:open-url-in-new-tab', cb, true),
  onReloadCurrentTab: (cb) => on('aivuda-shell:reload-current-tab', cb), onResetZoom: (cb) => on('aivuda-shell:reset-zoom', cb),
  onShowPerformanceOverlay: (cb) => on('aivuda-shell:show-performance-overlay', cb), onShowBrowserChrome: (cb) => on('aivuda-shell:show-browser-chrome', cb),
  onToggleScreenRecordBar: (cb) => on('aivuda-shell:toggle-screen-record-bar', cb), onToggleBrowserChrome: (cb) => on('aivuda-shell:toggle-browser-chrome', cb),
  onToggleDevtools: (cb) => on('aivuda-shell:toggle-devtools', cb), onTogglePerformanceOverlay: (cb) => on('aivuda-shell:toggle-performance-overlay', cb),
  onZoomIn: (cb) => on('aivuda-shell:zoom-in', cb), onZoomOut: (cb) => on('aivuda-shell:zoom-out', cb),
});
