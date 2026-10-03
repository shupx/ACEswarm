const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createControlServer } = require('../electron/backend/control-api');

async function withServer(config, fn) {
  const server = createControlServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { return await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

async function json(url, options) {
  const response = await fetch(url, options);
  return { status: response.status, body: await response.json() };
}

test('control API exposes health, runtime, pages, and workspace', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-control-'));
  const config = {
    endpoints: { os: 'http://127.0.0.1:41001/', store: 'http://127.0.0.1:41002/', gateway: 'http://127.0.0.1:41003' },
    failures: [],
    workspace: { root, projects: path.join(root, 'projects'), experiments: path.join(root, 'experiments') },
    pages: [{ id: 'settings', label: 'Settings', kind: 'os' }],
  };
  fs.mkdirSync(config.workspace.projects, { recursive: true });
  fs.mkdirSync(config.workspace.experiments, { recursive: true });
  try { await withServer(config, async (base) => {
    assert.deepEqual((await json(`${base}/health`)).body, { ok: true, service: 'aceswarm-control' });
    assert.deepEqual((await json(`${base}/runtime/status`)).body.endpoints, config.endpoints);
    assert.deepEqual((await json(`${base}/pages`)).body.pages, config.pages);
    assert.equal((await json(`${base}/workspace?kind=projects`)).status, 200);
  }); } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('streamable HTTP MCP lists and calls ACEswarm tools', async () => {
  const config = {
    endpoints: { os: 'http://127.0.0.1:42001/', store: 'http://127.0.0.1:42002/', gateway: 'http://127.0.0.1:42003' },
    failures: ['example'],
    workspace: { root: '/tmp/aceswarm', projects: '/tmp/aceswarm/projects', experiments: '/tmp/aceswarm/experiments' },
    pages: [{ id: 'store', label: 'App Store', kind: 'store' }],
  };
  await withServer(config, async (base) => {
    const init = await json(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
    assert.equal(init.body.result.serverInfo.name, 'aceswarm-control');
    const listed = await json(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
    assert.deepEqual(listed.body.result.tools.map((tool) => tool.name), ['aceswarm_get_runtime_status', 'aceswarm_list_pages', 'aceswarm_list_workspace']);
    const called = await json(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'aceswarm_get_runtime_status', arguments: {} } }) });
    assert.deepEqual(JSON.parse(called.body.result.content[0].text).failures, ['example']);
  });
});

test('MCP rejects unknown methods and tools', async () => {
  await withServer({ endpoints: {}, failures: [], workspace: {}, pages: [] }, async (base) => {
    const response = await json(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } }) });
    assert.equal(response.body.error.code, -32602);
  });
});
