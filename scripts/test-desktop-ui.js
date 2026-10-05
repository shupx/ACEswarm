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
  await page.waitForFunction(() => typeof isRestoringShellState !== 'undefined' && !isRestoringShellState, { timeout: 30000 });
  return page;
}

async function count(page, expected) {
  await page.waitForFunction((value) => tabs.size === value, expected);
}

async function applicationButton(page, url) {
  if (!await page.locator('#applications-menu').isVisible()) await page.locator('#applications-button').click();
  return page.locator('#applications-menu button[data-app-url="' + url + '"]').last();
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
  return page.locator('.panel-controls[data-panel-id="' + id + '"] .panel-menu');
}

async function windowCommand(page, id, command) {
  await windowControl(page, id).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('#window-' + command).click();
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

async function dragPanel(page, id, destination, checkPreview = false) {
  const handle = await page.locator('[data-tab-panel-id="' + id + '"]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 25 });
  if (checkPreview) {
    assert.equal(await page.locator('#tab-transfer-preview').isVisible(), true, 'content drop preview is visible above guest pages');
    await page.screenshot({ path: path.join(screenshots, 'window-dock-preview.png') });
  }
  await page.mouse.up();
}

async function run() {
  server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>' + (request.url.includes('child') ? 'Child' : 'Robot Console') + '</title><body style="font-family:system-ui;padding:24px;background:#fff"><h1>Robot Console</h1><p>Connected</p><a id="popup" href="/child" target="_blank">Open child</a><script>window.tick=0;setInterval(()=>window.tick++,100)</script></body>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const robotUrl = 'http://127.0.0.1:' + server.address().port + '/robot';
  let page = await launch();
  assert.equal(await page.evaluate(() => appWindows.size), 0);
  assert.equal(await page.locator('#add-desktop').count(), 0);
  assert.deepEqual(await page.locator('#desktop-shortcuts .shortcut-label').allTextContents(), ['Console', 'AppStore Admin']);
  const background = await page.screenshot({ clip: { x: 1270, y: 775, width: 10, height: 10 } });
  await (await applicationButton(page, await page.evaluate(() => defaultUrl))).click();
  await page.waitForFunction(() => getActiveTab()?.ready && getActiveTab().title === 'Console');
  const consoleId = await page.evaluate(() => activeTabId);
  const firstWindow = await page.evaluate(() => activeWindowId);
  assert.equal(await page.evaluate(() => appWindows.size), 1);
  assert.deepEqual(await page.screenshot({ clip: { x: 1270, y: 775, width: 10, height: 10 } }), background);
  assert.equal(await page.evaluate(() => getActiveTab().webview.executeJavaScript('localStorage.getItem("aivuda_ui_appstore_base_url")')), await page.evaluate(() => new URL(storeUrl).origin));
  console.log('PASS: one fixed desktop; Applications opens a floating outer window and injects the local store URL');
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
  assert.equal(await page.evaluate(() => activeWindowId), firstWindow, 'New page adds a tab to the current window');
  assert.equal(await page.evaluate(() => appWindows.size), 1);
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

  await page.evaluate(url => openApplication(url), robotUrl);
  await page.waitForFunction(() => getActiveTab()?.ready && getActiveTab().title === 'Robot Console');
  const robotId = await page.evaluate(() => activeTabId);
  const secondWindow = await page.evaluate(() => activeWindowId);
  assert.equal(await page.evaluate(() => appWindows.size), 2);
  assert.notEqual(firstWindow, secondWindow);
  assert.equal(await page.locator('#dock .window-task').count(), 2);
  await page.evaluate(({ first, second }) => { setOuterWindowRegion(appWindows.get(first), 'left'); setOuterWindowRegion(appWindows.get(second), 'right'); }, { first: firstWindow, second: secondWindow });
  await waitForGuestLayout(page);
  await page.evaluate(id => tabs.get(id).webview.executeJavaScript('window.transferIdentity = "preserved"'), robotId);
  const robotGuest = await page.evaluate(id => tabs.get(id).webview.getWebContentsId(), robotId);
  await page.locator('.app-window[data-window-id="' + secondWindow + '"] button[aria-label="Open tab"]').click();
  await page.locator('#open-page-url').fill(robotUrl + '/child');
  await page.locator('#open-page-form button[type="submit"]').click();
  await page.waitForFunction(() => getActiveTab()?.ready && getActiveTab().title === 'Child');
  const childId = await page.evaluate(() => activeTabId);
  assert.equal(await page.evaluate(() => appWindows.size), 2);
  assert.equal(await page.evaluate(id => appWindows.get(id).layout.panels.length, secondWindow), 2);
  const secondRoot = await page.locator('.app-window[data-window-id="' + secondWindow + '"] .dock-layout').boundingBox();
  await dragPanel(page, childId, { x: secondRoot.x + secondRoot.width - 40, y: secondRoot.y + secondRoot.height / 2 }, true);
  await page.waitForFunction(id => appWindows.get(id).layout.groups.length === 2, secondWindow);
  await waitForGuestLayout(page);
  const beforeSplitWidth = await page.evaluate(id => tabs.get(id).panel.group.element.getBoundingClientRect().width, childId);
  const sash = await page.locator('.dock-sash-handle[data-window-id="' + secondWindow + '"]').first().boundingBox();
  await page.mouse.move(sash.x + sash.width / 2, sash.y + sash.height / 2);
  await page.mouse.down(); await page.mouse.move(sash.x - 70, sash.y + sash.height / 2, { steps: 12 }); await page.mouse.up();
  await waitForGuestLayout(page);
  assert.ok(Math.abs(await page.evaluate(id => tabs.get(id).panel.group.element.getBoundingClientRect().width, childId) - beforeSplitWidth) > 40, 'dragging the divider over page content resizes the split');
  const otherGroup = await page.evaluate(id => {
    const tab = tabs.get(id);
    const group = appWindows.get(tab.windowId).layout.groups.find(item => item.id !== tab.panel.group.id);
    return { id: group.id, rect: group.element.getBoundingClientRect().toJSON() };
  }, childId);
  await dragPanel(page, childId, { x: otherGroup.rect.x + 40, y: otherGroup.rect.y + otherGroup.rect.height / 2 });
  await page.waitForFunction(({ id, targetGroup }) => {
    const tab = tabs.get(id);
    const target = appWindows.get(tab.windowId).layout.getGroup(targetGroup);
    return tab.panel.group.element.getBoundingClientRect().right <= target.element.getBoundingClientRect().left + 1;
  }, { id: childId, targetGroup: otherGroup.id });
  await page.evaluate(({ child, robot }) => {
    const tab = tabs.get(child); detachApplicationPanel(tab);
    tab.placement = { reference: robot, direction: 'below' }; addApplicationPanel(tab);
  }, { child: childId, robot: robotId });
  await waitForGuestLayout(page);
  const beforeSplitHeight = await page.evaluate(id => tabs.get(id).panel.group.element.getBoundingClientRect().height, childId);
  const horizontalSash = await page.locator('.dock-sash-handle[data-window-id="' + secondWindow + '"]:not(.vertical)').boundingBox();
  await page.mouse.move(horizontalSash.x + horizontalSash.width / 2, horizontalSash.y + horizontalSash.height / 2);
  await page.mouse.down(); await page.mouse.move(horizontalSash.x + horizontalSash.width / 2, horizontalSash.y - 60, { steps: 12 }); await page.mouse.up();
  await waitForGuestLayout(page);
  assert.ok(Math.abs(await page.evaluate(id => tabs.get(id).panel.group.element.getBoundingClientRect().height, childId) - beforeSplitHeight) > 40, 'the horizontal divider resizes across the full page width');
  await page.evaluate(({ child, robot }) => tabs.get(child).panel.api.moveTo({ group: tabs.get(robot).panel.group, position: 'left' }), { child: childId, robot: robotId });
  await waitForGuestLayout(page);
  assert.equal(await page.evaluate(id => appWindows.get(id).layout.groups.length, firstWindow), 1);
  console.log('PASS: independent outer windows; tabs, drag splitting and splitter resizing stay inside their window');

  await waitForGuestLayout(page);
  const firstTask = await page.locator('#dock [data-window-id="' + firstWindow + '"]').evaluate(element => element.getBoundingClientRect().toJSON());
  const childGuest = await page.evaluate(id => tabs.get(id).webview.getWebContentsId(), childId);
  await dragPanel(page, childId, { x: firstTask.x + firstTask.width / 2, y: firstTask.y + firstTask.height / 2 });
  await page.waitForFunction(({ id, windowId }) => tabs.get(id).windowId === windowId, { id: childId, windowId: firstWindow });
  assert.equal(await page.evaluate(id => tabs.get(id).webview.getWebContentsId(), childId), childGuest);
  const firstRoot = await page.locator('.app-window[data-window-id="' + firstWindow + '"] .dock-layout').boundingBox();
  await dragPanel(page, robotId, { x: firstRoot.x + firstRoot.width - 4, y: firstRoot.y + firstRoot.height / 2 });
  await page.waitForFunction(({ id, windowId }) => tabs.get(id).windowId === windowId, { id: robotId, windowId: firstWindow });
  assert.equal(await page.evaluate(() => appWindows.size), 1);
  assert.ok(await page.evaluate(id => appWindows.get(id).layout.groups.length >= 2, firstWindow));
  assert.equal(await page.evaluate(id => tabs.get(id).webview.getWebContentsId(), robotId), robotGuest);
  assert.equal(await page.evaluate(id => tabs.get(id).webview.executeJavaScript('window.transferIdentity'), robotId), 'preserved');
  console.log('PASS: taskbar and content-edge transfers preserve guests, split the destination, and remove empty source windows');

  await dragPanel(page, childId, { x: 1100, y: 700 });
  await page.waitForFunction(() => appWindows.size === 2);
  const detachedWindow = await page.evaluate(id => tabs.get(id).windowId, childId);
  assert.notEqual(detachedWindow, firstWindow);
  assert.equal(await page.evaluate(id => tabs.get(id).webview.getWebContentsId(), childId), childGuest);
  await page.evaluate(({ first, detached }) => {
    const a = appWindows.get(first), b = appWindows.get(detached);
    a.maximized = b.maximized = false; a.region = b.region = null;
    a.bounds = { x: 15, y: 75, width: 550, height: 600 };
    b.bounds = { x: 620, y: 75, width: 550, height: 600 };
    layoutApplicationWindows();
  }, { first: firstWindow, detached: detachedWindow });
  await waitForGuestLayout(page);
  const floatingTarget = await page.locator('.app-window[data-window-id="' + firstWindow + '"] .dock-layout').boundingBox();
  await dragPanel(page, childId, { x: floatingTarget.x + 90, y: floatingTarget.y + 12 });
  await page.waitForFunction(({ tabId, windowId }) => tabs.get(tabId).windowId === windowId, { tabId: childId, windowId: firstWindow });
  assert.equal(await page.evaluate(() => appWindows.size), 1);
  console.log('PASS: tab tear-off creates a floating outer window; floating windows exchange tabs without reload');

  await (await applicationButton(page, await page.evaluate(() => defaultUrl))).click();
  assert.equal(await page.evaluate(() => appWindows.size), 2, 'Launching an existing application creates a new window');
  const duplicateWindow = await page.evaluate(() => activeWindowId);
  assert.equal(await page.locator('.window-drag-handle').count(), 0);
  const duplicateBounds = await page.evaluate(id => ({ ...appWindows.get(id).bounds }), duplicateWindow);
  const blankHeader = await page.locator('.app-window[data-window-id="' + duplicateWindow + '"] .dv-void-container').boundingBox();
  assert.ok(blankHeader.width >= 20, 'a single-tab header has draggable empty space');
  await page.mouse.move(blankHeader.x + blankHeader.width / 2, blankHeader.y + blankHeader.height / 2); await page.mouse.down();
  await page.mouse.move(blankHeader.x + blankHeader.width / 2 + 80, blankHeader.y + blankHeader.height / 2 + 45, { steps: 12 }); await page.mouse.up();
  assert.ok(await page.evaluate(({ id, x }) => appWindows.get(id).bounds.x > x, { id: duplicateWindow, x: duplicateBounds.x }));
  await page.locator('.app-window[data-window-id="' + duplicateWindow + '"] button[aria-label="Close window"]').click();
  await page.evaluate(id => activateTab(id), robotId);
  assert.equal(await page.locator('.app-window[data-window-id="' + firstWindow + '"] button[aria-label="Close window"]').count(), 1);
  const header = await page.locator('.app-window[data-window-id="' + firstWindow + '"] .dv-tabs-and-actions-container').first().boundingBox();
  const windowFrame = await page.locator('.app-window[data-window-id="' + firstWindow + '"]').boundingBox();
  assert.ok(header.y - windowFrame.y <= 2, 'Dockview tabs share the outer window top row');
  const normalBounds = await page.evaluate(id => ({ ...appWindows.get(id).bounds }), firstWindow);
  await page.locator('.app-window[data-window-id="' + firstWindow + '"] button[aria-label="Maximize or restore window"]').click();
  const maxBounds = await page.locator('.app-window[data-window-id="' + firstWindow + '"]').boundingBox();
  assert.equal(maxBounds.x, 0); assert.equal(maxBounds.y, 0); assert.equal(maxBounds.width, 1280); assert.equal(maxBounds.height, 792);
  assert.equal(await page.locator('#toggle-dock').count(), 0);
  for (const id of ['show-desktop', 'new-tab']) assert.equal(await page.locator('#' + id).isVisible(), true);
  const bar = await page.locator('.desktop-bar').boundingBox();
  assert.equal(bar.y, 792); assert.equal(bar.height, 28);
  await page.locator('#new-tab').click();
  assert.equal(await page.locator('#open-page-dialog').isVisible(), true);
  await page.locator('#close-page-dialog').click();
  await page.locator('.app-window[data-window-id="' + firstWindow + '"] button[aria-label="Maximize or restore window"]').click();
  assert.deepEqual(await page.evaluate(id => appWindows.get(id).bounds, firstWindow), normalBounds);
  const handle = await page.locator('.outer-resize-handle[data-window-id="' + firstWindow + '"][data-edge="se"]').boundingBox();
  const widthBefore = await page.evaluate(id => appWindows.get(id).bounds.width, firstWindow);
  await page.mouse.move(handle.x + 3, handle.y + 3); await page.mouse.down();
  await page.mouse.move(handle.x + 83, handle.y + 23, { steps: 12 }); await page.mouse.up();
  assert.ok(await page.evaluate(({ id, width }) => appWindows.get(id).bounds.width > width, { id: firstWindow, width: widthBefore }));
  await waitForGuestLayout(page);
  const beforeMinimize = await page.evaluate(id => appWindows.get(id).layout.toJSON(), firstWindow);
  await page.locator('.app-window[data-window-id="' + firstWindow + '"] button[aria-label="Minimize window"]').click();
  assert.equal(await page.locator('.app-window[data-window-id="' + firstWindow + '"]').isVisible(), false);
  assert.deepEqual(await page.evaluate(id => appWindows.get(id).layout.toJSON(), firstWindow), beforeMinimize);
  await page.locator('#dock [data-window-id="' + firstWindow + '"]').click();
  assert.equal(await page.evaluate(id => tabs.get(id).webview.getWebContentsId(), robotId), robotGuest);
  await page.locator('#dock [data-window-id="' + firstWindow + '"]').click();
  assert.equal(await page.evaluate(id => appWindows.get(id).minimized, firstWindow), true);
  assert.equal(await page.locator('.app-window[data-window-id="' + firstWindow + '"]').isVisible(), false);
  await page.locator('#dock [data-window-id="' + firstWindow + '"]').click();
  assert.equal(await page.evaluate(id => appWindows.get(id).minimized, firstWindow), false);
  assert.deepEqual(await page.evaluate(id => appWindows.get(id).layout.toJSON(), firstWindow), beforeMinimize);
  await page.locator('#show-desktop').click();
  assert.equal(await page.locator('.app-window:visible').count(), 0);
  assert.deepEqual(await page.screenshot({ clip: { x: 1270, y: 775, width: 10, height: 10 } }), background);
  await page.locator('#show-desktop').click();
  assert.deepEqual(await page.evaluate(id => appWindows.get(id).layout.toJSON(), firstWindow), beforeMinimize);
  console.log('PASS: outer move, resize, maximize, minimize and show-desktop preserve the fixed background and inner layouts');

  await page.evaluate(id => activateTab(id), robotId);
  await windowCommand(page, robotId, 'pin');
  await page.locator('#applications-button').click();
  const applicationsMenu = await page.locator('#applications-menu').boundingBox();
  assert.ok(applicationsMenu.y + applicationsMenu.height <= 792);
  await page.waitForFunction(() => installedApplications.length > 0);
  assert.equal(await page.locator('#applications-menu > .application-menu-row [data-app-url="' + robotUrl + '"]').count(), 1);
  await page.locator('#all-applications summary').click();
  assert.ok(await page.locator('#all-applications [data-app-url]').count() > 0);
  await page.screenshot({ path: path.join(screenshots, 'window-applications.png') });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(screenshots, 'window-desktop-1280.png') });
  await application.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(0, 0); window.setContentSize(390, 844); });
  await page.waitForFunction(() => innerWidth === 390);
  await page.waitForFunction(() => [...appWindows.values()].every(owner => owner.frame.getBoundingClientRect().right <= innerWidth + 1));
  await waitForGuestLayout(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.evaluate(() => [...appWindows.values()].every(owner => owner.frame.getBoundingClientRect().right <= innerWidth + 1)), true);
  await page.screenshot({ path: path.join(screenshots, 'window-desktop-390.png') });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820));
  await page.waitForFunction(() => innerWidth === 1280);
  await page.evaluate(url => openApplication(url), robotUrl + '/restart');
  const restartWindow = await page.evaluate(() => activeWindowId);
  await page.evaluate(id => minimizeOuterWindow(appWindows.get(id)), restartWindow);
  await page.locator('#show-desktop').click();
  await page.evaluate(() => writeShellState());
  const saved = JSON.parse(fs.readFileSync(path.join(temp, 'profile', 'shell-state.json')));
  assert.equal(saved.version, 4); assert.equal(saved.windows.length, 2);
  await application.close(); application = null;
  page = await launch();
  await page.waitForFunction(() => [...tabs.values()].every(tab => tab.ready));
  assert.equal(await page.evaluate(() => desktopVisible), true);
  assert.equal(await page.evaluate(id => appWindows.get(id).minimized, restartWindow), true);
  assert.deepEqual(await page.evaluate(id => JSON.parse(JSON.stringify(appWindows.get(id).layout.toJSON())), firstWindow), saved.windows.find(item => item.id === firstWindow).layout);
  await page.locator('#dock [data-window-id="' + firstWindow + '"]').click();
  assert.equal(await page.evaluate(() => favorites.length), 1);
  assert.equal(await page.evaluate(() => new URL(tabs.values().next().value.appUrl).origin), await page.evaluate(() => new URL(defaultUrl).origin));
  console.log('PASS: restart restores outer windows, independent layouts, minimized state, favorites and local port remapping');

  await page.evaluate(() => { screenRecordMode = 'native'; showScreenRecordBar(); });
  for (const mode of ['ffmpeg', 'native', 'ffmpeg-x11']) await checkRecording(page, mode);
  await page.evaluate(() => { screenRecordBarVisible = false; renderScreenRecordBar(); });
  const migrationLayout = await page.evaluate(id => appWindows.get(id).layout.toJSON(), firstWindow);
  const migrationTabs = await page.evaluate(id => buildShellStatePayload().tabs.filter(tab => tab.windowId === id).map(tab => ({ ...tab, desktopId: 'desktop-1', windowId: undefined })), firstWindow);
  await application.close(); application = null;
  fs.writeFileSync(path.join(temp, 'profile', 'shell-state.json'), JSON.stringify({
    version: 3, desktops: [{ id: 'desktop-1', layout: migrationLayout, desktopVisible: false }], tabs: migrationTabs,
    favorites: [{ url: robotUrl, title: 'Robot Console' }], activeTabId: robotId,
  }));
  page = await launch();
  await page.waitForFunction(() => [...tabs.values()].every(tab => tab.ready));
  assert.equal(await page.evaluate(() => appWindows.size), 1);
  assert.equal(await page.evaluate(() => desktopLayout.panels.length), migrationTabs.length);
  assert.deepEqual(await page.evaluate(() => Object.keys(desktopLayout.toJSON().panels).sort()), Object.keys(migrationLayout.panels).sort());
  assert.equal(await page.evaluate(() => desktopLayout.groups.length), migrationLayout.grid.root.data.length);
  console.log('PASS: legacy virtual desktop sessions migrate into outer windows without losing split layouts');

  await page.evaluate(() => { screenRecordMode = 'native'; showScreenRecordBar(); });
  await page.locator('[data-start-screen-record]').click();
  await page.waitForFunction(() => screenRecordStatus === 'recording');
  await page.waitForFunction(() => screenRecordElapsedMs > 700);
  const closingFile = await page.evaluate(() => screenRecorderOutputPath);
  const exited = new Promise(resolve => application.process().once('exit', resolve));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await exited; application = null;
  const video = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', closingFile], { encoding: 'utf8' }));
  assert.ok(Number(video.streams[0].nb_read_frames) > 0);
  assert.deepEqual(errors, []);
  console.log('PASS: closing the shell flushes native recording; no renderer errors');
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
