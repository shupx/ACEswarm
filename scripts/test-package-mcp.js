const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

async function smokePackageMcps(endpoints) {
  for (const [name, url, expected, loginTool, loginArguments, tokenKey, meTool] of [
    ['os', endpoints.osMcp, 47, 'login', { body: { username: 'admin', password: 'admin123' } }, 'access_token', 'me'],
    ['store', endpoints.storeMcp, 33, 'dev_login', { username: 'admin', password: 'admin123' }, 'access_token', 'dev_me'],
  ]) {
    const accessToken = process.env[name === 'os' ? 'AIVUDAOS_MCP_ACCESS_TOKEN' : 'AIVUDAAPPSTORE_MCP_ACCESS_TOKEN'];
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
      assert.equal((name === 'os' ? automaticIdentity : automaticIdentity.user).username, 'admin', `${name} automatic default login`);
      const login = await client.callTool({ name: loginTool, arguments: loginArguments });
      assert.ok(!login.isError, login.content?.[0]?.text);
      const token = JSON.parse(login.content[0].text)[tokenKey];
      assert.ok(token, `${name} login returned token`);
      const authorization = name === 'os' ? { token } : { authorization: `Bearer ${token}` };
      const me = await client.callTool({ name: meTool, arguments: authorization });
      assert.ok(!me.isError, me.content?.[0]?.text);
      if (name === 'os') {
        const installed = await client.callTool({ name: 'list_installed_apps', arguments: authorization });
        assert.ok(!installed.isError, installed.content?.[0]?.text);
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
