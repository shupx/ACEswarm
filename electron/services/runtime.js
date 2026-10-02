const fs = require('node:fs');
const path = require('node:path');
const { verifyRelease } = require('./integrity');

function resolveRuntime({ packaged, resourcesPath, sourceRoot }) {
  if (process.platform !== 'linux') throw new Error('ACEswarm currently supports Linux only');
  if (packaged) verifyRelease(resourcesPath);
  const python = packaged
    ? path.join(resourcesPath, 'python-runtime', 'bin', 'python3')
    : process.env.ACESWARM_PYTHON;
  const caddy = packaged
    ? path.join(resourcesPath, 'caddy')
    : process.env.ACESWARM_CADDY;
  if (!python || !path.isAbsolute(python) || !fs.existsSync(python)) {
    throw new Error('Python runtime missing: build with npm run bundle:runtime, or set absolute ACESWARM_PYTHON in development');
  }
  if (!caddy || !path.isAbsolute(caddy) || !fs.existsSync(caddy)) {
    throw new Error('Caddy missing: build with npm run bundle:runtime, or set absolute ACESWARM_CADDY in development');
  }
  const packages = packaged ? path.join(resourcesPath, 'python-packages') : path.resolve(sourceRoot, 'resources', 'python-packages');
  const osRoot = packaged ? packages : path.resolve(process.env.ACESWARM_OS_ROOT || path.resolve(sourceRoot, '../aivudaOS'));
  const storeRoot = packaged ? packages : path.resolve(process.env.ACESWARM_STORE_ROOT || path.resolve(sourceRoot, '../aivudaAppStore'));
  if (!packaged && (!fs.existsSync(path.join(osRoot, 'aivudaos')) || !fs.existsSync(path.join(storeRoot, 'aivudaappstore')))) {
    throw new Error('Development requires sibling aivudaOS and aivudaAppStore checkouts');
  }
  for (const [name, root, packageName] of [['AivudaOS', osRoot, 'aivudaos'], ['AppStore', storeRoot, 'aivudaappstore']]) {
    if (!fs.existsSync(path.join(root, packageName, 'resources', 'ui', 'dist', 'index.html'))) {
      throw new Error(`${name} UI missing under ${root}; build its independent frontend first`);
    }
  }
  return { python, caddy, packages, osRoot, storeRoot, packaged, resourcesPath };
}
module.exports = { resolveRuntime };
