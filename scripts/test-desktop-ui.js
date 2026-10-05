const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { execFileSync, spawn } = require('node:child_process');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-desktop-ui-'));
const screenshots = path.join(root, '.smoke', 'desktop');
fs.mkdirSync(screenshots, { recursive: true });
let application;
let server;
let tlsServer;
let retryServer;
let windowManager;
const errors = [];

async function gatewayPort() {
  // Keep gateway ports outside the debugger's ephemeral allocation range.
  for (let attempt = 0; attempt < 30; attempt++) {
    const port = 18000 + Math.floor(Math.random() * 10000);
    const probe = net.createServer();
    try {
      await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
      await new Promise((resolve) => probe.close(resolve));
      return port;
    } catch {}
  }
  throw new Error('Could not allocate test gateway port');
}

async function launch(expectedWindow) {
  application = await electron.launch({
    args: [path.join(root, 'tests/fixtures/desktop-electron.cjs'), '--no-sandbox'],
    env: {
      ...process.env, ELECTRON_RUN_AS_NODE: '',
      ACESWARM_UI_TEST_PROFILE: path.join(temp, 'profile'),
      ACESWARM_WS_ROOT: path.join(temp, 'workspace'),
      ACESWARM_GATEWAY_PORT: String(await gatewayPort()),
      ACESWARM_STORE_GATEWAY_PORT: String(await gatewayPort()),
      ACESWARM_PYTHON: path.join(root, '.venv/bin/python'),
      ACESWARM_CADDY: path.join(root, 'resources/app-gateway/caddy'),
    },
    timeout: 90000,
  });
  const page = await application.firstWindow({ timeout: 90000 });
  if (expectedWindow) {
    const restored = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      const { width, height } = window.getNormalBounds();
      return { width, height, maximized: window.isMaximized() };
    });
    assert.deepEqual(restored, expectedWindow, 'ACEswarm main window size and maximized state restore');
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
  }
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820));
  page.on('pageerror', (error) => { errors.push(error.message); console.error('Renderer error:', error); });
  await page.waitForFunction(() => typeof isRestoringShellState !== 'undefined' && !isRestoringShellState && document.querySelector('#dock .dock-item[data-app-url]'), { timeout: 30000 });
  return page;
}

async function count(page, expected) {
  await page.waitForFunction((value) => tabs.size === value, expected);
}

async function waitForGuestLayout(page) {
  await page.waitForFunction(async () => {
    const visible = [...tabs.values()].filter((tab) => tab.ready && !tab.body.hidden);
    const matches = await Promise.all(visible.map(async (tab) =>
      Math.abs(await tab.webview.executeJavaScript('innerWidth') * tab.webview.getZoomFactor() - tab.body.clientWidth) < 2));
    return matches.every(Boolean);
  });
}

async function sendDesktopShortcut(page, keyCode, guest = true) {
  const id = guest ? await page.evaluate(() => getActiveTab().webview.getWebContentsId()) : null;
  // CDP keyboard input bypasses Electron's before-input-event handler.
  await application.evaluate(({ webContents, BrowserWindow }, { id, keyCode }) => {
    const contents = id ? webContents.fromId(id) : BrowserWindow.getAllWindows()[0].webContents;
    contents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: ['control'] });
    contents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: ['control'] });
  }, { id, keyCode });
}

async function openPage(page, url) {
  await page.locator('#new-tab').click();
  await page.locator('#open-page-url').fill(url);
  await page.locator('#open-page-form button[type=submit]').click();
}

function windowControl(page, id) {
  return page.locator('[data-tab-panel-id="' + id + '"].compact-window-control, .dv-groupview:not(.single-panel) .panel-controls[data-panel-id="' + id + '"] .panel-menu');
}

async function windowCommand(page, id, command) {
  await windowControl(page, id).click();
  await page.locator('#window-' + command).click();
}

async function checkGroupHeader(page, id, compact) {
  await page.waitForFunction(({ id, compact }) => {
    const group = tabs.get(id)?.panel?.group;
    if (!group || group.element.classList.contains('single-panel') !== compact) return false;
    const header = group.element.querySelector('.dv-tabs-and-actions-container');
    const rect = header.getBoundingClientRect();
    const anchor = tabs.get(id).anchor.getBoundingClientRect();
    const bounds = group.element.getBoundingClientRect();
    return compact ? rect.height === 0 && Math.abs(anchor.top - bounds.top) < 1 : rect.height === 28;
  }, { id, compact });
  assert.equal(await page.locator('.panel-controls[data-panel-id="' + id + '"] button').count(), 1);
  assert.equal(await windowControl(page, id).count(), 1);
  assert.equal(await windowControl(page, id).isVisible(), true);
  if (compact) assert.equal(await page.locator('.panel-controls[data-panel-id="' + id + '"]').isVisible(), false);
}

