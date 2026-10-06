const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { LocalServices, freePort } = require('../electron/services/local-services');

test('managed browser MCP uses official HTTP sessions, checks hosts and releases its listener', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-browser-mcp-'));
  const manager = new LocalServices({ logs: root }, {});
  manager.endpoints = {};
  const originalPort = process.env.ACESWARM_MCP_PORT;
  process.env.ACESWARM_MCP_PORT = String(await freePort());
  const clients = [];
  let url;
  try {
    url = await manager.startBrowserMcp({ browserWSEndpoint: 'ws://127.0.0.1:1/devtools/browser/test' });
    assert.equal(manager.endpoints.browserMcp, url);
    const sessions = [];
    for (let index = 0; index < 2; index++) {
      const client = new Client({ name: 'browser-mcp-test', version: '1.0' });
      clients.push(client);
      const transport = new StreamableHTTPClientTransport(new URL(url));
      await client.connect(transport);
      await client.ping();
      assert.ok((await client.listTools()).tools.some(tool => tool.name === 'browser_snapshot'));
      sessions.push(transport.sessionId);
      await transport.terminateSession();
    }
    assert.ok(sessions.every(Boolean));
    assert.notEqual(sessions[0], sessions[1]);
    const denied = await new Promise((resolve, reject) => {
      http.get(url, { headers: { Host: 'evil.example' } }, response => {
        response.resume();
        resolve(response.statusCode);
      }).on('error', reject);
    });
    assert.equal(denied, 403);
  } finally {
    await Promise.all(clients.map(client => client.close()));
    await manager.stop();
    if (originalPort === undefined) delete process.env.ACESWARM_MCP_PORT;
    else process.env.ACESWARM_MCP_PORT = originalPort;
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.deepEqual(manager.failures, []);
  await assert.rejects(fetch(url));
});

test('occupied browser MCP port is reported without launching a service', async () => {
  const listener = http.createServer((request, response) => response.end('existing service'));
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const originalPort = process.env.ACESWARM_MCP_PORT;
  const port = listener.address().port;
  process.env.ACESWARM_MCP_PORT = String(port);
  const manager = new LocalServices({}, {});
  try {
    await assert.rejects(manager.startBrowserMcp({}), /browser MCP port .*unavailable.*ACESWARM_MCP_PORT/);
    assert.equal(manager.children.length, 0);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'existing service');
  } finally {
    if (originalPort === undefined) delete process.env.ACESWARM_MCP_PORT;
    else process.env.ACESWARM_MCP_PORT = originalPort;
    await new Promise(resolve => listener.close(resolve));
  }
});
