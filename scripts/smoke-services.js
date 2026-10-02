const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { workspace } = require('../electron/services/workspace');
const { resolveRuntime } = require('../electron/services/runtime');
const { LocalServices } = require('../electron/services/local-services');

async function run() {
  const sourceRoot = path.resolve(__dirname, '..');
  const resourcesPath = process.env.ACESWARM_RESOURCES;
  const runtime = resolveRuntime({ packaged: Boolean(resourcesPath), resourcesPath, sourceRoot });
  const paths = workspace(path.join(sourceRoot, '.smoke'));
  fs.writeFileSync(path.join(paths.state, 'persistence-check'), 'kept');
  for (let attempt = 0; attempt < 2; attempt++) {
    const manager = new LocalServices(paths, runtime);
    try {
      const endpoints = await manager.start();
      for (const url of [endpoints.os, endpoints.store, `${endpoints.gateway}/`]) {
        const response = await fetch(url);
        assert.equal(response.status, 200, url);
        assert.match(await response.text(), /<html/i, url);
      }
      const gatewayApi = await fetch(`${endpoints.gateway}/aivuda_os/api/auth/me`);
      assert.notEqual(gatewayApi.status, 502);
      execFileSync(path.join(paths.os, '.tools/caddy/caddy'), ['reload', '--config', path.join(paths.os, 'config/Caddyfile')]);
      assert.equal((await fetch(`${endpoints.gateway}/`)).status, 200);
      assert.equal(fs.readFileSync(path.join(paths.state, 'persistence-check'), 'utf8'), 'kept');
      console.log(`Pass ${attempt + 1}: OS, Store, gateway and gateway reload on ${JSON.stringify(endpoints)}`);
    } finally {
      await manager.stop();
      assert.deepEqual(manager.failures, []);
    }
  }
  console.log('Two clean startups and shutdowns; workspace survives restart');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
