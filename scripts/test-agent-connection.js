const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
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
      ACESWARM_PYTHON: path.join(root, '.venv/bin/python'),
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
  assert.equal(discovery.cdpEndpoint, `http://127.0.0.1:${process.env.ACESWARM_CDP_PORT || '28793'}`);
  assert.equal(discovery.mcpUrl, undefined);
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [path.join(root, 'node_modules/@playwright/mcp/cli.js'), '--cdp-endpoint', discovery.cdpEndpoint,
      '--output-dir', path.join(temporary, 'mcp-output')], cwd: root }));
  const tool = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    return result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  };
  const tools = (await client.listTools()).tools.map(tool => tool.name);
  assert.ok(tools.includes('browser_snapshot'));
  const tabs = await tool('browser_tabs', { action: 'list' });
  const shellIndex = tabs.match(/- (\d+):.*shell\.html/);
  assert.ok(shellIndex, tabs);
  await tool('browser_tabs', { action: 'select', index: Number(shellIndex[1]) });
  const desktopSnapshot = await tool('browser_snapshot');
  const applicationsRef = desktopSnapshot.match(/button "Applications"[^\n]*\[ref=([^\]]+)\]/);
  assert.ok(applicationsRef, desktopSnapshot);
  await tool('browser_click', { element: 'Applications', target: applicationsRef[1] });
  const menuSnapshot = await tool('browser_snapshot');
  assert.match(menuSnapshot, /menu "Applications"/);
  await tool('browser_click', { element: 'Console application', target: '#applications-menu button[data-app-url]:has-text("Console")' });
  let guestIndex;
  let currentTabs;
  const guestDeadline = Date.now() + 15000;
  while (!guestIndex && Date.now() < guestDeadline) {
    currentTabs = await tool('browser_tabs', { action: 'list' });
    guestIndex = currentTabs.split('\n').find(line => /- \d+:/.test(line) && /http:\/\/127\.0\.0\.1:/.test(line));
    if (!guestIndex) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(guestIndex, `WebView missing: ${currentTabs}`);
  await tool('browser_tabs', { action: 'select', index: Number(guestIndex.match(/- (\d+):/)[1]) });
  const snapshot = await tool('browser_snapshot');
  assert.match(snapshot, /Page URL: http:\/\/127\.0\.0\.1:/);
  assert.match(snapshot, /textbox|button|link/, 'WebView accessibility content is available');
  await client.close(); client = null;
  assert.equal(child.exitCode, null, 'MCP disconnect leaves ACEswarm running');
  browser = await chromium.connectOverCDP(discovery.cdpEndpoint);
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
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
  assert.equal(fs.existsSync(discoveryFile), false, 'Discovery file removed on shutdown');
  await assert.rejects(fetch(`${discovery.cdpEndpoint}/json/version`));
  console.log('PASS: fixed/configured CDP, Playwright MCP desktop and WebView tools, reconnect, and shutdown');

  const occupied = http.createServer((request, response) => response.end('unrelated service'));
  await new Promise(resolve => occupied.listen(Number(new URL(discovery.cdpEndpoint).port), '127.0.0.1', resolve));
  const startupErrorFile = path.join(temporary, 'startup-error.txt');
  try {
    child = spawn(require('electron'), [path.join(root, 'tests/fixtures/desktop-electron.cjs'), '--no-sandbox'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '',
        ACESWARM_UI_TEST_PROFILE: path.join(temporary, 'conflict-profile'),
        ACESWARM_WS_ROOT: path.join(temporary, 'conflict-workspace'),
        ACESWARM_UI_TEST_STARTUP_ERROR: startupErrorFile,
      }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const conflictDeadline = Date.now() + 15000;
    while (child.exitCode === null && child.signalCode === null && Date.now() < conflictDeadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(child.exitCode !== null || child.signalCode !== null, `Port conflict must exit:\n${output}`);
    assert.match(fs.readFileSync(startupErrorFile, 'utf8'), /CDP port .*unavailable.*ACESWARM_CDP_PORT/);
    assert.equal(fs.existsSync(path.join(temporary, 'conflict-workspace/state/agent-connection.json')), false);
    assert.equal(await (await fetch(discovery.cdpEndpoint)).text(), 'unrelated service');
    console.log('PASS: occupied CDP port reports an error and exits without affecting the other service');
  } finally {
    await new Promise(resolve => occupied.close(resolve));
  }
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
