const { desktopWindow } = require('./desktop-window');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-page-cache-'));
let application;
const errors = [];
let startupLog = '';
const startupError = path.join(temp, 'startup-error.txt');
const server = http.createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><title>Cache fixture</title>
    <button id="counter" onclick="this.textContent = Number(this.textContent) + 1" style="width:200px;height:80px">0</button>
    <input id="input">`);
});

async function gatewayPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  application = await electron.launch({
    args: [path.join(root, 'tests/fixtures/desktop-electron.cjs'), '--no-sandbox'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '',
      ACESWARM_UI_TEST_STARTUP_ERROR: startupError, ACESWARM_UI_TEST_FAIL_ON_ERROR: '1',
      ACESWARM_UI_TEST_PROFILE: path.join(temp, 'profile'), ACESWARM_WS_ROOT: path.join(temp, 'workspace'),
      ACESWARM_GATEWAY_PORT: String(await gatewayPort()), ACESWARM_STORE_GATEWAY_PORT: String(await gatewayPort()),
      ACESWARM_MCP_PORT: String(await gatewayPort()), ACESWARM_AIVUDAOS_MCP_PORT: String(await gatewayPort()),
      AIVUDAAPPSTORE_MCP_PORT: String(await gatewayPort()),
      ACESWARM_CDP_PORT: '0', ACESWARM_PYTHON: path.join(root, '.venv/bin/python'),
      ACESWARM_CADDY: path.join(root, 'resources/app-gateway/caddy'),
    }, timeout: 90000,
  });
  application.process().stderr.on('data', chunk => { startupLog += chunk; });
  application.process().stdout.on('data', chunk => { startupLog += chunk; });
  const page = await desktopWindow(application);
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof isRestoringShellState !== 'undefined' && !isRestoringShellState);
  await page.evaluate(async url => { await window.aivudaShell.authorizeUrl(url); createTab(url); }, `http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => getActiveTab()?.ready);
  const first = await page.evaluate(() => activeTabId);
  const content = script => page.evaluate(({ id, script }) => tabs.get(id).webview.executeJavaScript(script), { id: first, script });
  await content(`(async () => {
    localStorage.setItem('keep', 'yes');
    document.cookie = 'login=keep; SameSite=Lax';
    await (await caches.open('page-cache')).put('/cached', new Response('cached'));
  })()`);
  // Exercise actual Shell hit testing, not a synthetic click inside the guest.
  async function clickCounter() {
    const rect = await page.locator(`#${first} webview`).boundingBox();
    assert.equal(await page.evaluate(() => stackEl.classList.contains('interacting')), false,
      'header interactions must release the pointer-blocking state');
    await page.mouse.click(rect.x + 80, rect.y + 40);
    await page.waitForFunction(async id => await tabs.get(id).webview.executeJavaScript('document.getElementById("counter").textContent') === '1', first);
  }
  await clickCounter();
  for (let attempt = 0; attempt < 2; attempt++) {
    console.log('Opening clear-cache menu, attempt', attempt + 1);
    const before = await content('performance.timeOrigin');
    await page.locator(`.panel-controls[data-panel-id="${first}"] .panel-menu`).click();
    await page.locator('#window-clear-cache').click();
    await page.waitForFunction(async ({ id, before }) => await tabs.get(id).webview.executeJavaScript('performance.timeOrigin') !== before, { id: first, before });
    await page.waitForFunction(async id => await tabs.get(id).webview.executeJavaScript('!!document.getElementById("counter")'), first);
    await clickCounter();
    assert.deepEqual(await content('caches.keys()'), []);
    assert.equal(await content('localStorage.getItem("keep")'), 'yes');
    assert.match(await content('document.cookie'), /login=keep/);
    const input = await content('JSON.stringify(document.getElementById("input").getBoundingClientRect().toJSON())');
    const rect = await page.locator(`#${first} webview`).boundingBox();
    const inputRect = JSON.parse(input);
    await page.mouse.click(rect.x + inputRect.x + 10, rect.y + inputRect.y + 10);
    assert.equal(await content('document.activeElement.id'), 'input');
    // Shell CDP keyboard events do not route to the separate guest renderer.
    const guestId = await page.evaluate(id => tabs.get(id).webview.getWebContentsId(), first);
    await application.evaluate(({ webContents }, id) => {
      const guest = webContents.fromId(id);
      for (const keyCode of 'still responsive') guest.sendInputEvent({ type: 'char', keyCode });
    }, guestId);
    assert.equal(await content('document.getElementById("input").value'), 'still responsive');
    await page.locator('#tools-button').click();
    assert.equal(await page.locator('#tools-menu').isVisible(), true);
    await page.locator('#tools-button').click();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: repeated cache clears preserve login/storage, release pointer blocking, and leave guest clicks/typing and desktop menus responsive.');
}

run().catch(async error => {
  console.error(error, errors, startupLog);
  if (fs.existsSync(startupError)) console.error(fs.readFileSync(startupError, 'utf8'));
  const page = application?.windows()[0];
  if (page) console.log(await page.evaluate(() => ({ interacting: stackEl.className, active: activeTabId,
    menu: document.getElementById('window-menu').hidden, status: document.getElementById('status-text').textContent,
    dialogs: [...document.querySelectorAll('dialog[open]')].map(node => node.id) })).catch(() => null));
  process.exitCode = 1;
}).finally(async () => {
  if (application) await application.close().catch(() => {});
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  fs.rmSync(temp, { recursive: true, force: true });
});
