const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } = require('electron');
const { workspace } = require('./services/workspace');
const { resolveRuntime } = require('./services/runtime');
const { LocalServices } = require('./services/local-services');
const { fixed, resolvePage } = require('./services/pages');
const { provision } = require('./services/seed');
const { listItems, createItem } = require('./services/workspace-items');
const { ControlServer } = require('./services/control-server');

let services;
let window;
let endpoints;
const remoteOrigins = new Set();
let paths;
let quitting = false;
let control;

let shellStatePath;
let shellState;

function readShellState() {
  try { shellState = JSON.parse(fs.readFileSync(shellStatePath, 'utf8')); } catch (_) { shellState = null; }
  for (const entry of [...(shellState?.tabs || []), ...(shellState?.favorites || [])]) {
    try {
      const url = new URL(entry.url);
      if (['http:', 'https:'].includes(url.protocol)) remoteOrigins.add(url.origin);
    } catch (_) {}
  }
  return shellState;
}

function saveShellState(state) {
  shellState = state && typeof state === 'object' ? state : {};
  fs.mkdirSync(path.dirname(shellStatePath), { recursive: true });
  fs.writeFileSync(shellStatePath, JSON.stringify(shellState, null, 2));
}

function allowedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'file:') {
      return url.pathname === path.join(__dirname, 'offline.html');
    }
    const local = [endpoints.os, endpoints.store, `${endpoints.gateway}/`].some((endpoint) => url.origin === new URL(endpoint).origin);
    return ['http:', 'https:'].includes(url.protocol) && (local || remoteOrigins.has(url.origin));
  } catch (_) { return false; }
}

