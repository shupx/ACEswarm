const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, Menu, session, shell, screen, nativeTheme, webContents } = require('electron');
const { normalizePreferences, resolveAppearance } = require('./services/appearance');
const { clearPageCache } = require('./services/page-cache');
const { createSplash } = require('./services/splash');
if (process.platform === 'linux') app.commandLine.appendSwitch('disable-accelerated-video-encode');
const { workspace } = require('./services/workspace');
const { resolveRuntime } = require('./services/runtime');
const { LocalServices } = require('./services/local-services');
const { configureBrowserConnection, checkBrowserPort, startAgentConnection } = require('./services/agent-connection');
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
const browserConfiguration = primaryInstance ? configureBrowserConnection(app) : null;
// Probe before Chromium starts CDP; retain errors for startup reporting.
const browserPortCheck = primaryInstance ? checkBrowserPort(browserConfiguration).then(() => null, error => error) : Promise.resolve(null);
const { provisionOnce, prepareBootstrap } = require('./services/seed');
const { installedApplications, runningApplications, controlApplication } = require('./services/applications');
const recording = require('./services/recording')(() => window, (failure) => sendToShell('aivuda-shell:recording-error', failure), (child) => services?.trackRecording(child));
const downloads = require('./services/downloads')({ getWindow: () => window, onChange: value => sendToShell('aivuda-shell:downloads', value) });

let services;
let agentConnection;
let window;
let splash;
let endpoints;
const remoteOrigins = new Set();
const certificateBypassSessions = new WeakSet();
let paths;
let quitting = false;

let shellStatePath;
let shellState;
let appearancePreferences = normalizePreferences();
let appearancePath;

function currentAppearance() {
  return resolveAppearance(appearancePreferences, app.getLocale(), nativeTheme.shouldUseDarkColors);
}

function isBuiltinPage(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return [endpoints.os, endpoints.store].some(endpoint => new URL(endpoint).origin === url.origin) &&
      !/^\/[^/]+\/ui(?:\/|$)/.test(url.pathname);
  } catch (_) { return false; }
}

function broadcastAppearance() {
  const value = currentAppearance();
  sendToShell('aivuda-shell:appearance', value);
  for (const contents of webContents.getAllWebContents()) {
    if (contents.hostWebContents === window?.webContents && isBuiltinPage(contents.getURL())) contents.send('aivuda-shell:appearance', value);
  }
}

function installCertificateValidationBypass(targetSession) {
  if (certificateBypassSessions.has(targetSession)) return;
  targetSession.setCertificateVerifyProc((request, callback) => {
    if (request.errorCode !== 0) console.warn('ACEswarm certificate verification bypass:', request.hostname, request.errorCode);
    callback(0);
  });
  certificateBypassSessions.add(targetSession);
}

app.on('certificate-error', (event, _contents, url, error, _certificate, callback) => {
  if (!/^https:|^wss:/.test(url)) { callback(false); return; }
  event.preventDefault();
  console.warn('ACEswarm certificate validation bypass:', new URL(url).hostname, error);
  callback(true);
});

function sendToShell(channel, payload) {
  if (!window || window.isDestroyed()) return;
  window.webContents.send(channel, payload);
}

function createApplicationMenu() {
  Menu.setApplicationMenu(null);
}

function handleDesktopShortcut(event, input) {
  if (input.type !== 'keyDown' || input.alt) return;
  const key = input.key.toLowerCase();
  if (key === 'f11') {
    event.preventDefault();
    window?.setFullScreen(!window.isFullScreen());
    return;
  }
  if (!input.control && !input.meta) return;
  if (key === 'q' && !input.shift) { event.preventDefault(); app.quit(); return; }
  const commands = input.shift ? {
    i: 'toggle-devtools', p: 'toggle-performance-overlay', r: 'toggle-screen-record-bar', backspace: 'clear-browser-data',
  } : { t: 'new-tab', w: 'close-current-tab', r: 'reload-current-tab', f: 'find-in-page', l: 'toggle-browser-chrome', '0': 'reset-zoom', '-': 'zoom-out' };
  const command = key === '+' || key === '=' ? 'zoom-in' : commands[key];
  if (command) {
    event.preventDefault();
    sendToShell(`aivuda-shell:${command}`, command === 'new-tab' ? { url: endpoints?.os } : undefined);
  }
}

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

function isShellUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'file:' && url.pathname === path.join(__dirname, 'shell.html');
  } catch (_) { return false; }
}

function createWindow() {
  const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');
  let savedWindow = {};
  try { savedWindow = JSON.parse(fs.readFileSync(windowStatePath, 'utf8')) || {}; } catch (_) {}
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const restoreSize = (value, fallback, minimum, maximum) => Math.min(Math.max(minimum, maximum), Math.max(minimum, Number.isInteger(value) ? value : fallback));
  window = new BrowserWindow({
    width: restoreSize(savedWindow.width, 1280, 850, workArea.width),
    height: restoreSize(savedWindow.height, 820, 550, workArea.height),
    minWidth: 850, minHeight: 550, show: false,
    title: 'ACEswarm', backgroundColor: '#101828',
    icon: path.join(__dirname, 'assets', 'aivuda_icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), webviewTag: true, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Both the first paint and asynchronous desktop restoration must complete.
  let painted = false;
  let initialized = false;
  let cleanupReady;
  const ready = new Promise((resolve, reject) => {
    const check = () => { if (painted && initialized) resolve(); };
    const onPaint = () => { painted = true; check(); };
    const onReady = event => {
      if (event.sender !== window.webContents) return;
      initialized = true; check();
    };
    const onFailure = (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) reject(new Error(`Desktop failed to load: ${description}`));
    };
    const onCrash = (_event, details) => reject(new Error(`Desktop renderer stopped: ${details.reason}`));
    const onClosed = () => reject(new Error('Desktop window closed during startup.'));
    const timer = setTimeout(() => reject(new Error('The desktop did not become ready within 30 seconds.')), 30000);
    ipcMain.on('aivuda-shell:desktop-ready', onReady);
    window.once('ready-to-show', onPaint);
    window.once('closed', onClosed);
    window.webContents.on('did-fail-load', onFailure);
    window.webContents.on('render-process-gone', onCrash);
    cleanupReady = () => {
      clearTimeout(timer);
      ipcMain.removeListener('aivuda-shell:desktop-ready', onReady);
      window.removeListener('ready-to-show', onPaint);
      window.removeListener('closed', onClosed);
      if (!window.isDestroyed()) {
        window.webContents.removeListener('did-fail-load', onFailure);
        window.webContents.removeListener('render-process-gone', onCrash);
      }
    };
  });
  const saveWindowSize = () => {
    if (window.isDestroyed() || window.isFullScreen()) return;
    const { width, height } = window.getNormalBounds();
    try {
      fs.mkdirSync(path.dirname(windowStatePath), { recursive: true });
      fs.writeFileSync(windowStatePath, JSON.stringify({ width, height, maximized: window.isMaximized() }));
    } catch (error) { console.error('ACEswarm window size:', error.message); }
  };
  if (savedWindow.maximized === true) window.once('show', () => window.maximize());
  for (const event of ['resize', 'maximize', 'unmaximize', 'close']) window.on(event, saveWindowSize);
  window.loadFile(path.join(__dirname, 'shell.html')).catch(error => console.error('Desktop load:', error));
  window.setMenuBarVisibility(false);
  window.webContents.on('before-input-event', handleDesktopShortcut);
  // Protect ordinary renderer navigation; MCP navigation is guarded by its init-page hook.
  const blockShellNavigation = (event, url) => {
    if (!isShellUrl(url)) {
      event.preventDefault();
      console.warn(`Blocked navigation away from ACEswarm shell: ${url}`);
    }
  };
  window.webContents.on('will-navigate', blockShellNavigation);
  window.webContents.on('will-redirect', blockShellNavigation);
  let finalizingClose = false;
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (finalizingClose) return;
    finalizingClose = true;
    window.webContents.executeJavaScript('window.__aivudaFinalizeActiveRecordingBeforeClose?.()')
      .then((result) => {
        if (result?.ok === false) throw new Error(result.error || 'Could not save recording.');
        app.quit();
      })
      .catch((error) => {
        finalizingClose = false;
        require('electron').dialog.showErrorBox('Recording save failed', error.message);
      });
  });
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
    contents.on('before-input-event', handleDesktopShortcut);
    installCertificateValidationBypass(contents.session);
    downloads.attach(contents.session);
    contents.on('will-navigate', (event, url) => { if (!allowedUrl(url)) event.preventDefault(); });
    contents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
    contents.setWindowOpenHandler(({ url }) => {
      routePagePopup(url);
      return { action: 'deny' };
    });
  });
  return ready.finally(() => cleanupReady());
}

