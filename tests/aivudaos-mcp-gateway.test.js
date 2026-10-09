const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { Gateway, startGateway, settings } = require('../electron/services/aivudaos-mcp-gateway');
const { freePort } = require('../electron/services/local-services');

async function fixture(label, tools = ['me', 'start_app']) {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const message = JSON.parse(raw);
    calls.push({ ...message, authorization: request.headers.authorization });
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2025-06-18', serverInfo: { name: label, version: '1' } };
    else if (message.method === 'tools/list') result = { tools: tools.map(name => ({ name, inputSchema: { type: 'object', properties: { token: { type: 'string' } }, additionalProperties: false } })) };
    else if (message.method === 'ping') result = {};
    else result = { content: [{ type: 'text', text: JSON.stringify({ label, arguments: message.params.arguments }) }], structuredContent: { label } };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, calls, url: `http://127.0.0.1:${server.address().port}/aivuda_os/mcp` };
}
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });

test('SDK discovers generated tools, routes local/remote and persists devices without credentials', async () => {
  const local = await fixture('local');
  const remote = await fixture('robot-a', ['me']);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-mcp-gateway-'));
  const file = path.join(temp, 'devices.json');
  const port = await freePort();
  const { gateway, server } = await startGateway({ port, localUrl: local.url, registryFile: file });
  const client = new Client({ name: 'test', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    await client.ping();
    const tools = (await client.listTools()).tools;
    assert.equal(tools.length, 8);
    assert.equal(tools.find(tool => tool.name === 'me').inputSchema.properties.device_id.default, 'local');
    const call = (name, args = {}) => client.callTool({ name, arguments: args });
    assert.equal((await call('me')).structuredContent.label, 'local');
    assert.ok(!(await call('add_device', { device_id: 'robot-a', mcp_url: remote.url })).isError);
    const result = await call('me', { device_id: 'robot-a', token: 'remote-token' });
    assert.equal(result.structuredContent.label, 'robot-a');
    assert.deepEqual(remote.calls.at(-1).params.arguments, { token: 'remote-token' });
    assert.equal(remote.calls.at(-1).authorization, undefined);
    const unsupported = await call('start_app', { device_id: 'robot-a' });
    assert.equal(unsupported.isError, true);
    assert.match(unsupported.content[0].text, /robot-a.*does not support/);
    const unknown = await call('me', { device_id: 'missing' });
    assert.equal(unknown.isError, true);
    assert.equal((await call('remove_device', { device_id: 'local' })).isError, true);
    assert.equal((await call('add_device', { device_id: 'robot-a', mcp_url: remote.url })).isError, true);
    assert.ok(!fs.readFileSync(file, 'utf8').includes('remote-token'));
    assert.equal(new Gateway({ localUrl: local.url, registryFile: file }).devices.get('robot-a').mcp_url, remote.url);
    assert.ok(!(await call('update_device', { device_id: 'robot-a', timeout_seconds: 2, insecure: true })).isError);
    assert.equal(gateway.devices.get('robot-a').timeout_seconds, 2);
    assert.equal(new Gateway({ localUrl: local.url, registryFile: file }).devices.get('robot-a').insecure, true);
    assert.ok(!(await call('update_device', { device_id: 'robot-a', insecure: false })).isError);
    assert.equal(gateway.devices.get('robot-a').insecure, false);
    assert.ok(!(await call('reconnect_device', { device_id: 'robot-a' })).isError);
    assert.ok(!(await call('remove_device', { device_id: 'robot-a' })).isError);
    assert.equal(JSON.parse(fs.readFileSync(file)).devices.length, 0);
    const headers = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
    const url = `http://127.0.0.1:${port}/mcp`;
    assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'http://evil.local' }, body: '{}' })).status, 403);
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await fetch(url, { method: 'POST', headers, body: '{' })).status, 400);
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })).status, 202);
  } finally {
    await client.close(); await close(server); await close(local.server); await close(remote.server);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('remote failures are identified, writes never retry, and header tokens cannot leak', async () => {
  const local = await fixture('local');
  const remote = await fixture('remote');
  const gateway = new Gateway({ localUrl: local.url });
  try {
    await gateway.discover(gateway.devices.get('local'));
    await gateway.manage('add_device', { device_id: 'remote', mcp_url: remote.url });
    await gateway.call('me', {}, 'Bearer local-token');
    assert.equal(local.calls.at(-1).authorization, 'Bearer local-token');
    await assert.rejects(gateway.call('me', { device_id: 'remote' }, 'Bearer local-token'), /local-only/);
    await gateway.call('me', { device_id: 'remote', token: 'remote-token' }, 'Bearer local-token');
    assert.equal(remote.calls.at(-1).authorization, undefined);
    await close(remote.server);
    await assert.rejects(gateway.call('start_app', { device_id: 'remote' }), /Device remote/);
    assert.equal(remote.calls.filter(call => call.method === 'tools/call').length, 1);
    assert.equal((await gateway.manage('get_device_status', { device_id: 'remote' })).status, 'unavailable');
  } finally { await close(local.server); if (remote.server.listening) await close(remote.server); }
});

test('invalid endpoint and timeout settings are rejected', () => {
  assert.throws(() => settings({ device_id: 'robot', mcp_url: 'https://robot/mcp', insecure: 'true' }));
  assert.equal(settings({ device_id: 'robot', mcp_url: 'https://robot/mcp' }).insecure, false);
  for (const mcp_url of ['file:///tmp/x', 'https://u:p@robot.local/mcp', 'http://robot/mcp?token=secret']) {
    assert.throws(() => settings({ device_id: 'robot', mcp_url }));
  }
  assert.throws(() => settings({ device_id: '../x', mcp_url: 'http://robot/mcp' }));
  assert.throws(() => settings({ device_id: 'robot', mcp_url: 'http://robot/mcp', timeout_seconds: 0 }));
  assert.throws(() => settings({ device_id: 'robot', mcp_url: 'https://robot/mcp', ca_file: 'relative.crt' }));
});

test('upstream deadline bounds stalled calls and failed registration leaves registry unchanged', async () => {
  const local = await fixture('local');
  const stalled = http.createServer((request, response) => { request.resume(); });
  await new Promise(resolve => stalled.listen(0, '127.0.0.1', resolve));
  const gateway = new Gateway({ localUrl: local.url });
  try {
    await gateway.discover(gateway.devices.get('local'));
    const started = Date.now();
    await assert.rejects(gateway.manage('add_device', { device_id: 'slow',
      mcp_url: `http://127.0.0.1:${stalled.address().port}/mcp`, timeout_seconds: 1 }), /timed out/);
    assert.ok(Date.now() - started < 2500);
    assert.equal(gateway.devices.has('slow'), false);
  } finally { await close(local.server); await close(stalled); }
});

test('HTTPS preserves certificate validation and supports explicitly trusted CA', async () => {
  const https = require('node:https');
  const { execFileSync } = require('node:child_process');
  const { upstream } = require('../electron/services/aivudaos-mcp-gateway');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'os-gateway-tls-'));
  const key = path.join(directory, 'key.pem');
  const cert = path.join(directory, 'cert.pem');
  let server;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
      '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
    server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, async (request, response) => {
      request.resume();
      response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const device = settings({ device_id: 'tls', mcp_url: `https://localhost:${server.address().port}/mcp` });
    await assert.rejects(upstream(device, 'ping'));
    assert.deepEqual(await upstream({ ...device, insecure: true }, 'ping'), {});
    assert.deepEqual(await upstream({ ...device, insecure: true, mcp_url: `https://127.0.0.1:${server.address().port}/mcp` }, 'ping'), {});
    await assert.rejects(upstream({ ...device, insecure: false }, 'ping'));
    assert.deepEqual(await upstream({ ...device, ca_file: cert }, 'ping'), {});
    await assert.rejects(upstream({ ...device, ca_file: cert, mcp_url: `https://127.0.0.1:${server.address().port}/mcp` }, 'ping'));
  } finally { if (server) await close(server); fs.rmSync(directory, { recursive: true, force: true }); }
});