async function checkRecording(page, mode) {
  if (mode === 'native') await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => { throw new Error('Desktop capture must not be used for Native recording'); };
  });
  await page.evaluate(() => { screenRecordDetailsExpanded = true; renderScreenRecordBar(); });
  await page.locator('[data-screen-record-mode="' + mode + '"]').click();
  await page.locator('[data-start-screen-record]').click();
  await page.waitForFunction(() => screenRecordStatus === 'recording' || screenRecordStatus === 'error', { timeout: 15000 });
  assert.equal(await page.evaluate(() => screenRecordStatus), 'recording', await page.evaluate(() => screenRecordStatusText));
  if (mode === 'ffmpeg') {
    await page.locator('#tools-button').click();
    assert.equal(await page.locator('#tools-record').getAttribute('aria-checked'), 'true');
    await page.screenshot({ path: path.join(screenshots, 'desktop-overlay-menu.png') });
    await page.locator('#tools-record').click();
    assert.equal(await page.locator('[data-pause-screen-record]').count(), 0);
    assert.equal(await page.evaluate(() => screenRecordStatus), 'recording');
    await page.locator('#tools-button').click();
    assert.equal(await page.locator('#tools-record').getAttribute('aria-checked'), 'false');
    await page.locator('#tools-record').click();
  }
  await page.waitForFunction(() => screenRecordElapsedMs >= 700);
  await page.locator('[data-pause-screen-record]').click();
  await page.waitForFunction(() => screenRecordStatus === 'paused' || screenRecordStatus === 'error');
  assert.equal(await page.evaluate(() => screenRecordStatus), 'paused', await page.evaluate(() => screenRecordStatusText));
  await page.locator('[data-expand-screen-record]').click();
  assert.equal(await page.locator('[data-screen-record-mode="native"]').isDisabled(), true);
  await page.locator('[data-pause-screen-record]').click();
  await page.waitForFunction(() => screenRecordStatus === 'recording');
  await page.waitForFunction(() => screenRecordElapsedMs >= 1400);
  await page.locator('[data-stop-screen-record]').click();
  await page.waitForFunction(() => screenRecordStatus === 'saved' || screenRecordStatus === 'error', { timeout: 15000 });
  assert.equal(await page.evaluate(() => screenRecordStatus), 'saved', await page.evaluate(() => screenRecordStatusText));
  const file = await page.evaluate(() => screenRecorderLastSavedPath);
  assert.ok(fs.statSync(file).size > 1000);
  const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', file], { encoding: 'utf8' }));
  const video = metadata.streams.find((stream) => stream.codec_type === 'video');
  assert.ok(video.width > 600 && video.height > 300 && Number(video.nb_read_frames) > 5);
  const frame = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 20 * 1024 * 1024 });
  const shades = new Set();
  for (let i = 0; i < frame.length; i += 101) shades.add(frame[i]);
  assert.ok(shades.size > 50, 'recorded frame must contain rendered UI, not a blank image');
  fs.copyFileSync(file, path.join(screenshots, 'recording-' + mode + path.extname(file)));
  if (mode === 'ffmpeg') execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-frames:v', '1', path.join(screenshots, 'recording-preview.png')]);
  console.log('PASS: ' + mode + ' start, pause, resume, stop and decodable nonblank video (' + video.width + 'x' + video.height + ')');
}

