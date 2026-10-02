const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { workspace } = require('../electron/services/workspace');
const { gatewayConfig } = require('../electron/services/gateway');
const { fixed, resolvePage } = require('../electron/services/pages');
const { freePort } = require('../electron/services/local-services');
const { verifySeed } = require('../electron/services/seed');
const { resolveRuntime } = require('../electron/services/runtime');
const { treeDigest } = require('../electron/services/integrity');
const { listItems, createItem } = require('../electron/services/workspace-items');

test('workspace isolates services and persists files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-'));
  const first = workspace(root);
  fs.writeFileSync(path.join(first.state, 'state.json'), '{}');
  assert.equal(workspace(root).os, first.os);
  assert.ok(fs.existsSync(path.join(first.state, 'state.json')));
  fs.rmSync(root, { recursive: true });
});
test('workspace collections create and list persistent folders safely', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-items-'));
  try {
    const paths = workspace(root);
    assert.equal(createItem(paths, 'projects', 'Flight Plan'), 'Flight Plan');
    assert.deepEqual(listItems(paths, 'projects'), ['Flight Plan']);
    assert.deepEqual(listItems(workspace(root), 'projects'), ['Flight Plan']);
    assert.throws(() => createItem(paths, 'projects', '../escape'));
    assert.throws(() => createItem(paths, 'unknown', 'Flight Plan'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('gateway only binds loopback and preserves import markers', () => {
  const config = gatewayConfig({ port: 12345, osPort: 12346, uiRoot: '/tmp/my ui' });
  assert.match(config, /http:\/\/127\.0\.0\.1:12345/);
  assert.match(config, /reverse_proxy 127\.0\.0\.1:12346/);
  assert.match(config, /bind 127\.0\.0\.1/);
  assert.match(config, /BEGIN AIVUDA APP IMPORTS/);
  assert.doesNotMatch(config, /https:|:443|:80\s/);
});
test('gateway regenerates ports and retains installed app imports', () => {
  const { prepareGateway } = require('../electron/services/gateway');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-gateway-'));
  try {
    const paths = workspace(root);
    const source = path.join(root, 'source-caddy');
    fs.writeFileSync(source, 'binary');
    const osRoot = path.join(root, 'os-package');
    fs.mkdirSync(path.join(osRoot, 'aivudaos/resources/ui/dist'), { recursive: true });
    fs.writeFileSync(path.join(osRoot, 'aivudaos/resources/ui/dist/index.html'), 'ui');
    const runtime = { caddy: source, osRoot };
    const first = prepareGateway(paths, runtime, 31111, 31112, 31113);
    fs.writeFileSync(first.config, fs.readFileSync(first.config, 'utf8').replace(
      '    # END AIVUDA APP IMPORTS', '    import "/tmp/demo.ui.caddy"\n    # END AIVUDA APP IMPORTS',
    ));
    prepareGateway(paths, runtime, 32221, 32222, 32223);
    const text = fs.readFileSync(first.config, 'utf8');
    assert.match(text, /import "\/tmp\/demo.ui.caddy"/);
    assert.match(text, /admin 127\.0\.0\.1:32223/);
    assert.match(text, /reverse_proxy 127\.0\.0\.1:32222/);
    assert.doesNotMatch(text, /31111|https:\/\//);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('gateway replaces a running executable without writing to its source', { skip: process.platform !== 'linux' }, async () => {
  const { prepareGateway } = require('../electron/services/gateway');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-gateway-running-'));
  let running;
  try {
    const paths = workspace(root);
    const osRoot = path.join(root, 'os-package');
    const uiRoot = path.join(osRoot, 'aivudaos/resources/ui/dist');
    fs.mkdirSync(uiRoot, { recursive: true });
    fs.writeFileSync(path.join(uiRoot, 'index.html'), 'ui');
    const installed = prepareGateway(paths, { caddy: '/bin/sleep', osRoot }, 31111, 31112, 31113);
    running = spawn(installed.binary, ['30']);
    await new Promise((resolve, reject) => {
      running.once('spawn', resolve);
      running.once('error', reject);
    });
    const replacement = path.join(root, 'read-only-caddy');
    fs.copyFileSync('/bin/true', replacement);
    fs.chmodSync(replacement, 0o444);
    prepareGateway(paths, { caddy: replacement, osRoot }, 32221, 32222, 32223);
    assert.deepEqual(fs.readFileSync(installed.binary), fs.readFileSync(replacement));
    assert.equal(fs.statSync(installed.binary).mode & 0o777, 0o755);
    assert.equal(running.exitCode, null);
  } finally {
    if (running?.exitCode === null) {
      running.kill();
      await new Promise((resolve) => running.once('exit', resolve));
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('registry resolves local, installed and remote pages', () => {
  const endpoints = { os: 'http://127.0.0.1:2/', store: 'http://127.0.0.1:3/', gateway: 'http://127.0.0.1:4' };
  assert.equal(fixed.length, 7);
  assert.equal(resolvePage('settings', endpoints).url, endpoints.os);
  assert.equal(resolvePage('app:demo', endpoints).url, 'http://127.0.0.1:4/demo/ui/');
  assert.equal(resolvePage('robot:https://robot.local', endpoints).url, 'https://robot.local');
  assert.throws(() => resolvePage('app:../x', endpoints));
});
test('free port binds loopback', async () => {
  const port = await freePort();
  assert.ok(port > 0 && port < 65536);
});
test('seed rejects mismatched hashes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-seed-'));
  fs.writeFileSync(path.join(root, 'demo.zip'), 'test');
  assert.throws(() => verifySeed({ id: 'demo', version: '1.0.0', policy: 'install-if-missing', artifact: 'demo.zip', sha256: '0'.repeat(64) }, root), /hash mismatch/);
  fs.rmSync(root, { recursive: true });
});
test('packaged runtime resolves separately shipped Python packages', () => {
  const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-resources-'));
  try {
    for (const file of ['python-runtime/bin/python3', 'caddy', 'python-packages/aivudaos/resources/ui/dist/index.html', 'python-packages/aivudaappstore/resources/ui/dist/index.html']) {
      const target = path.join(resourcesPath, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, '');
    }
    const manifest = { schemaVersion: 1, platform: process.platform, architecture: process.arch,
      artifacts: { python: require('../electron/services/integrity').digest(path.join(resourcesPath, 'python-runtime/bin/python3')),
        caddy: require('../electron/services/integrity').digest(path.join(resourcesPath, 'caddy')) },
      packages: Object.fromEntries(['aivudaos', 'aivudaappstore'].map((name) => [name, {
        sha256: treeDigest(path.join(resourcesPath, 'python-packages', name)),
      }])),
    };
    fs.writeFileSync(path.join(resourcesPath, 'release-manifest.json'), JSON.stringify(manifest));
    const runtime = resolveRuntime({ packaged: true, resourcesPath });
    assert.equal(runtime.osRoot, path.join(resourcesPath, 'python-packages'));
    assert.equal(runtime.storeRoot, runtime.osRoot);
    const resources = require('../package.json').build.extraResources;
    assert.ok(resources.some(({ from, to }) => from === 'resources/python-packages' && to === 'python-packages'));
    fs.writeFileSync(path.join(resourcesPath, 'caddy'), 'tampered');
    assert.throws(() => resolveRuntime({ packaged: true, resourcesPath }), /hash mismatch: caddy/);
  } finally {
    fs.rmSync(resourcesPath, { recursive: true, force: true });
  }
});
test('development resolves both sibling checkouts', () => {
  const python = process.env.ACESWARM_PYTHON;
  const caddy = process.env.ACESWARM_CADDY;
  try {
    process.env.ACESWARM_PYTHON = process.execPath;
    process.env.ACESWARM_CADDY = process.execPath;
    const runtime = resolveRuntime({ packaged: false, sourceRoot: path.resolve(__dirname, '..') });
    assert.equal(runtime.osRoot, path.resolve(__dirname, '../../aivudaOS'));
    assert.equal(runtime.storeRoot, path.resolve(__dirname, '../../aivudaAppStore'));
  } finally {
    if (python === undefined) delete process.env.ACESWARM_PYTHON;
    else process.env.ACESWARM_PYTHON = python;
    if (caddy === undefined) delete process.env.ACESWARM_CADDY;
    else process.env.ACESWARM_CADDY = caddy;
  }
});
test('development uses bundled tools unless explicitly overridden', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-development-'));
  const sourceRoot = path.join(root, 'ACEswarm');
  const python = process.env.ACESWARM_PYTHON;
  const caddy = process.env.ACESWARM_CADDY;
  try {
    for (const file of [
      'ACEswarm/resources/python-runtime/bin/python3',
      'ACEswarm/resources/app-gateway/caddy',
      'aivudaOS/aivudaos/resources/ui/dist/index.html',
      'aivudaAppStore/aivudaappstore/resources/ui/dist/index.html',
    ]) {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, '');
    }
    delete process.env.ACESWARM_PYTHON;
    delete process.env.ACESWARM_CADDY;
    const bundled = resolveRuntime({ packaged: false, sourceRoot });
    assert.equal(bundled.python, path.join(sourceRoot, 'resources/python-runtime/bin/python3'));
    assert.equal(bundled.caddy, path.join(sourceRoot, 'resources/app-gateway/caddy'));
    process.env.ACESWARM_PYTHON = process.execPath;
    process.env.ACESWARM_CADDY = process.execPath;
    const overridden = resolveRuntime({ packaged: false, sourceRoot });
    assert.equal(overridden.python, process.execPath);
    assert.equal(overridden.caddy, process.execPath);
    process.env.ACESWARM_PYTHON = 'relative/python';
    assert.throws(() => resolveRuntime({ packaged: false, sourceRoot }), /Python runtime missing/);
    process.env.ACESWARM_PYTHON = process.execPath;
    process.env.ACESWARM_CADDY = 'relative/caddy';
    assert.throws(() => resolveRuntime({ packaged: false, sourceRoot }), /Caddy missing/);
  } finally {
    if (python === undefined) delete process.env.ACESWARM_PYTHON;
    else process.env.ACESWARM_PYTHON = python;
    if (caddy === undefined) delete process.env.ACESWARM_CADDY;
    else process.env.ACESWARM_CADDY = caddy;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
