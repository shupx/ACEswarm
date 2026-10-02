const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { workspace } = require('./services/workspace');
const { resolveRuntime } = require('./services/runtime');
const { LocalServices } = require('./services/local-services');
const { fixed, resolvePage } = require('./services/pages');
const { provision } = require('./services/seed');
const { listItems, createItem } = require('./services/workspace-items');

let services;
let window;
let endpoints;
const remoteOrigins = new Set();
let paths;
let quitting = false;

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
  services?.stop().finally(() => app.quit());
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
    ipcMain.handle('pages:list', () => fixed);
    ipcMain.handle('pages:resolve', (_, id, context) => {
      const page = resolvePage(id, endpoints, context);
      if (page.kind === 'robot') remoteOrigins.add(new URL(page.url).origin);
      return page;
    });
    ipcMain.handle('services:status', () => ({ endpoints, failures: services.failures }));
    ipcMain.handle('workspace:list', (_, kind) => listItems(paths, kind));
    ipcMain.handle('workspace:create', (_, kind, name) => createItem(paths, kind, name));
    createWindow();
    provision({ osUrl: endpoints.os, paths, manifestPath: path.join(app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', 'resources'), 'seed-apps', 'seed-manifest.json') })
      .catch((error) => { services.failures.push(`Seed provisioning: ${error.message}`); console.error(error); });
  } catch (error) {
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
  services.stop().finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
