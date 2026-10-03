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
    : process.env.ACESWARM_CADDY ?? path.resolve(sourceRoot, 'resources', 'app-gateway', 'caddy');
  if (!python || !path.isAbsolute(python) || !fs.existsSync(python)) {
    throw new Error('Development requires an absolute ACESWARM_PYTHON pointing to the configured Python environment');
  }
  if (!caddy || !path.isAbsolute(caddy) || !fs.existsSync(caddy)) {
    throw new Error('Caddy missing: build with npm run bundle:runtime, or set absolute ACESWARM_CADDY in development');
  }
  const packages = packaged ? path.join(resourcesPath, 'python-packages') : undefined;
  const osRoot = packaged ? packages : path.join(sourceRoot, 'aivudaOS');
  const storeRoot = packaged ? packages : path.join(sourceRoot, 'aivudaAppStore');
  const pythonPath = packaged ? packages : [osRoot, storeRoot].join(path.delimiter);
  for (const [name, root, packageName] of [['AivudaOS', osRoot, 'aivudaos'], ['AppStore', storeRoot, 'aivudaappstore']]) {
    if (!fs.existsSync(path.join(root, packageName))) {
      throw new Error(`${name} source checkout missing under ${root}; initialize git submodules first`);
    }
    if (!fs.existsSync(path.join(root, packageName, 'resources', 'ui', 'dist', 'index.html'))) {
      throw new Error(`${name} UI missing under ${root}; build its independent frontend first`);
    }
  }
  return { python, pythonPath, caddy, packages, osRoot, storeRoot, packaged, resourcesPath };
}
module.exports = { resolveRuntime };
