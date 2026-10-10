const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-downloads-'));
const screenshots = path.join(root, '.smoke/downloads');
fs.mkdirSync(screenshots, { recursive: true });
const errors = [];
let application;
let server;
let watchdog;

async function freePort() {
  const probe = net.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return String(port);
}

async function run() {
  server = http.createServer((request, response) => {
    const name = new URL(request.url, 'http://local').pathname.slice(1);
    if (!name.endsWith('.bin')) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<html><body>Download test page</body></html>');
      return;
    }
    const total = 1024 * 1024;
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    if (name !== 'unknown.bin') response.setHeader('Content-Length', total);
    let sent = 0;
    const timer = setInterval(() => {
      response.write(Buffer.alloc(65536, 7));
      sent += 65536;
      if (name === 'failed.bin' && sent >= 131072) response.destroy();
      else if (sent === total) response.end();
    }, 100);
    response.once('close', () => clearInterval(timer));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const state = path.join(temp, 'workspace/state');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(state, 'seed-bootstrap.json'), JSON.stringify({ schemaVersion: 1, status: 'completed' }));
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '',
    ACESWARM_UI_TEST_PROFILE: path.join(temp, 'profile'), ACESWARM_UI_TEST_FAIL_ON_ERROR: '1', ACESWARM_WS_ROOT: path.join(temp, 'workspace'),
    ACESWARM_PYTHON: path.join(root, '.venv/bin/python'), ACESWARM_CADDY: path.join(root, 'resources/app-gateway/caddy'),
    ACESWARM_CDP_PORT: '0' };
  for (const key of ['ACESWARM_GATEWAY_PORT', 'ACESWARM_STORE_GATEWAY_PORT', 'ACESWARM_MCP_PORT', 'ACESWARM_AIVUDAOS_MCP_PORT', 'AIVUDAAPPSTORE_MCP_PORT']) env[key] = await freePort();
  application = await electron.launch({ args: [path.join(root, 'tests/fixtures/desktop-electron.cjs'), '--no-sandbox', '--disable-gpu'], env, timeout: 90000 });
  watchdog = setTimeout(() => {
    console.error('Download integration test exceeded 90 seconds.');
    process.exitCode = 1;
    application.process().kill('SIGKILL');
  }, 90000);
  console.log('Electron launched for download checks.');
  const page = await application.firstWindow({ timeout: 90000 });
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => typeof isRestoringShellState !== 'undefined' && !isRestoringShellState);
  console.log('Desktop initialized.');
  await application.evaluate(({ session, shell }, directory) => {
    for (const target of [session.defaultSession, session.fromPartition('persist:aivuda-shell')]) {
      target.prependListener('will-download', (_event, item) => item.setSavePath(`${directory}/${item.getFilename()}`));
    }
    global.testOpenedPaths = [];
    shell.openPath = async target => { global.testOpenedPaths.push(['open', target]); return ''; };
    shell.showItemInFolder = target => global.testOpenedPaths.push(['show', target]);
  }, temp);
  console.log('Download save paths and file actions prepared.');
  await page.evaluate(async url => {
    await window.aivudaShell.setAppearance({ theme: 'light', language: 'en-US' });
    await window.aivudaShell.authorizeUrl(url);
    openApplication(url);
  }, base);
  await page.waitForFunction(() => getActiveTab()?.ready);
  console.log('Guest ready for download checks.');
  const firstTab = await page.evaluate(() => activeTabId);
  const firstWindow = await page.evaluate(() => activeWindowId);
  const downloads = () => page.evaluate(() => window.aivudaShell.getDownloads());
  // Trigger with the actual guest, so the main controller can attribute it to this desktop.
  async function guestDownload(filename) {
    await page.evaluate(url => getActiveTab().webview.executeJavaScript(`(() => { const a = document.createElement('a'); a.href = ${JSON.stringify(url)}; a.download = ''; document.body.append(a); a.click(); a.remove(); })()`, true), `${base}/${filename}`);
  }
  await guestDownload('slow.bin');
  console.log('HTTP download requested.');
  await page.waitForFunction(() => document.querySelector('.download-item progress')?.value > 0);
  assert.equal(await page.locator('#downloads-panel').isVisible(), true);
  assert.equal(await page.locator('#downloads-count').textContent(), '1');
  await page.screenshot({ path: path.join(screenshots, 'progress.png') });
  await page.locator('#downloads-close').click();
  await page.waitForFunction(() => document.querySelector('.download-item')?.dataset.state === 'completed' && !document.getElementById('downloads-panel').hidden);
  assert.equal(fs.statSync(path.join(temp, 'slow.bin')).size, 1024 * 1024);
  assert.match(await page.locator('#downloads-notice').textContent(), /Download complete/);
  assert.equal(await page.locator('#downloads-count').isVisible(), false);
  await page.locator('[data-download-action="open"]').click();
  await page.locator('[data-download-action="show"]').click();
  assert.deepEqual(await application.evaluate(() => global.testOpenedPaths), [['open', path.join(temp, 'slow.bin')], ['show', path.join(temp, 'slow.bin')]]);
  await page.screenshot({ path: path.join(screenshots, 'completed.png') });

  await page.evaluate(() => getActiveTab().webview.executeJavaScript(`(() => { const a=document.createElement('a'); const url=URL.createObjectURL(new Blob(['exported config'],{type:'text/plain'})); a.href=url; a.download='config.txt'; document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); })()`));
  await page.waitForFunction(async () => (await window.aivudaShell.getDownloads()).items.some(item => item.filename === 'config.txt' && item.state === 'completed'));
  assert.equal(fs.readFileSync(path.join(temp, 'config.txt'), 'utf8'), 'exported config');
  await guestDownload('unknown.bin');
  await page.waitForFunction(() => [...document.querySelectorAll('.download-item')].some(row => row.querySelector('.download-filename').textContent === 'unknown.bin' && !row.querySelector('progress').hasAttribute('value')));
  const unknown = (await downloads()).items.find(item => item.filename === 'unknown.bin');
  await page.locator(`[data-download-id="${unknown.id}"] [data-download-action="cancel"]`).click();
  await page.waitForFunction(async id => (await window.aivudaShell.getDownloads()).items.find(item => item.id === id)?.state === 'cancelled', unknown.id);
  await guestDownload('failed.bin');
  await page.waitForFunction(async () => (await window.aivudaShell.getDownloads()).items.some(item => item.filename === 'failed.bin' && item.finishedAt && item.state === 'interrupted'));
  await page.waitForFunction(() => document.querySelector('.download-item[data-state="interrupted"] .download-status')?.textContent === 'Download failed');
  await page.evaluate(() => window.aivudaShell.setAppearance({ theme: 'dark', language: 'zh-CN' }));
  await page.waitForFunction(() => document.getElementById('downloads-title').textContent === '下载');
  assert.doesNotMatch(await page.locator('#downloads-notice').textContent(), /Download/);
  await page.screenshot({ path: path.join(screenshots, 'dark-zh.png') });
  const activeDownloads = (await downloads()).items.filter(item => !item.finishedAt);
  for (const item of activeDownloads) await page.evaluate(id => window.aivudaShell.downloadAction(id, 'cancel'), item.id);
  await page.waitForFunction(async () => (await window.aivudaShell.getDownloads()).items.every(item => item.finishedAt));
  await page.locator('#downloads-clear').click();
  await page.waitForFunction(() => !document.getElementById('downloads-empty').hidden);
  await page.locator('#downloads-close').click();

  // Click Reload in a background window: its selected guest must reload, not the active window's guest.
  await page.evaluate(url => {
    const owner = createApplicationWindow();
    activateWindow(owner.id);
    openApplication(url);
  }, `${base}/second`);
  await page.waitForFunction(() => getActiveTab()?.ready && getActiveTab().appUrl.endsWith('/second'));
  const secondTab = await page.evaluate(() => activeTabId);
  const firstOrigin = await page.evaluate(id => tabs.get(id).webview.executeJavaScript('performance.timeOrigin'), firstTab);
  const secondOrigin = await page.evaluate(id => tabs.get(id).webview.executeJavaScript('performance.timeOrigin'), secondTab);
  await page.locator(`.window-controls button[title="重新加载页面"]`).count().then(value => assert.equal(value, 2));
  // Put windows on separate halves so the background window's button is clickable.
  await page.evaluate(id => {
    for (const owner of appWindows.values()) setOuterWindowRegion(owner, owner.id === id ? 'left' : 'right');
  }, firstWindow);
  await page.locator(`.app-window[data-window-id="${firstWindow}"] .window-controls button[title="重新加载页面"]`).click();
  await page.waitForFunction(async ({ id, before }) => await tabs.get(id).webview.executeJavaScript('performance.timeOrigin') !== before, { id: firstTab, before: firstOrigin });
  assert.equal(await page.evaluate(id => tabs.get(id).webview.executeJavaScript('performance.timeOrigin'), secondTab), secondOrigin);
  assert.deepEqual(errors, []);
  console.log('Electron downloads: HTTP progress/completion, blob export, cancellation, unknown totals, failure, file actions, appearance and per-window reload passed.');
}

run().catch(async error => {
  console.error(error);
  if (application) {
    const page = application.windows()[0];
    if (page) {
      console.error('Download state:', await page.evaluate(() => window.aivudaShell.getDownloads()).catch(() => null));
      await page.screenshot({ path: path.join(screenshots, 'failure.png') }).catch(() => {});
    }
  }
  process.exitCode = 1;
}).finally(async () => {
  clearTimeout(watchdog);
  if (application) await application.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  fs.rmSync(temp, { recursive: true, force: true });
});
