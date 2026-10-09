const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

async function smokeOsLifecycle(client, token) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-mcp-app-'));
  const appId = `mcp_fixture_${randomUUID().replaceAll('-', '')}`;
  const call = async (name, arguments_ = {}) => {
    const result = await client.callTool({ name, arguments: { ...arguments_, token } });
    assert.ok(!result.isError, result.content?.[0]?.text);
    return JSON.parse(result.content[0].text);
  };
  const operation = async job => {
    assert.ok(job.operation_id, JSON.stringify(job));
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const status = await call('get_operation', { operation_id: job.operation_id });
      if (status.done) {
        assert.equal(status.status, 'completed', JSON.stringify(status));
        const events = await call('stream_operation_events', {
          operation_id: job.operation_id, max_events: 100, timeout_seconds: 2,
        });
        assert.ok(events.events.length > 0, 'Operation events returned through ASGI');
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail('OS MCP operation timed out');
  };
  let uploaded = false;
  try {
    fs.writeFileSync(path.join(directory, 'manifest.yaml'), `app_id: ${appId}
name: MCP fixture
version: 1.0.0
run:
  entrypoint: start.sh
default_config_path: config.yaml
config_schema_path: schema.yaml
`);
    fs.writeFileSync(path.join(directory, 'config.yaml'), 'message: initial\n');
    fs.writeFileSync(path.join(directory, 'schema.yaml'), 'type: object\nproperties:\n  message:\n    type: string\n');
    fs.writeFileSync(path.join(directory, 'start.sh'), '#!/usr/bin/env bash\necho MCP_FIXTURE_RUNNING\nexec sleep 300\n', { mode: 0o755 });
    const archive = execFileSync('tar', ['-czf', '-', '-C', directory, '.']);
    const job = await call('upload_app', { file: { filename: 'fixture.tar.gz', content_base64: archive.toString('base64') } });
    uploaded = true;
    await operation(job);
    const config = await call('get_app_config', { app_id: appId });
    await call('put_app_config', { app_id: appId, body: { version: config.version, data: { message: 'updated' } } });
    assert.equal((await call('get_app_config', { app_id: appId })).data.message, 'updated');
    const stale = await client.callTool({ name: 'put_app_config', arguments: {
      app_id: appId, token, body: { version: config.version, data: { message: 'stale' } },
    } });
    assert.equal(stale.isError, true, 'API rejects stale configuration versions through MCP');
    await operation(await call('start_app', { app_id: appId }));
    assert.equal(Boolean((await call('get_app_status', { app_id: appId })).runtime.running), true);
    await operation(await call('restart_app', { app_id: appId }));
    assert.equal(Boolean((await call('get_app_status', { app_id: appId })).runtime.running), true);
    const logDeadline = Date.now() + 3000;
    let logs;
    do {
      logs = await call('get_logs', { app_id: appId });
      if (JSON.stringify(logs).includes('MCP_FIXTURE_RUNNING')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < logDeadline);
    assert.match(JSON.stringify(logs), /MCP_FIXTURE_RUNNING/);
    await operation(await call('stop_app', { app_id: appId }));
    assert.equal(Boolean((await call('get_app_status', { app_id: appId })).runtime.running), false);
    console.log('PASS: OS MCP upload/install, config revision conflict, start/restart/logs/stop and SSE');
  } finally {
    try {
      if (uploaded) {
        await operation(await call('uninstall_app', { app_id: appId, body: { purge: true } }));
        assert.ok(!(await call('list_installed_apps')).items.some(app => app.app_id === appId));
      }
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }
}

async function smokePackageMcps(endpoints) {
  for (const [name, url, expected, loginTool, loginArguments, tokenKey, meTool] of [
    ['os', endpoints.osMcp, 53, 'login', { body: { username: 'admin', password: 'admin123' } }, 'access_token', 'me'],
    ['store', endpoints.storeMcp, 33, 'dev_login', { username: 'admin', password: 'admin123' }, 'access_token', 'dev_me'],
  ]) {
    const accessToken = name === 'store' ? process.env.AIVUDAAPPSTORE_MCP_ACCESS_TOKEN : undefined;
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} },
    });
    const client = new Client({ name: 'aceswarm-mcp-smoke', version: '1.0' });
    try {
      await client.connect(transport);
      await client.ping();
      const { tools } = await client.listTools();
      assert.equal(tools.length, expected, `${name} API coverage`);
      const automaticMe = await client.callTool({ name: meTool, arguments: {} });
      assert.ok(!automaticMe.isError, automaticMe.content?.[0]?.text);
      const automaticIdentity = JSON.parse(automaticMe.content[0].text);
      assert.equal((name === 'os' ? automaticIdentity : automaticIdentity.user).username, 'admin',
        `${name} automatic default login`);
      const login = await client.callTool({ name: loginTool, arguments: loginArguments });
      assert.ok(!login.isError, login.content?.[0]?.text);
      const token = JSON.parse(login.content[0].text)[tokenKey];
      assert.ok(token, `${name} login returned token`);
      const authorization = name === 'os' ? { token } : { authorization: `Bearer ${token}` };
      const me = await client.callTool({ name: meTool, arguments: authorization });
      assert.ok(!me.isError, me.content?.[0]?.text);
      if (name === 'os') {
        assert.equal(endpoints.osDirectMcp, new URL('aivuda_os/mcp', endpoints.os).href);
        const devices = await client.callTool({ name: 'list_devices', arguments: {} });
        assert.equal(JSON.parse(devices.content[0].text).devices[0].device_id, 'local');
        const installed = await client.callTool({ name: 'list_installed_apps', arguments: authorization });
        assert.ok(!installed.isError, installed.content?.[0]?.text);
        const headerClient = new Client({ name: 'aceswarm-os-bearer-smoke', version: '1.0' });
        try {
          await headerClient.connect(new StreamableHTTPClientTransport(new URL(url), {
            requestInit: { headers: { Authorization: `Bearer ${token}` } },
          }));
          const identity = await headerClient.callTool({ name: 'me', arguments: {} });
          assert.ok(!identity.isError, identity.content?.[0]?.text);
          assert.equal(JSON.parse(identity.content[0].text).username, 'admin');
        } finally { await headerClient.close(); }
        const defaultIdentity = await client.callTool({ name: 'me', arguments: {} });
        assert.ok(!defaultIdentity.isError, defaultIdentity.content?.[0]?.text);
        assert.equal(JSON.parse(defaultIdentity.content[0].text).username, 'admin');
        const registered = await client.callTool({ name: 'add_device', arguments: {
          device_id: 'smoke-remote', mcp_url: endpoints.osDirectMcp,
        } });
        assert.ok(!registered.isError, registered.content?.[0]?.text);
        try {
          const remoteIdentity = await client.callTool({ name: 'me', arguments: { device_id: 'smoke-remote' } });
          assert.ok(!remoteIdentity.isError, remoteIdentity.content?.[0]?.text);
          assert.equal(JSON.parse(remoteIdentity.content[0].text).username, 'admin');
        } finally {
          const removed = await client.callTool({ name: 'remove_device', arguments: { device_id: 'smoke-remote' } });
          assert.ok(!removed.isError, removed.content?.[0]?.text);
        }
        await smokeOsLifecycle(client, token);
      } else {
        const index = await client.callTool({ name: 'store_index', arguments: {} });
        assert.ok(!index.isError, index.content?.[0]?.text);
        const download = await client.callTool({ name: 'store_sample_package', arguments: {} });
        assert.ok(!download.isError, download.content?.[0]?.text);
        const data = JSON.parse(download.content[0].text);
        assert.ok(Buffer.from(data.content_base64, 'base64').length > 0, 'Sample package download');
        const parsed = await client.callTool({ name: 'dev_parse_package_manifest', arguments: {
          ...authorization, package_zip: { filename: data.filename, content_base64: data.content_base64 },
        } });
        assert.ok(!parsed.isError, parsed.content?.[0]?.text);
        const manifest = { ...JSON.parse(parsed.content[0].text).normalized_manifest,
          app_id: `app_mcp_smoke_${randomUUID().replaceAll('-', '')}` };
        const upload = await client.callTool({ name: 'dev_upload_package', arguments: {
          ...authorization, manifest_json: JSON.stringify(manifest),
          package_zip: { filename: data.filename, content_base64: data.content_base64 },
        } });
        assert.ok(!upload.isError, upload.content?.[0]?.text);
        try {
          const published = JSON.parse(upload.content[0].text);
          const args = { app_id: published.app_id, version: published.version };
          const metadata = await client.callTool({ name: 'store_download_metadata', arguments: args });
          assert.ok(!metadata.isError, metadata.content?.[0]?.text);
          const expected = JSON.parse(metadata.content[0].text);
          const artifact = await client.callTool({ name: 'store_download_file', arguments: args });
          assert.ok(!artifact.isError, artifact.content?.[0]?.text);
          const bytes = Buffer.from(JSON.parse(artifact.content[0].text).content_base64, 'base64');
          assert.equal(bytes.length, expected.size);
          assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256,
            'Published package redirect reaches Caddy and returns exact artifact bytes');
        } finally {
          const deleted = await client.callTool({ name: 'dev_delete_app', arguments: {
            ...authorization, app_id: manifest.app_id,
          } });
          assert.ok(!deleted.isError, deleted.content?.[0]?.text);
        }
      }
      console.log(`PASS: ${name} official SDK handshake, ${tools.length} tools, backend login and API calls`);
    } finally {
      await client.close();
    }
  }
}

module.exports = { smokePackageMcps };
