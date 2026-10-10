const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-page-find-'));
let application;
const errors = [];
const server = http.createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end('<!doctype html><title>Find fixture</title><p>needle one</p><p>needle two</p><p>needle three</p>');
});

async function gatewayPort() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const port = 18000 + Math.floor(Math.random() * 10000);
    const probe = net.createServer();
    try {
      await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
      await new Promise(resolve => probe.close(resolve));
      return port;
    } catch {}
  }
  throw new Error('Could not allocate gateway port');
}

async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  application = await electron.launch({
    args: [path.join(root, 'tests/fixtures/desktop-electron.cjs'), '--no-sandbox'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '',
      ACESWARM_UI_TEST_PROFILE: path.join(temp, 'profile'), ACESWARM_WS_ROOT: path.join(temp, 'workspace'),
      ACESWARM_GATEWAY_PORT: String(await gatewayPort()), ACESWARM_STORE_GATEWAY_PORT: String(await gatewayPort()),
      ACESWARM_CDP_PORT: '0', ACESWARM_PYTHON: path.join(root, '.venv/bin/python'),
      ACESWARM_CADDY: path.join(root, 'resources/app-gateway/caddy'),
    }, timeout: 90000,
  });
  const page = await application.firstWindow({ timeout: 90000 });
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof isRestoringShellState !== 'undefined' && !isRestoringShellState);
  await page.evaluate(async url => { await window.aivudaShell.authorizeUrl(url); createTab(url); }, `http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => getActiveTab()?.ready);
  const first = await page.evaluate(() => activeTabId);
  await page.locator(`.panel-controls[data-panel-id="${first}"] .panel-menu`).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.locator('#window-find').click();
  const bar = page.locator(`#${first} .page-find`);
  const input = bar.locator('input');
  const count = bar.locator('.page-find-count');
  assert.equal(await input.evaluate(node => node === document.activeElement), true);
  await input.fill('needle');
  await page.waitForFunction(id => tabs.get(id).find.count.textContent === '1 / 3', first);
  await bar.locator('.page-find-next').click();
  await page.waitForFunction(id => tabs.get(id).find.count.textContent === '2 / 3', first);
  await input.press('Shift+Enter');
  await page.waitForFunction(id => tabs.get(id).find.count.textContent === '1 / 3', first);
  await bar.locator('.page-find-previous').click();
  await page.waitForFunction(id => tabs.get(id).find.count.textContent === '3 / 3', first);
  await input.press('Enter');
  await page.waitForFunction(id => tabs.get(id).find.count.textContent === '1 / 3', first);
  await input.fill('absent');
  await page.waitForFunction(id => tabs.get(id).find.count.textContent === 'No matches', first);
  assert.equal(await bar.locator('.page-find-next').isDisabled(), true);
  await input.fill('');
  assert.equal(await count.textContent(), '');
  await input.fill('needle');
  await page.waitForFunction(id => tabs.get(id).find.count.textContent === '1 / 3', first);
  const beforeReload = await page.evaluate(() => { const id = getActiveTab().find.requestId; reloadActiveTab(); return id; });
  await page.waitForFunction(({ id, before }) => {
    const find = tabs.get(id).find;
    return find.requestId > before && find.count.textContent === '1 / 3';
  }, { id: first, before: beforeReload });
  await page.evaluate(() => createTab(getActiveTab().url, { windowId: activeWindowId }));
  await page.waitForFunction(() => getActiveTab()?.ready);
  const second = await page.evaluate(() => activeTabId);
  assert.equal(await bar.isVisible(), false);
  const guestId = await page.evaluate(() => getActiveTab().webview.getWebContentsId());
  await application.evaluate(({ webContents }, id) => {
    const guest = webContents.fromId(id);
    guest.sendInputEvent({ type: 'keyDown', keyCode: 'F', modifiers: ['control'] });
    guest.sendInputEvent({ type: 'keyUp', keyCode: 'F', modifiers: ['control'] });
  }, guestId);
  const secondInput = page.locator(`#${second} .page-find input`);
  await secondInput.waitFor({ state: 'visible' });
  assert.equal(await secondInput.inputValue(), '');
  await secondInput.press('Escape');
  assert.equal(await page.locator(`#${second} .page-find`).isVisible(), false);
  await page.evaluate(id => activateTab(id), first);
  assert.equal(await input.inputValue(), 'needle');
  await page.evaluate(async () => applyShellAppearance(await window.aivudaShell.setAppearance({ theme: 'dark', language: 'zh-CN' })));
  await input.fill('absent');
  await page.waitForFunction(id => tabs.get(id).find.count.textContent === '没有匹配结果', first);
  assert.equal(await input.getAttribute('aria-label'), '页面搜索');
  const screenshots = path.join(root, '.smoke', 'desktop');
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, 'page-find.png') });
  await bar.locator('.page-find-close').click();
  assert.equal(await bar.isVisible(), false);
  await page.evaluate(id => closeTab(id), first);
  assert.equal(await page.locator(`#${first}`).count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: menu search, match counts, next/previous/wrap, no matches, clear, reload, tab isolation, guest Ctrl+F, Escape, Chinese/dark theme and close');
}

run().catch(async error => {
  console.error(error, errors);
  const page = application?.windows()[0];
  if (page) console.log(await page.evaluate(async () => {
    const tab = getActiveTab();
    return { ready: tab.ready, hidden: tab.find?.bar.hidden, query: tab.find?.input.value, requestId: String(tab.find?.requestId), count: tab.find?.count.textContent, content: await tab.webview.executeJavaScript('document.body.innerText') };
  }).catch(() => null));
  process.exitCode = 1;
}).finally(async () => {
  if (application) await application.close().catch(() => {});
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  fs.rmSync(temp, { recursive: true, force: true });
});
