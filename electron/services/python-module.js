const path = require('node:path');

function pythonModuleArgs(runtime, moduleName, args = []) {
  if (!runtime.packaged) return ['-m', moduleName, ...args];
  // Keep bundled dependencies in this interpreter only, out of app script environments.
  const bootstrap = 'import runpy, sys; sys.path.insert(0, sys.argv.pop(1)); module = sys.argv.pop(1); sys.argv[0] = module; runpy.run_module(module, run_name="__main__", alter_sys=True)';
  return ['-E', '-c', bootstrap, path.join(runtime.resourcesPath, 'python-packages'), moduleName, ...args];
}

module.exports = { pythonModuleArgs };
