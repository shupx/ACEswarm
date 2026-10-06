const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { configureBrowserConnection, checkBrowserPort, readBrowserConnection, startAgentConnection } = require('../electron/services/agent-connection');

test('CDP defaults to a random port, supports overrides and validates input', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-cdp-config-'));
  const switches = new Map();
  const app = { getPath: () => root, commandLine: {
    appendSwitch: (name, value) => switches.set(name, value),
    hasSwitch: name => switches.has(name), getSwitchValue: name => switches.get(name),
  } };
  try {
    fs.writeFileSync(path.join(root, 'DevToolsActivePort'), 'stale');
    assert.equal(configureBrowserConnection(app, {}).port, 0);
    assert.equal(fs.existsSync(path.join(root, 'DevToolsActivePort')), false);
    assert.equal(switches.get('remote-debugging-address'), '127.0.0.1');
    switches.clear();
    assert.equal(configureBrowserConnection(app, { ACESWARM_CDP_PORT: '29793' }).port, 29793);
    assert.equal(configureBrowserConnection(app, { ACESWARM_CDP_PORT: '30793' }).port, 29793);
    switches.clear();
    fs.writeFileSync(path.join(root, 'DevToolsActivePort'), 'stale');
    assert.equal(configureBrowserConnection(app, { ACESWARM_CDP_PORT: '0' }).port, 0);
    assert.equal(fs.existsSync(path.join(root, 'DevToolsActivePort')), false);
    for (const value of ['', '-1', '65536', '12.5', 'bad']) {
      assert.throws(() => configureBrowserConnection(app, { ACESWARM_CDP_PORT: value }), /ACESWARM_CDP_PORT/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('discovery publishes the managed HTTP MCP after validating CDP session identity', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-agent-'));
  const cdp = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${cdp.address().port}/devtools/browser/test` }));
  });
  await new Promise(resolve => cdp.listen(0, '127.0.0.1', resolve));
  const activePortFile = path.join(root, 'DevToolsActivePort');
  fs.writeFileSync(activePortFile, `${cdp.address().port}\n/devtools/browser/test\n`);
  const configuration = { port: 0, activePortFile };
  let service;
  try {
    await assert.rejects(checkBrowserPort({ port: cdp.address().port }), /unavailable.*ACESWARM_CDP_PORT/);
    await checkBrowserPort(configuration);
    let attached;
    service = await startAgentConnection({ configuration, stateDirectory: root, services: {
      startBrowserMcp: async browser => { attached = browser; return 'http://127.0.0.1:28792/mcp'; },
    } });
    assert.equal(service.connection.transport, 'streamable-http');
    assert.equal(service.connection.mcpUrl, 'http://127.0.0.1:28792/mcp');
    assert.equal(attached.browserWSEndpoint, service.connection.browserWSEndpoint);
    const discoveryFile = path.join(root, 'agent-connection.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(discoveryFile)), service.connection);
    fs.writeFileSync(discoveryFile, JSON.stringify({ pid: process.pid + 1 }));
    await service.stop();
    assert.ok(fs.existsSync(discoveryFile), 'Do not remove a different session discovery file');
    fs.writeFileSync(discoveryFile, JSON.stringify(service.connection));
    await service.stop();
    await service.stop();
    assert.equal(fs.existsSync(discoveryFile), false);
    fs.writeFileSync(activePortFile, `${cdp.address().port}\n/devtools/browser/other\n`);
    await assert.rejects(readBrowserConnection(configuration, 100), /Timed out/);
  } finally {
    await service?.stop();
    await new Promise(resolve => { cdp.close(resolve); cdp.closeAllConnections(); });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
