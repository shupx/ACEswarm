const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { verifyRelease } = require('./integrity');

function packageRoots(python) {
  const script = [
    'import importlib, json, pathlib',
    'result = {}',
    'for name in ("aivudaos", "aivudaappstore"):',
    '    module = importlib.import_module(name)',
    '    result[name] = str(pathlib.Path(module.__file__).resolve().parent.parent)',
    'print(json.dumps(result))',
  ].join('\n');
  try {
    return JSON.parse(execFileSync(python, ['-c', script], {
      env: { ...process.env, PYTHONPATH: '' },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }));
  } catch (error) {
    throw new Error(`Development Python environment must provide aivudaos and aivudaappstore: ${error.stderr?.trim() || error.message}`);
  }
}

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
    throw new Error('Development requires an absolute ACESWARM_PYTHON pointing to the Python environment containing the published packages');
  }
  if (!caddy || !path.isAbsolute(caddy) || !fs.existsSync(caddy)) {
    throw new Error('Caddy missing: build with npm run bundle:runtime, or set absolute ACESWARM_CADDY in development');
  }
  const packages = packaged ? path.join(resourcesPath, 'python-packages') : undefined;
  const roots = packaged ? { aivudaos: packages, aivudaappstore: packages } : packageRoots(python);
  const osRoot = roots.aivudaos;
  const storeRoot = roots.aivudaappstore;
  for (const [name, root, packageName] of [['AivudaOS', osRoot, 'aivudaos'], ['AppStore', storeRoot, 'aivudaappstore']]) {
    if (!fs.existsSync(path.join(root, packageName, 'resources', 'ui', 'dist', 'index.html'))) {
      throw new Error(`${name} UI missing under ${root}; build its independent frontend first`);
    }
  }
  return { python, caddy, packages, osRoot, storeRoot, packaged, resourcesPath };
}
module.exports = { resolveRuntime };