function createWindow() {
  window = new BrowserWindow({
    width: 1280, height: 820, minWidth: 850, minHeight: 550,
    title: 'ACEswarm', backgroundColor: '#101828',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), webviewTag: true, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.loadFile(path.join(__dirname, 'shell.html'));
  window.webContents.once('did-finish-load', () => {
    console.log('ACEswarm workbench ready');
    const smokeExit = Number(process.env.ACESWARM_SMOKE_EXIT_MS);
    if (smokeExit > 0 && smokeExit <= 60000) setTimeout(() => app.quit(), smokeExit);
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-attach-webview', (event, preferences, params) => {
    const url = params.src || '';
    if (!allowedUrl(url)) event.preventDefault();
    preferences.nodeIntegration = false;
    preferences.contextIsolation = true;
    preferences.preload = path.join(__dirname, 'guest-preload.js');
  });
  window.webContents.on('did-attach-webview', (_, contents) => {
    contents.on('will-navigate', (event, url) => { if (!allowedUrl(url)) event.preventDefault(); });
    contents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  });
}

function handleTerminationSignal() {
  if (quitting) return;
  quitting = true;
  Promise.resolve(window?.webContents.executeJavaScript('window.__aivudaFinalizeActiveRecordingBeforeClose?.()'))
    .catch(() => {})
    .finally(() => control?.stop())
    .finally(() => services?.stop())
    .finally(() => app.quit());
}
process.on('SIGTERM', handleTerminationSignal);
process.on('SIGINT', handleTerminationSignal);

app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  try {
    paths = workspace();
    const runtime = resolveRuntime({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, sourceRoot: path.resolve(__dirname, '..') });
    services = new LocalServices(paths, runtime);
    endpoints = await services.start();
    shellStatePath = path.join(app.getPath('userData'), 'shell-state.json');
    readShellState();
    control = new ControlServer({ paths, endpoints });
    endpoints.control = await control.start();
    console.log(`ACEswarm Control API: ${endpoints.control}`);
    console.log(`ACEswarm MCP HTTP: ${endpoints.control}/mcp`);
    services.startMcp(endpoints.control);
    services.startPackageMcps();
    ipcMain.handle('control:pages', () => fixed);
    ipcMain.handle('control:resolve', (_, id, context) => {
      const page = resolvePage(id, endpoints, context);
      if (page.kind === 'robot') remoteOrigins.add(new URL(page.url).origin);
      return page;
    });
    ipcMain.handle('control:status', () => ({ ...services.endpoints, control: endpoints.control, failures: services.failures, bootstrap: control.bootstrap }));
    ipcMain.handle('control:items', (_, kind) => ({ kind, items: listItems(paths, kind) }));
    ipcMain.handle('control:create', (_, kind, name) => createItem(paths, kind, name));
    ipcMain.handle('control:settings', () => ({ url: endpoints.os, kind: 'aivudaos-settings' }));
    ipcMain.handle('control:store', () => ({ url: endpoints.store, kind: 'aivudaappstore' }));
    ipcMain.handle('control:bootstrap', () => control.bootstrap);
    ipcMain.handle('aivuda-shell:get-startup', () => ({ defaultUrl: endpoints.os, initialUrl: endpoints.os, storeUrl: endpoints.store, recordingsDir: path.join(app.getPath('videos'), 'ACEswarm'), savedState: shellState }));
    ipcMain.handle('aivuda-shell:get-gpu-status', () => app.getGPUFeatureStatus());
    ipcMain.handle('aivuda-shell:save-shell-state', (_, state) => { try { saveShellState(state); return { ok: true }; } catch (error) { return { ok: false, error: error.message }; } });
    ipcMain.handle('aivuda-shell:clear-browser-data', async () => {
      await session.fromPartition('persist:aivuda-shell').clearStorageData();
      await session.fromPartition('persist:aivuda-shell').clearCache();
      shellState = null;
      try { fs.rmSync(shellStatePath, { force: true }); } catch (_) {}
      return { ok: true };
    });
    ipcMain.handle('aivuda-shell:open-path', async (_, target) => { if (typeof target !== 'string') return { ok: false, error: 'Missing path' }; const error = await shell.openPath(target); return error ? { ok: false, error } : { ok: true }; });
    ipcMain.handle('aivuda-shell:show-item-in-folder', (_, target) => { if (typeof target !== 'string') return { ok: false, error: 'Missing path' }; shell.showItemInFolder(target); return { ok: true }; });
    ipcMain.handle('aivuda-shell:prepare-window-recording', async () => {
      if (!window || window.isDestroyed()) return { ok: false, error: 'Main window is not available.' };
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
      const source = sources.find((entry) => entry.name === window.getTitle()) || sources[0];
      if (!source) return { ok: false, error: 'No capturable window source was found.' };
      const dir = path.join(app.getPath('videos'), 'ACEswarm');
      fs.mkdirSync(dir, { recursive: true });
      const outputPath = path.join(dir, `aceswarm-${new Date().toISOString().replaceAll(':', '-')}.webm`);
      return { ok: true, sourceId: source.id, outputPath, recordingsDir: dir };
    });
    ipcMain.handle('aivuda-shell:save-recording-file', (_, payload) => { try { if (!payload?.outputPath || !Array.isArray(payload.buffer)) throw new Error('Invalid recording payload'); fs.mkdirSync(path.dirname(payload.outputPath), { recursive: true }); fs.writeFileSync(payload.outputPath, Buffer.from(payload.buffer)); return { ok: true, outputPath: payload.outputPath }; } catch (error) { return { ok: false, error: error.message }; } });
    for (const name of ['start-ffmpeg-window-recording', 'start-ffmpeg-x11-recording']) ipcMain.handle(`aivuda-shell:${name}`, () => ({ ok: false, error: 'FFmpeg recording is not available in ACEswarm yet.' }));
    for (const name of ['pause-ffmpeg-window-recording', 'resume-ffmpeg-window-recording', 'stop-ffmpeg-window-recording']) ipcMain.handle(`aivuda-shell:${name}`, () => ({ ok: false, error: 'No active FFmpeg recording.' }));
    createWindow();
    control.setBootstrap('running');
    provision({ osUrl: endpoints.osApi, storeUrl: endpoints.store, storeApiUrl: endpoints.storeApi, configPath: path.join(app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', 'resources'), 'seed-apps', 'aceswarm-config-export.json') })
      .then((result) => control.setBootstrap('completed', { result }))
      .catch((error) => { control.setBootstrap('failed', { error: error.message }); services.failures.push(`Seed provisioning: ${error.message}`); console.error(error); });
  } catch (error) {
    await control?.stop();
    await services?.stop();
    console.error('ACEswarm startup failed:', error);
    require('electron').dialog.showErrorBox('ACEswarm startup failed', `${error.message}\n\nLogs: ${paths?.logs || 'not initialized'}`);
    app.quit();
  }
});
app.on('before-quit', (event) => {
  if (quitting || !services) return;
  event.preventDefault();
  quitting = true;
  Promise.resolve(window?.webContents.executeJavaScript('window.__aivudaFinalizeActiveRecordingBeforeClose?.()'))
    .catch(() => {})
    .finally(() => control?.stop())
    .finally(() => services.stop())
    .finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
