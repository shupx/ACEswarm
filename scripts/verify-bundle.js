const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { digest, treeDigest } = require('../electron/services/integrity');
const { discoverSeeds } = require('../electron/services/seed');

const root = path.resolve(__dirname, '..');
const runtime = path.join(root, 'resources', 'python-runtime');
const python = path.join(runtime, 'bin', 'python3');
const caddy = path.join(root, 'resources', 'app-gateway', 'caddy');
const packages = path.join(root, 'resources', 'python-packages');
const lock = require('../resources/runtime-lock.json');
const seedDirectory = path.join(root, 'resources', 'seed-apps');
const seedExport = JSON.parse(fs.readFileSync(path.join(seedDirectory, 'aceswarm-config-export.json'), 'utf8'));
discoverSeeds(seedExport, seedDirectory);
if (process.platform !== 'linux' || process.arch !== lock.architecture) throw new Error('Unsupported release architecture');
for (const file of [python, caddy, path.join(packages, 'aivudaos', 'resources', 'ui', 'dist', 'index.html'), path.join(packages, 'aivudaappstore', 'resources', 'ui', 'dist', 'index.html')]) {
  if (!fs.existsSync(file)) throw new Error(`Missing bundled resource: ${file}; run npm run bundle:runtime`);
}
const environment = { ...process.env };
delete environment.PYTHONHOME;
delete environment.PYTHONPATH;
const importCheck = `import sys, subprocess
sys.path.insert(0, ${JSON.stringify(packages)})
import uvicorn, fastapi, yaml, aivudaos.gateway.main, aivudaappstore.backend.app.app, aivudaos, aivudaappstore
from aivudaos.mcp_server import APIClient as OSClient
from aivudaappstore.mcp_server import APIClient as StoreClient
for client in (OSClient, StoreClient):
    assert callable(getattr(client, 'ensure_token', None)), 'Bundled MCP lacks automatic login; rebuild from updated submodules'
from pathlib import Path
root = Path(${JSON.stringify(packages)}).resolve()
for module in (aivudaos, aivudaappstore):
    assert Path(module.__file__).resolve().is_relative_to(root), module.__file__
subprocess.run(['/bin/sh', '-c', 'python3 -c "import encodings"'], check=True)`;
execFileSync(python, ['-E', '-c', importCheck], { env: { ...environment, AIVUDAOS_EMBEDDED_MODE: '1', AIVUDAOS_WS_ROOT: path.join(runtime, 'verify-os'), AIVUDAAPPSTORE_WS_ROOT: path.join(runtime, 'verify-store') }, stdio: 'pipe' });
fs.rmSync(path.join(runtime, 'verify-os'), { recursive: true, force: true });
fs.rmSync(path.join(runtime, 'verify-store'), { recursive: true, force: true });
const version = (name) => {
  const entry = fs.readdirSync(packages).find((file) => file.startsWith(`${name}-`) && file.endsWith('.dist-info'));
  if (!entry) throw new Error(`Missing distribution metadata: ${name}`);
  return entry.slice(name.length + 1, -'.dist-info'.length);
};
const manifest = {
  schemaVersion: 1, architecture: process.arch, platform: process.platform,
  python: lock.python.version, caddy: lock.caddy.version,
  artifacts: { python: digest(python), caddy: digest(caddy) },
  packages: Object.fromEntries(['aivudaos', 'aivudaappstore'].map((name) => [name, {
    version: version(name), sha256: treeDigest(path.join(packages, name)),
  }])),
  workspaceSchema: 1,
};
fs.writeFileSync(path.join(root, 'resources', 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Verified independent packages, UI resources, ASGI imports, Caddy and architecture');
