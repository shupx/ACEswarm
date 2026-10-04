const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { workspace } = require('../electron/services/workspace');
const { createControlServer } = require('../electron/backend/control-api');
const { ControlServer } = require('../electron/services/control-server');
const { LocalServices } = require('../electron/services/local-services');
const { createControlAdapter } = require('../electron/renderer-adapter');

async function request(url, options) { const response = await fetch(url, options); return { status: response.status, body: await response.json() }; }
test('control API exposes safe status, descriptors, workspace and targets', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-control-'));
  const paths = workspace(root); const control = new ControlServer({ paths, endpoints: { os: 'http://127.0.0.1:1/', store: 'http://127.0.0.1:2/', gateway: 'http://127.0.0.1:3' } });
  try {
    const base = await control.start();
    assert.equal((await request(`${base}/api/v1/health`)).body.ok, true);
    assert.ok((await request(`${base}/api/v1/pages`)).body.some((page) => page.id === 'settings'));
    assert.equal((await request(`${base}/api/v1/settings/target`)).body.kind, 'aivudaos-settings');
    assert.equal((await request(`${base}/api/v1/workspace/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'demo' }) })).status, 201);
    assert.deepEqual((await request(`${base}/api/v1/workspace/projects`)).body.items, ['demo']);
    assert.equal((await request(`${base}/api/v1/workspace/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '../escape' }) })).status, 400);
  } finally { await control.stop(); fs.rmSync(root, { recursive: true, force: true }); }
});
test('streamable HTTP MCP keeps Codex-compatible notification and session responses', async () => {
  const server = createControlServer({ endpoints: {}, pages: [], failures: [] });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const initialize = await fetch(`${base}/mcp`, { method: 'POST', headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
    assert.equal(initialize.status, 200);
    assert.match(initialize.headers.get('content-type'), /^application\/json/);
    const notification = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
    assert.equal(notification.status, 202);
    assert.match(notification.headers.get('content-type'), /^application\/json/);
    assert.equal((await fetch(`${base}/mcp`, { method: 'DELETE' })).status, 204);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('stdio MCP handshake and structured tool call use control API', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-mcp-')); const paths = workspace(root);
  const control = new ControlServer({ paths, endpoints: { os: 'http://127.0.0.1:1/', store: 'http://127.0.0.1:2/', gateway: 'http://127.0.0.1:3' } });
  const child = spawn(process.execPath, [path.join(__dirname, '../electron/services/mcp-server.js')], { env: { ...process.env, ACESWARM_CONTROL_URL: await control.start() }, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = []; child.stdout.on('data', (data) => lines.push(...data.toString().trim().split('\n').filter(Boolean)));
  const next = async () => { for (let i = 0; i < 50; i++) { if (lines.length) return JSON.parse(lines.shift()); await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error('MCP response timeout'); };
  try {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    assert.equal((await next()).result.serverInfo.name, 'aceswarm');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
    const listed = (await next()).result.tools;
    assert.ok(listed.some((tool) => tool.name === 'aceswarm_status'));
    assert.equal(listed.find((tool) => tool.name === 'aceswarm_status').annotations.readOnlyHint, true);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'aceswarm_status', arguments: {} } }) + '\n');
    assert.equal((await next()).result.isError, false);
  } finally { child.kill('SIGTERM'); await control.stop(); fs.rmSync(root, { recursive: true, force: true }); }
});
test('renderer adapter delegates only the stable control surface', () => {
  const calls = [];
  const transport = Object.fromEntries(['status', 'pages', 'resolvePage', 'workspaceItems', 'createWorkspaceItem', 'settingsTarget', 'storeTarget', 'bootstrap'].map((name) => [name, (...args) => { calls.push([name, ...args]); return name; }]));
  const adapter = createControlAdapter(transport);
  assert.equal(adapter.resolvePage('settings'), 'resolvePage');
  assert.equal(adapter.storeTarget(), 'storeTarget');
  assert.deepEqual(calls, [['resolvePage', 'settings'], ['storeTarget']]);
});
test('service lifecycle auto-starts ACEswarm MCP with loopback control URL', () => {
  const manager = new LocalServices({}, {}); let invocation;
  manager.launch = (...args) => { invocation = args; return { pid: 1 }; };
  assert.deepEqual(manager.startMcp('http://127.0.0.1:1234'), { pid: 1 });
  assert.equal(invocation[0], 'aceswarm-mcp');
  assert.equal(invocation[1], process.execPath);
  assert.equal(invocation[3].ACESWARM_CONTROL_URL, 'http://127.0.0.1:1234');
  assert.equal(invocation[3].ELECTRON_RUN_AS_NODE, '1');
});