function routePagePopup(url) {
  if (!/^https?:\/\//.test(url)) return;
  if (allowedUrl(url)) sendToShell('aivuda-shell:open-url-in-new-tab', { url });
  else shell.openExternal(url);
}

function handleTerminationSignal() {
  if (quitting) return;
  quitting = true;
  shutdown().finally(() => app.quit());
}
async function shutdown() {
  const finalizeRecording = async () => {
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(() => window && !window.isDestroyed()
          ? window.webContents.executeJavaScript('window.__aivudaFinalizeActiveRecordingBeforeClose?.()') : undefined),
        new Promise((resolve) => { timer = setTimeout(resolve, 3000); }),
      ]);
    } catch (_) { /* renderer may already be gone */ }
    finally { clearTimeout(timer); await recording.stop(); }
  };
  const recordingResult = await Promise.allSettled([finalizeRecording()]);
  const results = [...recordingResult, ...await Promise.allSettled([agentConnection?.stop(), services?.stop()])];
  for (const result of results) if (result.status === 'rejected') console.error('ACEswarm shutdown:', result.reason);
}
process.on('SIGTERM', handleTerminationSignal);
process.on('SIGINT', handleTerminationSignal);

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  try {
    splash = createSplash();
    await splash.ready;
    if (quitting) return;
    const portError = await browserPortCheck;
    if (portError) throw portError;
    installCertificateValidationBypass(session.defaultSession);
    installCertificateValidationBypass(session.fromPartition('persist:aivuda-shell'));
    paths = workspace();
    const existingOsWorkspace = fs.existsSync(path.join(paths.os, 'config', 'os.yaml'));
    prepareBootstrap({ stateDirectory: paths.state, existingOsWorkspace });
    const runtime = resolveRuntime({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, sourceRoot: path.resolve(__dirname, '..') });
    services = new LocalServices(paths, runtime);
    endpoints = await services.start(message => splash.status(message));
    if (quitting) return;
    shellStatePath = path.join(app.getPath('userData'), 'shell-state.json');
    readShellState();
    appearancePath = path.join(app.getPath('userData'), 'appearance.json');
    try { appearancePreferences = normalizePreferences(JSON.parse(fs.readFileSync(appearancePath, 'utf8'))); } catch (_) {}
    nativeTheme.themeSource = appearancePreferences.theme;
    nativeTheme.on('updated', broadcastAppearance);
    ipcMain.on('aivuda-shell:get-appearance', event => {
      event.returnValue = event.sender === window?.webContents ||
        (event.sender.hostWebContents === window?.webContents && event.senderFrame === event.sender.mainFrame && isBuiltinPage(event.senderFrame.url)) ? currentAppearance() : null;
    });
    ipcMain.handle('aivuda-shell:set-appearance', (event, value) => {
      if (event.sender !== window?.webContents) throw new Error('Only the desktop can change appearance.');
      const preferences = normalizePreferences(value);
      fs.writeFileSync(appearancePath, JSON.stringify(preferences, null, 2));
      appearancePreferences = preferences;
      nativeTheme.themeSource = preferences.theme;
      broadcastAppearance();
      return currentAppearance();
    });
    splash.status('Connecting local services...');
    await services.startPackageMcps();
    if (quitting) return;
    createApplicationMenu();
    ipcMain.on('aivuda-shell:get-default-appstore-url', (event) => {
      let storeUrl = null;
      try {
        const url = new URL(event.senderFrame.url);
        if (event.sender.hostWebContents === window?.webContents && event.senderFrame === event.sender.mainFrame &&
          url.origin === new URL(endpoints.os).origin && !/^\/[^/]+\/ui(?:\/|$)/.test(url.pathname)) {
          storeUrl = endpoints.store.replace(/\/+$/, '');
        }
      } catch (_) {}
      event.returnValue = storeUrl;
    });
    ipcMain.handle('aivuda-shell:desktop-command', (event, command) => {
      if (event.sender !== window?.webContents) return { ok: false, error: 'Only the desktop can run system commands.' };
      if (command === 'quit') app.quit();
      else if (command === 'fullscreen') window.setFullScreen(!window.isFullScreen());
      else return { ok: false, error: 'Unknown system command.' };
      return { ok: true };
    });
    ipcMain.handle('aivuda-shell:get-startup', () => ({ defaultUrl: endpoints.os, initialUrl: endpoints.os, storeUrl: endpoints.store, gatewayUrl: endpoints.gateway, recordingsDir: path.join(app.getPath('videos'), 'ACEswarm'), savedState: shellState }));
    ipcMain.handle('aivuda-shell:get-installed-applications', (event) => {
      if (event.sender !== window?.webContents) throw new Error('Only the desktop can read the application catalog.');
      return installedApplications(endpoints.osApi, endpoints.os);
    });
    ipcMain.handle('aivuda-shell:get-running-applications', (event) => {
      if (event.sender !== window?.webContents) throw new Error('Only the desktop can read running applications.');
      return runningApplications(endpoints.osApi, endpoints.os);
    });
    ipcMain.handle('aivuda-shell:control-application', async (event, appId, action) => {
      if (event.sender !== window?.webContents) throw new Error('Only the desktop can control applications.');
      try {
        await controlApplication(endpoints.osApi, appId, action);
        return { ok: true };
      } catch (error) {
        require('electron').dialog.showErrorBox('Application action failed', error.message);
        return { ok: false, error: error.message };
      }
    });
    ipcMain.handle('aivuda-shell:authorize-url', (event, rawUrl) => {
      if (event.sender !== window?.webContents) return { ok: false, error: 'Only the desktop can authorize pages.' };
      try {
        const url = new URL(rawUrl);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS address.');
        remoteOrigins.add(url.origin);
        return { ok: true };
      } catch (error) { return { ok: false, error: error.message }; }
    });
    ipcMain.handle('aivuda-shell:route-page-popup', (event, url) => {
      if (event.sender === window?.webContents && typeof url === 'string') routePagePopup(url);
    });
    ipcMain.handle('aivuda-shell:get-gpu-status', () => app.getGPUFeatureStatus());
    ipcMain.handle('aivuda-shell:get-downloads', event => {
      if (event.sender !== window?.webContents) throw new Error('Only the desktop can read downloads.');
      return downloads.snapshot();
    });
    ipcMain.handle('aivuda-shell:download-action', async (event, id, action) => {
      if (event.sender !== window?.webContents) return { ok: false, error: 'Only the desktop can manage downloads.' };
      if (action === 'cancel') return downloads.cancel(id);
      if (action === 'clear') return downloads.clearFinished();
      const target = downloads.completedPath(id);
      if (!target) return { ok: false, error: 'Download has not completed.' };
      if (action === 'show') { shell.showItemInFolder(target); return { ok: true }; }
      if (action === 'open') {
        const error = await shell.openPath(target);
        return error ? { ok: false, error } : { ok: true };
      }
      return { ok: false, error: 'Unknown download action.' };
    });
    ipcMain.handle('aivuda-shell:save-shell-state', (_, state) => { try { saveShellState(state); return { ok: true }; } catch (error) { return { ok: false, error: error.message }; } });
    ipcMain.handle('aivuda-shell:clear-page-cache', async (event, id) => {
      try {
        return await clearPageCache({ sender: event.sender, desktop: window?.webContents,
          target: Number.isInteger(id) ? webContents.fromId(id) : null });
      } catch (error) { return { ok: false, error: error.message }; }
    });
    ipcMain.handle('aivuda-shell:clear-browser-data', async () => {
      await session.fromPartition('persist:aivuda-shell').clearStorageData();
      await session.fromPartition('persist:aivuda-shell').clearCache();
      shellState = null;
      try { fs.rmSync(shellStatePath, { force: true }); } catch (_) {}
      return { ok: true };
    });
    ipcMain.handle('aivuda-shell:open-path', async (_, target) => { if (typeof target !== 'string') return { ok: false, error: 'Missing path' }; const error = await shell.openPath(target); return error ? { ok: false, error } : { ok: true }; });
    ipcMain.handle('aivuda-shell:show-item-in-folder', (_, target) => { if (typeof target !== 'string') return { ok: false, error: 'Missing path' }; shell.showItemInFolder(target); return { ok: true }; });
    ipcMain.handle('aivuda-shell:prepare-window-recording', async (event) => {
      if (!window || window.isDestroyed()) return { ok: false, error: 'Main window is not available.' };
      if (event.sender !== window.webContents) return { ok: false, error: 'Only the desktop can record.' };
      const dir = recording.getRecordingsDir();
      const outputPath = recording.createRecordingOutputPath();
      return { ok: true, outputPath, recordingsDir: dir };
    });
    ipcMain.handle('aivuda-shell:capture-recording-frame', async (event) => {
      if (!window || window.isDestroyed() || event.sender !== window.webContents) throw new Error('Only the desktop can record.');
      const image = await window.webContents.capturePage();
      if (image.isEmpty()) throw new Error('Window capture returned an empty frame.');
      return image.toPNG();
    });
    ipcMain.handle('aivuda-shell:save-recording-file', (_, payload) => { try { if (!payload?.outputPath || !Array.isArray(payload.buffer)) throw new Error('Invalid recording payload'); fs.mkdirSync(path.dirname(payload.outputPath), { recursive: true }); fs.writeFileSync(payload.outputPath, Buffer.from(payload.buffer)); return { ok: true, outputPath: payload.outputPath }; } catch (error) { return { ok: false, error: error.message }; } });
    for (const [name, method] of Object.entries({
      'start-ffmpeg-window-recording': 'startWindow', 'start-ffmpeg-x11-recording': 'startX11',
      'pause-ffmpeg-window-recording': 'pause', 'resume-ffmpeg-window-recording': 'resume', 'stop-ffmpeg-window-recording': 'stop',
    })) ipcMain.handle(`aivuda-shell:${name}`, async (event) => {
      if (event.sender !== window?.webContents) return { ok: false, error: 'Only the desktop can record.' };
      try { return await recording[method](); } catch (error) { return { ok: false, error: error.message }; }
    });
    splash.status('Loading your desktop...');
    const desktopReady = createWindow();
    downloads.attach(window.webContents.session);
    downloads.attach(session.fromPartition('persist:aivuda-shell'));
    await Promise.all([
      desktopReady,
      startAgentConnection({ configuration: browserConfiguration, stateDirectory: paths.state, services })
        .then(connection => { agentConnection = connection; }),
    ]);
    if (quitting) return;
    window.show();
    splash.close();
    provisionOnce({ stateDirectory: paths.state, existingOsWorkspace, osUrl: endpoints.osApi, storeUrl: endpoints.store, storeApiUrl: endpoints.storeApi, configPath: path.join(app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', 'resources'), 'seed-apps', 'aceswarm-config-export.json') })
      .then((result) => console.log(result.skipped ? `ACEswarm seed provisioning skipped: ${result.reason}` : 'ACEswarm seed provisioning completed'))
      .catch((error) => { services.failures.push(`Seed provisioning: ${error.message}`); console.error(error); });
  } catch (error) {
    const showStartupError = !quitting && splash && !splash.window.isDestroyed();
    if (showStartupError) {
      splash.status('Startup failed.', `${error.message}\n\nLogs: ${paths?.logs || 'not initialized'}`);
      if (window && !window.isDestroyed()) window.destroy();
    }
    await agentConnection?.stop();
    await services?.stop();
    if (quitting) return;
    console.error('ACEswarm startup failed:', error);
    if (showStartupError) return;
    require('electron').dialog.showErrorBox('ACEswarm startup failed', `${error.message}\n\nLogs: ${paths?.logs || 'not initialized'}`);
    app.quit();
  }
});
app.on('before-quit', (event) => {
  if (quitting) return;
  if (!services) { quitting = true; return; }
  event.preventDefault();
  quitting = true;
  shutdown().finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
