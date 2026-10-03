const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
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

function allowedUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
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
  Promise.resolve(control?.stop()).finally(() => services?.stop()).finally(() => app.quit());
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
    createWindow();
    control.setBootstrap('running');
    provision({ osUrl: endpoints.osApi, storeUrl: endpoints.storeApi, configPath: path.join(app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', 'resources'), 'seed-apps', 'aceswarm-config-export.json') })
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
  control?.stop().finally(() => services.stop()).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
