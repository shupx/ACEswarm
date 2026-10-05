const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { freePort } = require('../electron/services/local-services');

const root = path.resolve(__dirname, '..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-agent-ui-'));
let child;
let browser;
let client;
let output = '';

async function run() {
  child = spawn(require('electron'), [path.join(root, 'tests/fixtures/desktop-electron.cjs'), '--no-sandbox'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '',
      ACESWARM_UI_TEST_PROFILE: path.join(temporary, 'profile'), ACESWARM_WS_ROOT: path.join(temporary, 'workspace'),
      ACESWARM_GATEWAY_PORT: String(await freePort()), ACESWARM_STORE_GATEWAY_PORT: String(await freePort()),
      ACESWARM_MCP_PORT: '0', ACESWARM_PYTHON: path.join(root, '.venv/bin/python'),
      ACESWARM_CADDY: path.join(root, 'resources/app-gateway/caddy'),
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const discoveryFile = path.join(temporary, 'workspace/state/agent-connection.json');
  const deadline = Date.now() + 90000;
  while (!fs.existsSync(discoveryFile)) {
    if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) throw new Error(`ACEswarm startup failed:\n${output}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const discovery = JSON.parse(fs.readFileSync(discoveryFile));
  client = new Client({ name: 'aceswarm-live-test', version: '1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(discovery.mcpUrl)));
  const result = await client.callTool({ name: 'get_browser_connection', arguments: {} });
  assert.equal(result.isError, undefined);
  browser = await chromium.connectOverCDP(result.structuredContent.cdpEndpoint);
  const shell = browser.contexts().flatMap(context => context.pages()).find(page => page.url().endsWith('/shell.html'));
  assert.ok(shell, 'Existing ACEswarm shell is visible through CDP');
  await shell.waitForFunction(() => document.querySelector('#applications-button'));
  await shell.locator('#applications-button').click();
  await shell.locator('#applications-menu').waitFor({ state: 'visible' });
  await shell.keyboard.press('Escape');
  await browser.close(); browser = null;
  assert.equal(child.exitCode, null, 'Disconnect leaves ACEswarm running');
  browser = await chromium.connectOverCDP(discovery.cdpEndpoint);
  assert.ok(browser.contexts().flatMap(context => context.pages()).some(page => page.url().endsWith('/shell.html')));
  await browser.close(); browser = null;
  await client.close(); client = null;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
  assert.equal(fs.existsSync(discoveryFile), false, 'Discovery file removed on shutdown');
  await assert.rejects(fetch(discovery.mcpUrl));
  await assert.rejects(fetch(`${discovery.cdpEndpoint}/json/version`));
  console.log('PASS: automatic CDP, MCP discovery, existing desktop interaction, reconnect, and shutdown');
}

run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close().catch(() => {});
  await client?.close().catch(() => {});
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    await exited;
    clearTimeout(timer);
  }
  fs.rmSync(temporary, { recursive: true, force: true });
});
