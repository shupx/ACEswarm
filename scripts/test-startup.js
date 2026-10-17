const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { freePort } = require('../electron/services/local-services');
const { desktopWindow } = require('./desktop-window');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-startup-'));
const screenshots = path.join(root, '.smoke/startup');
let application;
let output = '';

async function launch(mode) {
  application = await electron.launch({
    args: [path.join(root, 'tests/fixtures/desktop-electron.cjs'), '--no-sandbox'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '',
      ACESWARM_UI_TEST_PROFILE: path.join(temp, mode, 'profile'),
      ACESWARM_WS_ROOT: path.join(temp, mode, 'workspace'),
      ACESWARM_UI_TEST_HOLD_STARTUP: mode === 'failure' ? '' : '1',
      ACESWARM_PYTHON: mode === 'failure' ? path.join(temp, 'missing-python') : path.join(root, '.venv/bin/python'),
      ACESWARM_GATEWAY_PORT: String(await freePort()), ACESWARM_STORE_GATEWAY_PORT: String(await freePort()),
      ACESWARM_AIVUDAOS_MCP_PORT: String(await freePort()), AIVUDAAPPSTORE_MCP_PORT: String(await freePort()),
      ACESWARM_MCP_PORT: String(await freePort()), ACESWARM_CDP_PORT: '0',
    }, timeout: 90000,
  });
  const child = application.process();
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const splash = await application.firstWindow();
  await splash.waitForURL(/\/splash\.html$/);
  await splash.locator('#quit').waitFor({ state: 'visible' });
  await splash.waitForFunction(() => document.querySelector('img').complete);
  assert.ok(await splash.locator('img').evaluate(img => img.naturalWidth > 0));
  assert.equal(await splash.locator('html').getAttribute('lang'), 'en');
  return splash;
}

async function quit(splash) {
  const exited = application.waitForEvent('close');
  await splash.locator('#quit').click();
  await exited;
  application = null;
}

async function run() {
  fs.mkdirSync(screenshots, { recursive: true });
  const splash = await launch('success');
  const errors = [];
  application.on('window', page => page.on('pageerror', error => errors.push(error.message)));
  assert.equal(await splash.locator('#status').textContent(), 'Preparing the runtime...');
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1,
    'only the startup window exists before services start');
  await splash.screenshot({ path: path.join(screenshots, 'loading.png') });
  const closed = splash.waitForEvent('close');
  await application.evaluate(({ ipcMain }) => ipcMain.emit('aceswarm:test-continue-startup'));
  const desktop = await desktopWindow(application);
  await closed;
  await desktop.waitForFunction(() => typeof isRestoringShellState !== 'undefined' && !isRestoringShellState);
  await desktop.locator('#tools-button').click();
  assert.equal(await desktop.locator('#tools-menu').isVisible(), true);
  assert.deepEqual(errors, []);
  await application.close();
  application = null;
  console.log('PASS: splash appears before services and hands off to an initialized, interactive desktop.');

  const failure = await launch('failure');
  await failure.locator('body.failed').waitFor();
  assert.match(await failure.locator('#error').textContent(), /ACESWARM_PYTHON/);
  assert.equal(await failure.locator('#status').textContent(), 'Startup failed.');
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
  await failure.screenshot({ path: path.join(screenshots, 'failure.png') });
  await quit(failure);
  console.log('PASS: startup failure stays readable and Quit exits.');

  const cancelled = await launch('cancel');
  await application.evaluate(({ ipcMain }) => ipcMain.emit('aceswarm:test-continue-startup'));
  const deadline = Date.now() + 10000;
  const pidFile = path.join(temp, 'cancel/profile/startup-service-pids');
  let pids = [];
  while (Date.now() < deadline) {
    if (fs.existsSync(pidFile)) pids = fs.readFileSync(pidFile, 'utf8').trim().split('\n').map(Number);
    if (pids.length) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.ok(pids.length, 'a backend has actually started before cancellation');
  await quit(cancelled);
  for (const pid of pids) {
    let running = false;
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      running = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.equal(running, false, `startup cancellation left service ${pid} running`);
  }
  assert.equal(fs.existsSync(path.join(temp, 'cancel/workspace/state/agent-connection.json')), false);
  console.log('PASS: Quit during service startup stops backends without creating a desktop or agent connection.');
}

run().catch(error => { console.error(error, output); process.exitCode = 1; }).finally(async () => {
  if (application) await application.close().catch(() => {});
  fs.rmSync(temp, { recursive: true, force: true });
});
