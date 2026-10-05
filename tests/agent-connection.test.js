const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { configureBrowserConnection, readBrowserConnection, startAgentConnection } = require('../electron/services/agent-connection');

test('browser configuration uses a random loopback CDP port and preserves launcher overrides', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-cdp-config-'));
  const switches = new Map();
  const app = { getPath: () => root, commandLine: {
    appendSwitch: (name, value) => switches.set(name, value),
    hasSwitch: name => switches.has(name), getSwitchValue: name => switches.get(name),
  } };
  try {
    fs.writeFileSync(path.join(root, 'DevToolsActivePort'), 'stale');
    assert.equal(configureBrowserConnection(app).port, 0);
    assert.equal(switches.get('remote-debugging-address'), '127.0.0.1');
    assert.equal(fs.existsSync(path.join(root, 'DevToolsActivePort')), false);
    switches.set('remote-debugging-port', '34567');
    assert.equal(configureBrowserConnection(app).port, 34567);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('HTTP MCP supports SDK clients, fresh targets, origin checks, and shutdown cleanup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-agent-'));
  let targets = [{ id: 'shell', type: 'page', title: 'ACEswarm', url: 'file:///shell.html' }];
  const cdp = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url === '/json/version'
      ? { webSocketDebuggerUrl: `ws://127.0.0.1:${cdp.address().port}/devtools/browser/test` } : targets));
  });
  await new Promise(resolve => cdp.listen(0, '127.0.0.1', resolve));
  const activePortFile = path.join(root, 'DevToolsActivePort');
  fs.writeFileSync(activePortFile, `${cdp.address().port}\n/devtools/browser/test\n`);
  const configuration = { port: 0, activePortFile };
  let service;
  const clients = [];
  try {
    service = await startAgentConnection({ configuration, stateDirectory: root, port: 0 });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'agent-connection.json'))), service.connection);
    for (let index = 0; index < 2; index++) {
      const client = new Client({ name: 'test-agent', version: '1.0' });
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(service.connection.mcpUrl)));
      assert.equal((await client.listTools()).tools[0].name, 'get_browser_connection');
      const result = await client.callTool({ name: 'get_browser_connection', arguments: {} });
      assert.equal(result.isError, undefined);
      assert.deepEqual(result.structuredContent.targets, targets);
      assert.match(result.structuredContent.javascript, /chromium.connectOverCDP/);
      targets = [...targets, { id: 'guest', type: 'webview', title: 'AivudaOS', url: 'http://127.0.0.1:28790/' }];
    }
    const unknown = await clients[0].callTool({ name: 'unknown', arguments: {} });
    assert.equal(unknown.isError, true);
    const blocked = await fetch(service.connection.mcpUrl, { method: 'POST', headers: { Origin: 'https://example.com' } });
    assert.equal(blocked.status, 403);
    const reboundStatus = await new Promise((resolve, reject) => {
      const request = http.request(service.connection.mcpUrl, { method: 'POST', headers: { Host: 'example.com' } }, response => {
        response.resume(); resolve(response.statusCode);
      });
      request.on('error', reject); request.end();
    });
    assert.equal(reboundStatus, 403);
    assert.equal((await fetch(service.connection.mcpUrl)).status, 405);
    await Promise.all(clients.map(client => client.close()));
    assert.equal(service.stop(), service.stop());
    await service.stop();
    assert.equal(fs.existsSync(path.join(root, 'agent-connection.json')), false);
    await assert.rejects(fetch(service.connection.mcpUrl));
    fs.writeFileSync(activePortFile, `${cdp.address().port}\n/devtools/browser/other\n`);
    await assert.rejects(readBrowserConnection(configuration, 100), /Timed out/);
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    await service?.stop();
    await new Promise(resolve => { cdp.close(resolve); cdp.closeAllConnections(); });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