async function run() {
  server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>Robot Console</title><body style="font-family:system-ui;background:#fff;padding:24px"><h1>Robot Console</h1><p id="live">Connected</p><a id="popup" href="/child" target="_blank">Open telemetry</a><button id="script-popup" onclick="window.open(\'/script-child\')">Open map</button><script>window.tick=0;setInterval(()=>window.tick++,100)</script></body>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const robotUrl = 'http://127.0.0.1:' + server.address().port + '/robot';
  let page = await launch();
  await count(page, 0);
  assert.equal(await page.evaluate(() => desktopVisible), true);
  assert.equal(await page.evaluate(() => activeTabId), null);
  assert.equal(await page.locator('#dock-layout').isVisible(), false);
  assert.deepEqual(await page.locator('#desktop-shortcuts .shortcut-label').allTextContents(), ['Applications', 'Store Admin']);
  await page.screenshot({ path: path.join(screenshots, 'desktop-first-launch.png') });
  await page.locator('#desktop-shortcuts .desktop-shortcut').first().click();
  await count(page, 1);
  await page.waitForFunction(() => getActiveTab().webview.getURL().startsWith('http:'));
  console.log('PASS: first launch shows an empty desktop; Applications opens from its shortcut');
  await page.waitForFunction(() => getActiveTab().title === 'Applications');
  assert.equal(await page.evaluate(() => resolveTabDisplayTitle('AivudaOS', defaultUrl)), 'Applications');
  const initialId = await page.evaluate(() => activeTabId);
  const initialLayout = await page.evaluate(() => desktopLayout.toJSON());
  const initialGuest = await page.evaluate(() => getActiveTab().webview.getWebContentsId());
  await checkGroupHeader(page, initialId, true);
  await page.waitForFunction(async () => getActiveTab()?.ready && await getActiveTab().webview.executeJavaScript('document.body.innerText.trim().length > 0'));
  const defaultStore = await page.evaluate(() => storeUrl.replace(/\/+$/, ''));
  assert.equal(await page.evaluate(() => getActiveTab().webview.executeJavaScript('localStorage.getItem("aivuda_ui_appstore_base_url")')), defaultStore);
  await page.evaluate(() => getActiveTab().webview.executeJavaScript('localStorage.setItem("aivuda_ui_appstore_base_url", "http://127.0.0.1:18001"); localStorage.setItem("aceswarm_default_appstore_base_url", "http://127.0.0.1:18001"); location.reload()'));
  await page.waitForFunction(async (url) => await getActiveTab().webview.executeJavaScript('localStorage.getItem("aivuda_ui_appstore_base_url")') === url, defaultStore);
  await page.evaluate(() => getActiveTab().webview.executeJavaScript('localStorage.setItem("aivuda_ui_appstore_base_url", "https://custom-store.example"); location.reload()'));
  await page.waitForFunction(async () => await getActiveTab().webview.executeJavaScript('document.readyState') === 'complete');
  assert.equal(await page.evaluate(() => getActiveTab().webview.executeJavaScript('localStorage.getItem("aivuda_ui_appstore_base_url")')), 'https://custom-store.example');
  await page.evaluate(() => getActiveTab().webview.executeJavaScript('localStorage.removeItem("aivuda_ui_appstore_base_url"); location.reload()'));
  await page.waitForFunction(async (url) => await getActiveTab().webview.executeJavaScript('localStorage.getItem("aivuda_ui_appstore_base_url")') === url, defaultStore);
  console.log('PASS: internal AivudaOS receives the actual store URL before startup, refreshes managed defaults and preserves user URLs');
  await page.waitForFunction(async (base) => {
    return getActiveTab().webview.executeJavaScript(`fetch(${JSON.stringify(base + '/aivuda_app_store/store/index')}).then(r => r.json()).then(data => data.items.length > 0).catch(() => false)`);
  }, defaultStore);
  const storeDownload = await page.evaluate((base) => getActiveTab().webview.executeJavaScript(`(async () => {
    const base = ${JSON.stringify(base)};
    const index = await (await fetch(base + '/aivuda_app_store/store/index')).json();
    const app = index.items[0];
    const info = await (await fetch(base + '/aivuda_app_store/store/apps/' + encodeURIComponent(app.app_id) + '/versions/' + encodeURIComponent(app.version) + '/download-url')).json();
    const url = new URL(info.url, base).href;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Store download status: ' + response.status);
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
    return { url, size: bytes.byteLength, expectedSize: info.size, hash, expectedHash: info.sha256 };
  })()`), defaultStore);
  assert.equal(storeDownload.size, storeDownload.expectedSize);
  assert.equal(storeDownload.hash, storeDownload.expectedHash);
  const storePreflight = await fetch(storeDownload.url, { method: 'OPTIONS', headers: { Origin: await page.evaluate(() => new URL(defaultUrl).origin), 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Range' } });
  assert.equal(storePreflight.status, 204);
  assert.equal(storePreflight.headers.get('access-control-allow-origin'), '*');
  console.log('PASS: AivudaOS browser fetches store metadata and package bytes across origins with matching SHA-256; file preflight works');
  await page.locator('#show-desktop').click();
  assert.equal(await page.evaluate(() => desktopVisible), true);
  assert.equal(await page.locator('#dock-layout').isVisible(), false);
  assert.equal(await page.evaluate(() => document.elementFromPoint(78, 65)?.closest('#webview-stack') !== null), false);
  assert.deepEqual(await page.evaluate(() => desktopLayout.toJSON()), initialLayout);
  assert.equal(await page.evaluate(() => [...tabs.values()].some((tab) => tab.minimized)), false);
  const desktopShot = await page.screenshot({ path: path.join(screenshots, 'desktop-workspace-hidden.png') });
  const desktopPixel = await application.evaluate(({ nativeImage }, bytes) => {
    const image = nativeImage.createFromBuffer(Buffer.from(bytes));
    const bitmap = image.toBitmap();
    const { width, height } = image.getSize();
    const offset = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    return [...bitmap.subarray(offset, offset + 3)];
  }, [...desktopShot]);
  assert.ok(desktopPixel.some((value) => value < 245), 'Desktop center must show the desktop background, not white Dockview');
  await page.locator('#dock button[data-app-url="' + await page.evaluate(() => defaultUrl) + '"]').click();
  assert.equal(await page.evaluate(() => desktopVisible), false);
  assert.equal(await page.evaluate(() => getActiveTab().webview.getWebContentsId()), initialGuest);
  assert.deepEqual(await page.evaluate(() => desktopLayout.toJSON()), initialLayout);
  const singleTab = await page.locator('[data-tab-panel-id="' + initialId + '"]').boundingBox();
  await page.mouse.move(singleTab.x + singleTab.width / 2, singleTab.y + singleTab.height / 2);
  await page.mouse.down();
  await page.mouse.move(8, 450, { steps: 20 });
  assert.equal(await page.locator('#workspace-snap-preview').isVisible(), true);
  await page.mouse.up();
  await page.waitForFunction(() => workspaceRegion === 'left');
  assert.equal((await page.locator('#webview-stack').boundingBox()).width, 640);
  await waitForGuestLayout(page);
  await page.screenshot({ path: path.join(screenshots, 'desktop-single-left.png') });
  assert.equal(await page.locator('#window-menu').isVisible(), false, 'drag does not open the menu');
  await windowControl(page, initialId).click();
  await page.locator('#workspace-right').click();
  assert.equal((await page.locator('#webview-stack').boundingBox()).x, 640);
  await windowCommand(page, initialId, 'max');
  assert.equal((await page.locator('#webview-stack').boundingBox()).width, 1280);
  await windowCommand(page, initialId, 'max');
  assert.equal((await page.locator('#webview-stack').boundingBox()).x, 640);
  await page.locator('#show-desktop').click();
  await page.locator('#show-desktop').click();
  assert.equal(await page.evaluate(() => workspaceRegion), 'right');
  await openPage(page, robotUrl + '/snap-test');
  await count(page, 2);
  assert.equal(await page.evaluate(() => workspaceRegion), 'full');
  assert.equal(await page.evaluate(() => desktopLayout.groups.length), 2);
  await page.evaluate(() => closeTab(activeTabId));
  await count(page, 1);
  console.log('PASS: show desktop preserves workspace and guests; single-window edge snapping and complementary split work');

  const keyPath = path.join(temp, 'self-signed-key.pem');
  const certPath = path.join(temp, 'self-signed-cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=untrusted.test'], { stdio: 'ignore' });
  tlsServer = https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, (_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>Self-signed Store</title><h1 id="tls-loaded">HTTPS connected</h1>');
  });
  await new Promise((resolve) => tlsServer.listen(0, '127.0.0.1', resolve));
  const tlsUrl = 'https://127.0.0.1:' + tlsServer.address().port + '/store';
  await assert.rejects(fetch(tlsUrl));
  await openPage(page, tlsUrl);
  await page.waitForFunction(() => getActiveTab().title === 'Self-signed Store');
  assert.equal(await page.evaluate(() => getActiveTab().webview.executeJavaScript('document.getElementById("tls-loaded").textContent')), 'HTTPS connected');
  await page.evaluate(() => closeTab(activeTabId));
  const retryPort = await gatewayPort();
  const retryUrl = 'http://127.0.0.1:' + retryPort + '/unavailable';
  await openPage(page, retryUrl);
  await page.waitForFunction(() => getActiveTab().webview.getURL().startsWith(offlineUrl) && getActiveTab().ready);
  const failureText = await page.evaluate(() => getActiveTab().webview.executeJavaScript('document.body.innerText'));
  assert.ok(failureText.includes('ACEswarm') && failureText.includes('ERR_CONNECTION_REFUSED'));
  assert.equal(failureText.includes('不会自动启动'), false);
  assert.equal(await page.evaluate(() => getTabUrl(getActiveTab())), retryUrl);
  await page.screenshot({ path: path.join(screenshots, 'desktop-page-unavailable.png') });
  retryServer = http.createServer((_request, response) => response.end('<!doctype html><title>Retry connected</title><h1>Connected</h1>'));
  await new Promise((resolve) => retryServer.listen(retryPort, '127.0.0.1', resolve));
  await page.evaluate(() => getActiveTab().webview.executeJavaScript('document.getElementById("reload-button").click()'));
  await page.waitForFunction(() => getActiveTab().title === 'Retry connected');
  await page.evaluate(() => closeTab(activeTabId));
  await count(page, 1);
  console.log('PASS: untrusted HTTPS loads; generic load failure page retries the original URL');
  await page.evaluate(() => { nextTabId = 2; });
  assert.equal(await page.locator('#dock .dock-label').nth(0).textContent(), 'Applications');
  assert.equal(await page.locator('#dock .dock-label').nth(1).textContent(), 'Store Admin');
  assert.deepEqual(await page.locator('#desktop-shortcuts .shortcut-label').allTextContents(), ['Applications', 'Store Admin']);
  assert.equal(await page.locator('#open-home').textContent(), 'Applications');
  assert.equal(await page.locator('#open-store').textContent(), 'Store Admin');
  assert.equal(await application.evaluate(({ Menu }) => Menu.getApplicationMenu()), null);
  assert.equal(await page.evaluate(() => document.querySelector('#dock').closest('.desktop-bar') !== null), true);
  await page.locator('#tools-button').click();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'system-desktop');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#tools-menu').isVisible(), false);

  await openPage(page, robotUrl);
  await count(page, 2);
  await page.waitForFunction(() => getActiveTab().title === 'Robot Console');
  const robotId = await page.evaluate(() => activeTabId);
  assert.equal(await page.evaluate(() => getActiveTab().webview.executeJavaScript('localStorage.getItem("aivuda_ui_appstore_base_url")')), null, 'external pages receive no store URL');
  await checkGroupHeader(page, robotId, false);
  assert.equal(await page.evaluate(() => getActiveTab().webview.executeJavaScript('document.getElementById("live").textContent')), 'Connected');
  await windowCommand(page, robotId, 'pin');
  await page.waitForFunction((url) => favorites.some((entry) => entry.url === url), robotUrl);
  assert.equal(await page.locator('#desktop-shortcuts .desktop-shortcut').count(), 3);
  console.log('PASS: custom page loads, receives title, and pins to Dock and desktop');

  await page.evaluate(() => getActiveTab().webview.executeJavaScript('window.testInstance = "preserved"'));
  await windowCommand(page, robotId, 'min');
  await page.waitForFunction((id) => tabs.get(id).minimized, robotId);
  assert.equal(await page.locator('#' + robotId).isVisible(), false);
  assert.equal(await page.evaluate((id) => tabs.get(id).webview.getURL(), robotId), robotUrl);
  await page.locator('#dock button[data-app-url="' + robotUrl + '"]').click();
  await page.waitForFunction((id) => activeTabId === id && !tabs.get(id).minimized, robotId);
  await count(page, 2);
  assert.equal(await page.evaluate(() => getActiveTab().webview.executeJavaScript('window.testInstance')), 'preserved');
  console.log('PASS: minimize keeps WebView alive; Dock restores without duplicate windows');

  await windowCommand(page, robotId, 'address');
  assert.equal(await page.locator('#browser-toolbar').isVisible(), true);
  await page.locator('#collapse-chrome').click();
  await page.locator('#' + robotId + ' webview').click({ position: { x: 450, y: 200 } });
  await sendDesktopShortcut(page, 'L');
  await page.waitForFunction(() => !document.getElementById('browser-toolbar').hidden);
  await sendDesktopShortcut(page, 'L', false);
  await page.waitForFunction(() => document.getElementById('browser-toolbar').hidden);
  await sendDesktopShortcut(page, '=');
  await page.waitForFunction(() => Math.abs(getActiveTab().webview.getZoomFactor() - 1.1) < 0.01);
  await sendDesktopShortcut(page, '0');
  await page.waitForFunction(() => getActiveTab().webview.getZoomFactor() === 1);
  assert.equal(await page.locator('#browser-toolbar').isVisible(), false);
  await windowControl(page, robotId).click();
  assert.equal(await page.locator('#window-menu').isVisible(), true);
  await windowControl(page, robotId).click();
  assert.equal(await page.locator('#window-menu').isVisible(), false);
  await windowControl(page, robotId).click();
  await page.locator('#window-zoom-in').click();
  assert.equal(await page.locator('#window-zoom-reset').textContent(), '110%');
  assert.ok(Math.abs(await page.evaluate(() => getActiveTab().webview.getZoomFactor()) - 1.1) < 0.01);
  await page.locator('#window-zoom-out').click();
  assert.equal(await page.locator('#window-zoom-reset').textContent(), '100%');
  await page.locator('#window-zoom-in').click();
  await page.locator('#window-zoom-reset').click();
  assert.equal(await page.locator('#window-zoom-reset').textContent(), '100%');
  await page.screenshot({ path: path.join(screenshots, 'desktop-window-controls.png') });
  await page.locator('#window-address').click();
  assert.equal(await page.locator('#browser-toolbar').isVisible(), true);
  await page.locator('#collapse-chrome').click();
  await page.locator('#tools-button').click();
  await page.locator('#system-address').click();
  assert.equal(await page.locator('#browser-toolbar').isVisible(), true);
  await page.locator('#collapse-chrome').click();
  await windowCommand(page, robotId, 'max');
  assert.equal(await page.evaluate((id) => tabs.get(id).panel.api.isMaximized(), robotId), true);
  assert.deepEqual(await page.evaluate((id) => {
    const { x, y, width, height } = tabs.get(id).panel.group.element.getBoundingClientRect();
    return { x, y, width, height };
  }, robotId), await page.evaluate(() => ({ x: 0, y: 48, width: innerWidth, height: innerHeight - 48 })));
  await page.locator('#tools-button').click();
  await page.screenshot({ path: path.join(screenshots, 'desktop-system-menu.png') });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(screenshots, 'desktop-maximized-top-dock.png') });
  await page.locator('#toggle-dock').click();
  assert.equal(await page.evaluate(() => dockCollapsed), true);
  const maximized = await page.evaluate((id) => {
    const { x, y, width, height } = tabs.get(id).panel.group.element.getBoundingClientRect();
    return { x, y, width, height };
  }, robotId);
  assert.equal(maximized.x, 0); assert.equal(maximized.width, 1280);
  assert.equal(maximized.y, 28); assert.equal(maximized.height, 792);
  assert.equal(await page.locator('#dock .dock-label').nth(0).isVisible(), true);
  assert.equal(await page.locator('#dock .app-icon').nth(0).isVisible(), false);
  await page.locator('#dock button[data-app-url="' + await page.evaluate(() => defaultUrl) + '"]').click();
  await page.waitForFunction(() => activeTabId === 'tab-1');
  await page.locator('#dock button[data-app-url="' + robotUrl + '"]').click();
  await page.waitForFunction((id) => activeTabId === id, robotId);
  await count(page, 2);
  await page.locator('#dock button[data-app-url="' + robotUrl + '"]').click({ button: 'right' });
  assert.equal(await page.getByRole('menuitem', { name: 'New window', exact: true }).isVisible(), true);
  await page.keyboard.press('Escape');
  await page.locator('#tools-button').click();
  assert.equal(await page.locator('#tools-menu').isVisible(), true);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(screenshots, 'desktop-maximized-collapsed-dock.png') });
  await page.locator('#toggle-dock').click();
  await windowCommand(page, robotId, 'max');
  assert.equal(await page.evaluate((id) => tabs.get(id).panel.api.isMaximized(), robotId), false);
  const guestId = await page.evaluate((id) => tabs.get(id).webview.getWebContentsId(), robotId);
  const header = page.locator('[data-tab-panel-id="' + robotId + '"]');
  const box = await header.boundingBox();
  await page.mouse.move(box.x + Math.min(35, box.width / 2), box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(1265, 450, { steps: 25 });
  await page.screenshot({ path: path.join(screenshots, 'desktop-dockview-drag.png') });
  await page.mouse.up();
  await page.waitForFunction(() => desktopLayout.groups.filter((group) => group.api.location.type === 'grid').length === 2);
  await checkGroupHeader(page, robotId, true);
  await checkGroupHeader(page, 'tab-1', true);
  assert.equal(await page.evaluate((id) => tabs.get(id).webview.getWebContentsId(), robotId), guestId);
  assert.equal(await page.evaluate((id) => tabs.get(id).webview.executeJavaScript('window.testInstance'), robotId), 'preserved');
  await waitForGuestLayout(page);
  await page.screenshot({ path: path.join(screenshots, 'desktop-dockview-split.png') });
  const sash = await page.locator('#dock-layout .dv-sash').first().boundingBox();
  const originalWidth = await page.evaluate((id) => tabs.get(id).panel.api.width, robotId);
  await page.mouse.move(sash.x + sash.width / 2, sash.y + sash.height / 2);
  await page.mouse.down();
  await page.mouse.move(sash.x - 90, sash.y + sash.height / 2, { steps: 10 });
  await page.mouse.up();
  assert.notEqual(await page.evaluate((id) => tabs.get(id).panel.api.width, robotId), originalWidth);
  await page.evaluate((id) => tabs.get(id).panel.api.moveTo({ group: tabs.get('tab-1').panel.group, position: 'bottom' }), robotId);
  await page.screenshot({ path: path.join(screenshots, 'desktop-dockview-stacked.png') });
  await windowCommand(page, robotId, 'float');
  assert.equal(await page.evaluate((id) => tabs.get(id).panel.api.location.type, robotId), 'floating');
  await checkGroupHeader(page, robotId, false);
  const floatHeader = await page.locator('.dv-floating-titlebar').boundingBox();
  const initial = await page.locator('#' + robotId).boundingBox();
  await page.mouse.move(floatHeader.x + 45, floatHeader.y + 8);
  await page.mouse.down();
  await page.mouse.move(floatHeader.x + 85, floatHeader.y + 28, { steps: 10 });
  await page.mouse.up();
  const moved = await page.locator('#' + robotId).boundingBox();
  assert.ok(moved.x !== initial.x || moved.y !== initial.y);
  assert.equal(await page.evaluate((id) => tabs.get(id).webview.getWebContentsId(), robotId), guestId);
  await page.screenshot({ path: path.join(screenshots, 'desktop-dockview-floating.png') });
  await windowCommand(page, robotId, 'float');
  assert.equal(await page.evaluate((id) => tabs.get(id).panel.api.location.type, robotId), 'grid');
  await page.locator('#dock button[data-app-url="' + robotUrl + '"]').click();
  await page.waitForFunction((id) => activeTabId === id, robotId);
  console.log('PASS: Dockview drag docking, split resize, stacking, floating and guest state preservation');
  console.log('PASS: single-panel headers reclaim page height; one control supports click and drag; floating headers work');

  await page.evaluate(() => getActiveTab().webview.executeJavaScript('document.getElementById("popup").click()'));
  await count(page, 3);
  await page.waitForFunction(() => getActiveTab().webview.getURL().endsWith('/child'));
  await page.evaluate(() => getActiveTab().webview.executeJavaScript('document.getElementById("script-popup").click()'));
  await count(page, 4);
  await page.waitForFunction(() => getActiveTab().webview.getURL().endsWith('/script-child'));
  console.log('PASS: target=_blank and page-world window.open create internal windows');

  await page.locator('#dock button[data-app-url="' + robotUrl + '"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New window', exact: true }).click();
  await count(page, 5);
  await page.waitForFunction(() => getActiveTab().title === 'Robot Console');
  assert.equal(await page.locator('#dock button[data-app-url="' + robotUrl + '"] .window-badge').textContent(), '2');
  assert.equal(await page.locator('#dock button[data-app-url="' + robotUrl + '"]').count(), 1);
  await page.locator('#toggle-dock').click();
  assert.equal(await page.locator('#dock button[data-app-url="' + robotUrl + '"] .window-badge').isVisible(), true);
  assert.equal(await page.locator('#dock button[data-app-url="' + robotUrl + '"] .dock-label').textContent(), 'Robot Console');
  await page.screenshot({ path: path.join(screenshots, 'desktop-text-dock-multiple-windows.png') });
  await page.locator('#toggle-dock').click();
  const duplicateId = await page.evaluate(() => activeTabId);
  await page.locator('[data-tab-panel-id="' + duplicateId + '"] .dv-default-tab-action').click();
  await count(page, 4);
  console.log('PASS: multiple windows share one application Dock icon');

  for (const [id, state] of [['tools-fps', 'performanceOverlayVisible'], ['tools-record', 'screenRecordBarVisible']]) {
    for (const visible of [true, false, true, false]) {
      await page.locator('#tools-button').click();
      assert.equal(await page.locator('#' + id).getAttribute('aria-checked'), String(!visible));
      await page.locator('#' + id).click();
      assert.equal(await page.evaluate((name) => window.eval(name), state), visible);
      assert.equal(await page.locator('#' + id).getAttribute('aria-checked'), String(visible));
    }
  }
  console.log('PASS: FPS and recording menu entries toggle visibility and checked indicators');
  await page.locator('#tools-button').click();
  await page.locator('#tools-record').click();
  for (const mode of ['ffmpeg', 'native', 'native', 'native', 'ffmpeg-x11']) await checkRecording(page, mode);
  await page.evaluate(() => { screenRecordBarVisible = false; renderScreenRecordBar(); });
  await page.evaluate(() => {
    for (const tab of [...tabs.values()]) if (tab.id !== 'tab-2' && tab.id !== 'tab-1') closeTab(tab.id);
    activateTab('tab-2');
  });
  await count(page, 2);
  await page.screenshot({ path: path.join(screenshots, 'desktop-1280.png') });
  await application.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(850, 550); });
  await page.waitForFunction(() => innerWidth === 850);
  await page.screenshot({ path: path.join(screenshots, 'desktop-850.png') });
  await application.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(0, 0); window.setContentSize(390, 844); });
  await page.waitForFunction(() => innerWidth === 390);
  await waitForGuestLayout(page);
  await page.waitForFunction(() => [...tabs.values()].every((tab) => tab.minimized || tab.body.getBoundingClientRect().right <= innerWidth + 1));
  await page.screenshot({ path: path.join(screenshots, 'desktop-390.png') });
  await page.locator('#tools-button').click();
  const systemMenu = await page.locator('#tools-menu').boundingBox();
  assert.ok(systemMenu.x >= 0 && systemMenu.x + systemMenu.width <= 390);
  assert.ok(systemMenu.y + systemMenu.height <= 844);
  await page.screenshot({ path: path.join(screenshots, 'desktop-system-390.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('#toggle-dock').click();
  await page.screenshot({ path: path.join(screenshots, 'desktop-text-dock-390.png') });
  const dockRow = await page.locator('#dock .dock-items').boundingBox();
  await page.mouse.move(dockRow.x + dockRow.width / 2, dockRow.y + dockRow.height / 2);
  await page.mouse.wheel(0, 200);
  await page.waitForFunction(() => document.querySelector('#dock .dock-items').scrollLeft > 0);
  await page.locator('#dock button[data-app-url="' + robotUrl + '"]').click();
  await page.waitForFunction((id) => activeTabId === id, robotId);
  assert.ok(await page.evaluate(() => document.querySelector('#dock .dock-items').scrollLeft) > 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.locator('#toggle-dock').click();
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1280, 820); });
  await page.waitForFunction(() => innerWidth === 1280);
  await page.evaluate((id) => { tabs.get(id).panel.api.moveTo({ group: tabs.get('tab-1').panel.group, position: 'center' }); }, robotId);
  await windowCommand(page, robotId, 'min');
  await page.locator('#toggle-dock').click();
  await page.evaluate(() => writeShellState());
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(1100, 720);
    window.maximize();
  });
  await page.waitForFunction(() => innerWidth > 1100);
  const bootstrapStatePath = path.join(temp, 'workspace', 'state', 'seed-bootstrap.json');
  const bootstrapState = fs.readFileSync(bootstrapStatePath, 'utf8');
  assert.equal(JSON.parse(bootstrapState).status, 'completed', 'First launch completes seed bootstrap');
  await application.close();
  application = null;
  const saved = JSON.parse(fs.readFileSync(path.join(temp, 'profile', 'shell-state.json')));
  assert.equal(saved.version, 3);
  assert.ok(saved.favorites.some((entry) => entry.url === robotUrl));
  assert.ok(saved.layout.panels['tab-1']);
  assert.equal(saved.tabs.find((tab) => tab.id === robotId).minimized, true);

  page = await launch({ width: 1100, height: 720, maximized: true });
  assert.equal(fs.readFileSync(bootstrapStatePath, 'utf8'), bootstrapState, 'Restart preserves completed seed bootstrap state');
  console.log('PASS: seed bootstrap completes once and its state survives restart unchanged');
  console.log('PASS: ACEswarm outer window restores normal size and maximized state');
  await count(page, 2);
  assert.equal(await page.evaluate((id) => tabs.get(id).minimized, robotId), true);
  assert.equal(await page.evaluate(() => favorites.length), 1);
  assert.equal(await page.evaluate(() => screenRecordMode), 'ffmpeg-x11');
  assert.equal(await page.evaluate(() => dockCollapsed), true);
  assert.equal(await page.locator('#dock .dock-label').nth(0).isVisible(), true);
  await page.locator('#toggle-dock').click();
  assert.notEqual(await page.evaluate(() => defaultUrl), saved.serviceOrigins.os);
  assert.equal(await page.evaluate(() => new URL(tabs.get('tab-1').url).origin), await page.evaluate(() => new URL(defaultUrl).origin));
  assert.equal(await page.evaluate(() => tabs.get('tab-1').appUrl), await page.evaluate(() => defaultUrl));
  await page.locator('#dock button[data-app-url="' + robotUrl + '"]').click();
  assert.equal(await page.evaluate((id) => tabs.get(id).panel.group.id === tabs.get('tab-1').panel.group.id, robotId), true);
  console.log('PASS: restart restores pinned application, minimized state, geometry and remaps service ports');
  await windowCommand(page, robotId, 'close');
  await count(page, 1);
  assert.equal(await page.locator('#dock button[data-app-url="' + robotUrl + '"]').count(), 1);
  await page.locator('#dock button[data-app-url="' + robotUrl + '"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unpin from Dock' }).click();
  assert.equal(await page.locator('#dock button[data-app-url="' + robotUrl + '"]').count(), 0);
  await page.evaluate(() => closeTab(activeTabId));
  await count(page, 0);
  assert.equal(await page.evaluate(() => activeTabId), null);
  await page.locator('#desktop-shortcuts .desktop-shortcut').first().click();
  await count(page, 1);
  await page.locator('#show-desktop').click();
  assert.equal(await page.evaluate(() => desktopVisible), true);
  await page.screenshot({ path: path.join(screenshots, 'desktop-empty.png') });
  console.log('PASS: close keeps pinned icon, unpin removes it, last close reaches desktop, shortcuts and show-desktop work');
  const layoutIds = await page.evaluate((url) => {
    const home = [...tabs.values()][0];
    activateTab(home.id);
    const robot = createTab(url);
    robot.panel.api.moveTo({ group: home.panel.group, position: 'right' });
    const child = createTab(url + 'layout-child');
    child.panel.api.moveTo({ group: robot.panel.group, position: 'bottom' });
    robot.panel.group.api.setSize({ height: 460 });
    floatOrDockPanel(home);
    return { home: home.id, robot: robot.id, child: child.id };
  }, robotUrl);
  await page.waitForFunction(() => [...tabs.values()].every((tab) => tab.ready));
  const splitRatio = await page.evaluate(({ robot, child }) => tabs.get(robot).panel.api.height / (tabs.get(robot).panel.api.height + tabs.get(child).panel.api.height), layoutIds);
  const mixedLayout = await page.evaluate(() => desktopLayout.toJSON());
  const mixedGuests = await page.evaluate(() => [...tabs.values()].map((tab) => tab.webview.getWebContentsId()));
  await page.locator('#show-desktop').click();
  assert.deepEqual(await page.evaluate(() => desktopLayout.toJSON()), mixedLayout);
  assert.equal(await page.locator('#dock-layout').isVisible(), false);
  await page.screenshot({ path: path.join(screenshots, 'desktop-mixed-layout-hidden.png') });
  await page.locator('#show-desktop').click();
  assert.deepEqual(await page.evaluate(() => desktopLayout.toJSON()), mixedLayout);
  assert.deepEqual(await page.evaluate(() => [...tabs.values()].map((tab) => tab.webview.getWebContentsId())), mixedGuests);
  await page.locator('#show-desktop').click();
  await page.evaluate(() => writeShellState());
  await application.close();
  application = null;
  page = await launch();
  await count(page, 3);
  await page.waitForFunction(() => [...tabs.values()].every((tab) => tab.ready));
  assert.equal(await page.evaluate(() => desktopVisible), true);
  assert.equal(await page.locator('#dock-layout').isVisible(), false);
  await page.locator('#dock button[data-app-url="' + robotUrl + '"]').click();
  assert.equal(await page.evaluate(() => desktopVisible), false);
  assert.equal(await page.evaluate(({ home }) => tabs.get(home).panel.api.location.type, layoutIds), 'floating');
  assert.equal(await page.evaluate(() => desktopLayout.groups.filter((group) => group.api.location.type === 'grid').length), 2);
  const restoredRatio = await page.evaluate(({ robot, child }) => tabs.get(robot).panel.api.height / (tabs.get(robot).panel.api.height + tabs.get(child).panel.api.height), layoutIds);
  assert.ok(Math.abs(restoredRatio - splitRatio) < 0.03, 'Split proportions survive restart');
  await page.screenshot({ path: path.join(screenshots, 'desktop-dockview-restored.png') });
  console.log('PASS: nested split proportions and floating groups survive restart');
  await application.close();
  application = null;
  fs.writeFileSync(path.join(temp, 'profile', 'shell-state.json'), JSON.stringify({
    tabs: [{ id: 'tab-9', url: robotUrl, bounds: { x: 130, y: 90, width: 640, height: 400 } }], activeTabId: 'tab-9',
    favorites: [{ url: robotUrl, title: 'Legacy robot' }], chromeExpanded: true,
  }));
  page = await launch();
  await count(page, 1);
  assert.equal(await page.evaluate(() => favorites[0].title), 'Legacy robot');
  assert.equal(await page.evaluate(() => getActiveTab().appUrl), robotUrl);
  assert.equal(await page.evaluate(() => getActiveTab().panel.api.location.type), 'floating');
  assert.equal(await page.locator('#browser-toolbar').isVisible(), true);
  console.log('PASS: legacy tabs and bookmarks migrate into desktop windows and Dock');
  await page.evaluate(() => setWorkspaceRegion('right'));
  await page.locator('#show-desktop').click();
  await page.evaluate(() => writeShellState());
  await application.close();
  application = null;
  page = await launch();
  await page.waitForFunction(() => tabs.get('tab-9')?.ready);
  assert.equal(await page.evaluate(() => workspaceRegion), 'right');
  assert.equal(await page.evaluate(() => desktopVisible), true);
  await page.locator('#dock button[data-app-url="' + robotUrl + '"]').click();
  assert.equal(await page.evaluate(() => desktopVisible), false);
  assert.equal((await page.locator('#webview-stack').boundingBox()).x, 640);
  assert.equal((await page.locator('#webview-stack').boundingBox()).width, 640);
  console.log('PASS: mixed workspace toggles without changing layout or guests; desktop and half-screen state survive restart');
  await page.evaluate(() => { screenRecordMode = 'native'; showScreenRecordBar(); });
  await page.locator('[data-start-screen-record]').click();
  await page.waitForFunction(() => screenRecordStatus === 'recording' || screenRecordStatus === 'error');
  assert.equal(await page.evaluate(() => screenRecordStatus), 'recording');
  await page.waitForFunction(() => screenRecordElapsedMs > 700);
  const closingFile = await page.evaluate(() => screenRecorderOutputPath);
  const exited = new Promise((resolve) => application.process().once('exit', resolve));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await exited;
  application = null;
  const closedVideo = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', closingFile], { encoding: 'utf8' }));
  // A static native window may emit only a few frames in this sub-second clip.
  assert.ok(Number(closedVideo.streams[0].nb_read_frames) > 0);
  console.log('PASS: native window close flushes recording before destroying the renderer');
  assert.deepEqual(errors, []);
  console.log('Desktop UI tests completed. Screenshots:', screenshots);
}

async function startTests() {
  if (process.env.ACESWARM_TEST_WINDOW_MANAGER) {
    windowManager = spawn(process.env.ACESWARM_TEST_WINDOW_MANAGER, ['--sm-disable'], { stdio: 'ignore' });
    await new Promise((resolve, reject) => {
      windowManager.once('error', reject);
      setTimeout(resolve, 500);
    });
  }
  await run();
}

startTests().catch(async (error) => {
  console.error(error); process.exitCode = 1;
  if (application) {
    const page = application.windows()[0];
    if (page) await page.screenshot({ path: path.join(screenshots, 'failure.png') }).catch(() => {});
  }
}).finally(async () => {
  if (application) await application.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const service of [tlsServer, retryServer]) if (service) await new Promise((resolve) => { service.close(resolve); service.closeAllConnections(); });
  if (windowManager) windowManager.kill('SIGTERM');
  fs.rmSync(temp, { recursive: true, force: true });
});
