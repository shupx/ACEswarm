const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { provision, provisionOnce, discoverSeeds, verifyArtifact } = require('../electron/services/seed');

const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

test('seed publication uses the AppStore API and queues the canonical config export', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-bootstrap-'));
  const archive = Buffer.from('package-content');
  const document = { format_version: 1, payload: { system_parameters: { feature: true }, apps: [
    { app_id: 'demo', version: '1.0.0', parameters: { port: 10 }, autostart: true, running: true },
  ] }, aceswarm: { packages: [{ artifact: 'packages/demo.zip', sha256: digest(archive) }] } };
  fs.mkdirSync(path.join(directory, 'packages'));
  fs.writeFileSync(path.join(directory, 'packages/demo.zip'), archive);
  const configPath = path.join(directory, 'aceswarm-config-export.json');
  fs.writeFileSync(configPath, JSON.stringify(document));
  const calls = [];
  let parsedVersion = '1.0.0';
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
    } else if (url.pathname.endsWith('/manifest/parse-package')) body = { manifest: { app_id: 'demo', version: parsedVersion, name: 'Demo', description: 'Example' } };
    else if (url.pathname === '/aivuda_app_store/store/apps/demo') { response.statusCode = 404; body = { detail: 'missing' }; }
    else if (url.pathname.endsWith('/upload-package')) body = { app_id: 'demo', version: '1.0.0', status: 'published' };
    else if (url.pathname.endsWith('/config/import')) body = { operation_id: 'op1', status: 'queued' };
    else if (url.pathname.endsWith('/operations/op1')) body = { status: 'completed', result: { configured: ['demo'] } };
    else { response.statusCode = 404; body = { detail: 'unknown' }; }
    response.end(JSON.stringify(body));
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/`;
    const stateDirectory = path.join(directory, 'state');
    assert.deepEqual(await provisionOnce({ stateDirectory, osUrl: base, storeUrl: base, configPath }), { configured: ['demo'] });
    assert.equal(JSON.parse(fs.readFileSync(path.join(stateDirectory, 'seed-bootstrap.json'))).status, 'completed');
    const osLogin = calls.find((call) => call.pathname.endsWith('/aivuda_os/api/auth/login'));
    assert.deepEqual(JSON.parse(osLogin.body), { username: 'admin', password: 'admin123' });
    const storeLogin = calls.find((call) => call.pathname.endsWith('/aivuda_app_store/dev/auth/login'));
    assert.match(storeLogin.body, /admin123/);
    const published = calls.find((call) => call.pathname.endsWith('/upload-package'));
    assert.equal(published.headers.authorization, 'Bearer secret');
    assert.ok(published.body.includes('manifest_json'));
    const imported = calls.find((call) => call.pathname.endsWith('/config/import'));
    assert.deepEqual(JSON.parse(imported.body), { document, app_store_base_url: base });
    assert.ok(calls.some((call) => call.pathname.endsWith('/operations/op1')));
    assert.equal(calls.filter((call) => call.pathname.includes('/aivuda_os/api/apps/upload')).length, 0);
    parsedVersion = '2.0.0';
    const requests = calls.length;
    assert.deepEqual(await provisionOnce({ stateDirectory, existingOsWorkspace: true, osUrl: base, storeUrl: base, configPath: 'changed-or-missing-export.json' }), { skipped: true, reason: 'initialized' });
    assert.equal(calls.length, requests, 'restart never republishes, reinstalls, switches versions or resets configuration');
    const retryState = path.join(directory, 'retry-state');
    await assert.rejects(provisionOnce({ stateDirectory: retryState, osUrl: base, storeUrl: base, configPath }), /identity mismatch/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(retryState, 'seed-bootstrap.json'))).status, 'pending');
    parsedVersion = '1.0.0';
    assert.deepEqual(await provisionOnce({ stateDirectory: retryState, existingOsWorkspace: true, osUrl: base, storeUrl: base, configPath }), { configured: ['demo'] });
    parsedVersion = '2.0.0';
    const imports = calls.filter((call) => call.pathname.endsWith('/config/import')).length;
    await assert.rejects(provision({ osUrl: base, storeUrl: base, configPath }), /identity mismatch/);
    assert.equal(calls.filter((call) => call.pathname.endsWith('/config/import')).length, imports);
    fs.writeFileSync(path.join(directory, 'packages/demo.zip'), 'tampered');
    assert.throws(() => verifyArtifact(document.aceswarm.packages[0], directory), /hash mismatch/);
    await assert.rejects(provision({ osUrl: base, storeUrl: base, configPath }), /hash mismatch/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('existing workspaces migrate without bootstrap and invalid state never triggers installation', async () => {
  const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-seed-state-'));
  try {
    const options = { stateDirectory, existingOsWorkspace: true, configPath: 'missing.json' };
    assert.deepEqual(await provisionOnce(options), { skipped: true, reason: 'existing-workspace' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(stateDirectory, 'seed-bootstrap.json'))).status, 'completed');
    assert.deepEqual(await provisionOnce(options), { skipped: true, reason: 'existing-workspace' });
    fs.writeFileSync(path.join(stateDirectory, 'seed-bootstrap.json'), 'null');
    await assert.rejects(provisionOnce(options), /Invalid seed bootstrap state/);
    fs.writeFileSync(path.join(stateDirectory, 'seed-bootstrap.json'), '{bad json');
    await assert.rejects(provisionOnce(options), SyntaxError);
  } finally { fs.rmSync(stateDirectory, { recursive: true, force: true }); }
});

test('discovery rejects unlisted, missing, escaped and symlinked archives', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-seeds-'));
  const packages = path.join(directory, 'packages');
  const archive = Buffer.from('archive');
  const document = { format_version: 1, payload: { apps: [{ app_id: 'demo', version: '1.0.0' }] },
    aceswarm: { packages: [{ artifact: 'packages/demo.zip', sha256: digest(archive) }] } };
  try {
    fs.mkdirSync(packages);
    fs.writeFileSync(path.join(packages, 'demo.zip'), archive);
    assert.equal(discoverSeeds(document, directory).size, 1);
    fs.writeFileSync(path.join(packages, 'extra.zip'), archive);
    assert.throws(() => discoverSeeds(document, directory), /do not match/);
    fs.rmSync(path.join(packages, 'extra.zip'));
    document.aceswarm.packages[0].artifact = '../outside.zip';
    assert.throws(() => discoverSeeds(document, directory), /metadata/);
    document.aceswarm.packages[0].artifact = 'packages/demo.zip';
    fs.rmSync(path.join(packages, 'demo.zip'));
    assert.throws(() => discoverSeeds(document, directory), /Invalid seed artifact/);
    fs.symlinkSync(path.join(directory, 'outside.zip'), path.join(packages, 'demo.zip'));
    fs.writeFileSync(path.join(directory, 'outside.zip'), archive);
    assert.throws(() => discoverSeeds(document, directory), /Invalid seed artifact/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('bundled config export matches all staged archive hashes', () => {
  const directory = path.resolve(__dirname, '../resources/seed-apps');
  const document = JSON.parse(fs.readFileSync(path.join(directory, 'aceswarm-config-export.json')));
  assert.equal(discoverSeeds(document, directory).size, document.payload.apps.length);
});
