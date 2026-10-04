const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { execFileSync, spawn } = require('node:child_process');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-desktop-ui-'));
const screenshots = path.join(root, '.smoke', 'desktop');
fs.mkdirSync(screenshots, { recursive: true });
let application;
let server;
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

async function launch() {
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
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 820));
  page.on('pageerror', (error) => { errors.push(error.message); console.error('Renderer error:', error); });
  await page.waitForFunction(() => typeof isRestoringShellState !== 'undefined' && !isRestoringShellState && document.querySelector('#dock .dock-item[data-app-url]'), { timeout: 30000 });
  return page;
}

async function count(page, expected) {
  await page.waitForFunction((value) => tabs.size === value, expected);
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

async function checkRecording(page, mode) {
  if (mode === 'native') await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => { throw new Error('Desktop capture must not be used for Native recording'); };
  });
  await page.evaluate(() => { screenRecordDetailsExpanded = true; renderScreenRecordBar(); });
  await page.locator('[data-screen-record-mode="' + mode + '"]').click();
  await page.locator('[data-start-screen-record]').click();
  await page.waitForFunction(() => screenRecordStatus === 'recording' || screenRecordStatus === 'error', { timeout: 15000 });
  assert.equal(await page.evaluate(() => screenRecordStatus), 'recording', await page.evaluate(() => screenRecordStatusText));
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
  await count(page, 1);
  await page.waitForFunction(() => getActiveTab().webview.getURL().startsWith('http:'));
  console.log('PASS: real Electron desktop and local Home page start');
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
  assert.equal(await page.evaluate(() => getActiveTab().webview.executeJavaScript('document.getElementById("live").textContent')), 'Connected');
  await page.locator('#' + robotId + ' .wb-pin').click();
  await page.waitForFunction((url) => favorites.some((entry) => entry.url === url), robotUrl);
  assert.equal(await page.locator('#desktop-shortcuts .desktop-shortcut').count(), 3);
  console.log('PASS: custom page loads, receives title, and pins to Dock and desktop');

  await page.evaluate(() => getActiveTab().webview.executeJavaScript('window.testInstance = "preserved"'));
  await page.locator('#' + robotId + ' .wb-min').click();
  await page.waitForFunction((id) => tabs.get(id).minimized, robotId);
  assert.equal(await page.locator('#' + robotId).isVisible(), false);
  assert.equal(await page.evaluate((id) => tabs.get(id).webview.getURL(), robotId), robotUrl);
  await page.locator('#dock button[data-app-url="' + robotUrl + '"]').click();
  await page.waitForFunction((id) => activeTabId === id && !tabs.get(id).minimized, robotId);
  await count(page, 2);
  assert.equal(await page.evaluate(() => getActiveTab().webview.executeJavaScript('window.testInstance')), 'preserved');
  console.log('PASS: minimize keeps WebView alive; Dock restores without duplicate windows');

  await page.locator('#' + robotId + ' .wb-browser').click();
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
  await page.locator('#' + robotId + ' .wb-menu').click();
  assert.equal(await page.locator('#window-menu').isVisible(), true);
  await page.locator('#' + robotId + ' .wb-menu').click();
  assert.equal(await page.locator('#window-menu').isVisible(), false);
  await page.locator('#' + robotId + ' .wb-menu').click();
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
  await page.locator('#' + robotId + ' .wb-max').click();
  assert.equal(await page.evaluate((id) => tabs.get(id).window.max, robotId), true);
  assert.deepEqual(await page.locator('#' + robotId).boundingBox(), await page.evaluate(() => ({ x: 0, y: 48, width: innerWidth, height: innerHeight - 48 })));
  await page.locator('#tools-button').click();
  await page.screenshot({ path: path.join(screenshots, 'desktop-system-menu.png') });
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(screenshots, 'desktop-maximized-top-dock.png') });
  await page.locator('#toggle-dock').click();
  assert.equal(await page.evaluate(() => dockCollapsed), true);
  const maximized = await page.locator('#' + robotId).boundingBox();
  assert.equal(maximized.x, 0); assert.equal(maximized.width, 1280);
  assert.equal(maximized.y, 28); assert.equal(maximized.height, 792);
  await page.locator('#tools-button').click();
  assert.equal(await page.locator('#tools-menu').isVisible(), true);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: path.join(screenshots, 'desktop-maximized-collapsed-dock.png') });
  await page.locator('#toggle-dock').click();
  await page.locator('#' + robotId + ' .wb-max').click();
  assert.equal(await page.evaluate((id) => tabs.get(id).window.max, robotId), false);

  const header = page.locator('#' + robotId + ' .wb-title');
  const box = await header.boundingBox();
  const initial = await page.evaluate((id) => ({ x: tabs.get(id).window.x, y: tabs.get(id).window.y }), robotId);
  await page.mouse.move(box.x + 80, box.y + 15);
  await page.mouse.down();
  await page.mouse.move(box.x + 130, box.y + 35, { steps: 8 });
  await page.mouse.up();
  const moved = await page.evaluate((id) => ({ x: tabs.get(id).window.x, y: tabs.get(id).window.y }), robotId);
  assert.ok(moved.x !== initial.x || moved.y !== initial.y);
  const resize = await page.locator('#' + robotId + ' .wb-se').boundingBox();
  const originalWidth = await page.evaluate((id) => tabs.get(id).window.width, robotId);
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2);
  await page.mouse.down();
  await page.mouse.move(resize.x - 80, resize.y - 60, { steps: 8 });
  await page.mouse.up();
  assert.ok(await page.evaluate((id) => tabs.get(id).window.width, robotId) < originalWidth);
  await page.evaluate((id) => tabs.get(id).window.resize(640, 400), robotId);
  assert.equal(await page.evaluate((id) => tabs.get(id).window.width, robotId), 640);
  await page.locator('#tab-1 webview').click({ position: { x: 900, y: 300 } });
  await page.waitForFunction(() => activeTabId === 'tab-1');
  await page.locator('#dock button[data-app-url="' + robotUrl + '"]').click();
  await page.waitForFunction((id) => activeTabId === id, robotId);
  console.log('PASS: top panel, System menu, per-window zoom/address controls, maximize, restore, drag and resize');

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
  await page.evaluate(() => closeTab(activeTabId));
  await count(page, 4);
  console.log('PASS: multiple windows share one application Dock icon');

  await page.locator('#tools-button').click();
  await page.locator('#tools-record').click();
  assert.equal(await page.evaluate(() => screenRecordBarVisible), true);
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
  await page.waitForFunction(() => [...tabs.values()].every((tab) => tab.window.window.getBoundingClientRect().right <= innerWidth));
  await page.screenshot({ path: path.join(screenshots, 'desktop-390.png') });
  await page.locator('#tools-button').click();
  const systemMenu = await page.locator('#tools-menu').boundingBox();
  assert.ok(systemMenu.x >= 0 && systemMenu.x + systemMenu.width <= 390);
  assert.ok(systemMenu.y + systemMenu.height <= 844);
  await page.screenshot({ path: path.join(screenshots, 'desktop-system-390.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1280, 820); });
  await page.waitForFunction(() => innerWidth === 1280);
  await page.evaluate((id) => { tabs.get(id).window.resize(640, 400).move(180, 90); }, robotId);
  await page.evaluate(() => tabs.get('tab-1').window.maximize());
  await page.locator('#' + robotId + ' .wb-min').click();
  await page.locator('#toggle-dock').click();
  await page.evaluate(() => writeShellState());
  await application.close();
  application = null;
  const saved = JSON.parse(fs.readFileSync(path.join(temp, 'profile', 'shell-state.json')));
  assert.equal(saved.version, 2);
  assert.ok(saved.favorites.some((entry) => entry.url === robotUrl));
  assert.deepEqual(saved.tabs.find((tab) => tab.id === robotId).bounds, { x: 180, y: 90, width: 640, height: 400 });
  assert.equal(saved.tabs.find((tab) => tab.id === robotId).minimized, true);

  page = await launch();
  await count(page, 2);
  assert.equal(await page.evaluate((id) => tabs.get(id).minimized, robotId), true);
  assert.equal(await page.evaluate(() => favorites.length), 1);
  assert.equal(await page.evaluate(() => screenRecordMode), 'ffmpeg-x11');
  assert.equal(await page.evaluate(() => dockCollapsed), true);
  await page.locator('#toggle-dock').click();
  assert.equal(await page.evaluate(() => tabs.get('tab-1').window.max), true);
  assert.notEqual(await page.evaluate(() => defaultUrl), saved.serviceOrigins.os);
  assert.equal(await page.evaluate(() => new URL(tabs.get('tab-1').url).origin), await page.evaluate(() => new URL(defaultUrl).origin));
  assert.equal(await page.evaluate(() => tabs.get('tab-1').appUrl), await page.evaluate(() => defaultUrl));
  await page.locator('#dock button[data-app-url="' + robotUrl + '"]').click();
  assert.deepEqual(await page.evaluate((id) => ({ x: tabs.get(id).window.x, y: tabs.get(id).window.y, width: tabs.get(id).window.width, height: tabs.get(id).window.height }), robotId), { x: 180, y: 90, width: 640, height: 400 });
  console.log('PASS: restart restores pinned application, minimized state, geometry and remaps service ports');
  await page.locator('#' + robotId + ' .wb-close').click();
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
  assert.equal(await page.evaluate(() => [...tabs.values()].every((tab) => tab.minimized)), true);
  await page.screenshot({ path: path.join(screenshots, 'desktop-empty.png') });
  console.log('PASS: close keeps pinned icon, unpin removes it, last close reaches desktop, shortcuts and show-desktop work');
  await application.close();
  application = null;
  fs.writeFileSync(path.join(temp, 'profile', 'shell-state.json'), JSON.stringify({
    tabs: [{ id: 'tab-9', url: robotUrl }], activeTabId: 'tab-9',
    favorites: [{ url: robotUrl, title: 'Legacy robot' }], chromeExpanded: true,
  }));
  page = await launch();
  await count(page, 1);
  assert.equal(await page.evaluate(() => favorites[0].title), 'Legacy robot');
  assert.equal(await page.evaluate(() => getActiveTab().appUrl), robotUrl);
  assert.equal(await page.locator('#browser-toolbar').isVisible(), true);
  console.log('PASS: legacy tabs and bookmarks migrate into desktop windows and Dock');
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
  if (windowManager) windowManager.kill('SIGTERM');
  fs.rmSync(temp, { recursive: true, force: true });
});
