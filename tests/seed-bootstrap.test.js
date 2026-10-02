const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { provision, verifyArtifact } = require('../electron/services/seed');

test('seed publication uses the AppStore API and queues the canonical config export', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-bootstrap-'));
  const archive = Buffer.from('package-content');
  const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  const document = { format_version: 1, payload: { system_parameters: { feature: true }, apps: [
    { app_id: 'demo', version: '1.0.0', parameters: { port: 10 }, autostart: true, running: true },
  ] } };
  fs.writeFileSync(path.join(directory, 'demo.zip'), archive);
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify(document));
  const manifest = { schemaVersion: 2, configExport: { artifact: 'config.json', sha256: digest(fs.readFileSync(path.join(directory, 'config.json'))) },
    apps: [{ id: 'demo', version: '1.0.0', artifact: 'demo.zip', sha256: digest(archive), policy: 'install-if-missing', required: true }] };
  const manifestPath = path.join(directory, 'seed-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  const calls = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const url = new URL(request.url, 'http://localhost');
    calls.push({ pathname: url.pathname, method: request.method, body: Buffer.concat(chunks).toString(), headers: request.headers });
    response.setHeader('Content-Type', 'application/json');
    let body;
    if (url.pathname.endsWith('/auth/login')) body = { access_token: 'secret' };
    else if (url.pathname.endsWith('/download-url')) {
      if (!calls.some((call) => call.pathname.endsWith('/upload-package'))) { response.statusCode = 404; body = { detail: 'missing' }; }
      else body = { url: '/aivuda_app_store/files/apps/demo/1.0.0/package.zip' };
    } else if (url.pathname.endsWith('/manifest/parse-package')) body = { manifest: { app_id: 'demo', version: '1.0.0', name: 'Demo', description: 'Example' } };
    else if (url.pathname === '/aivuda_app_store/store/apps/demo') { response.statusCode = 404; body = { detail: 'missing' }; }
    else if (url.pathname.endsWith('/upload-package')) body = { app_id: 'demo', version: '1.0.0', status: 'published' };
    else if (url.pathname.endsWith('/config/import')) body = { operation_id: 'op1', status: 'queued' };
    else if (url.pathname.endsWith('/operations/op1')) body = { status: 'completed', result: { configured: ['demo'] } };
    else { response.statusCode = 404; body = { detail: 'unknown' }; }
    response.end(JSON.stringify(body));
  });
  const previousOs = process.env.ACESWARM_SEED_ADMIN_PASSWORD;
  const previousStore = process.env.ACESWARM_SEED_STORE_PASSWORD;
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/`;
    process.env.ACESWARM_SEED_ADMIN_PASSWORD = 'os-password';
    process.env.ACESWARM_SEED_STORE_PASSWORD = 'store-password';
    assert.deepEqual(await provision({ osUrl: base, storeUrl: base, manifestPath }), { configured: ['demo'] });
    const published = calls.find((call) => call.pathname.endsWith('/upload-package'));
    assert.equal(published.headers.authorization, 'Bearer secret');
    assert.ok(published.body.includes('manifest_json'));
    const imported = calls.find((call) => call.pathname.endsWith('/config/import'));
    assert.deepEqual(JSON.parse(imported.body), { document, app_store_base_url: base });
    assert.ok(calls.some((call) => call.pathname.endsWith('/operations/op1')));
    assert.equal(calls.filter((call) => call.pathname.includes('/aivuda_os/api/apps/upload')).length, 0);
    fs.writeFileSync(path.join(directory, 'demo.zip'), 'tampered');
    assert.throws(() => verifyArtifact(manifest.apps[0], directory), /hash mismatch/);
  } finally {
    if (previousOs === undefined) delete process.env.ACESWARM_SEED_ADMIN_PASSWORD; else process.env.ACESWARM_SEED_ADMIN_PASSWORD = previousOs;
    if (previousStore === undefined) delete process.env.ACESWARM_SEED_STORE_PASSWORD; else process.env.ACESWARM_SEED_STORE_PASSWORD = previousStore;
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
