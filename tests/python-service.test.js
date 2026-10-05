const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { LocalServices } = require('../electron/services/local-services');
const { pythonModuleArgs } = require('../electron/services/python-module');

test('packaged service imports private packages while app scripts use clean system Python', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-python-service-'));
  const packages = path.join(root, 'python-packages');
  fs.mkdirSync(packages);
  fs.writeFileSync(path.join(packages, 'probe.py'), `import json, os, subprocess, sys
assert sys.argv[1:] == ['--probe', 'value with spaces'], sys.argv
assert 'PYTHONHOME' not in os.environ
assert 'PYTHONPATH' not in os.environ
output = subprocess.check_output(['/bin/sh', '-c', 'python3 -c "import encodings; print(123)"'], text=True)
assert output.strip() == '123', output
print('clean app Python', flush=True)
`);
  const bundledPython = path.resolve(__dirname, '../resources/python-runtime/bin/python3');
  const runtime = { packaged: true, resourcesPath: root };
  const services = new LocalServices({ logs: root }, runtime);
  try {
    const child = services.launch('probe', fs.existsSync(bundledPython) ? bundledPython : 'python3',
      pythonModuleArgs(runtime, 'probe', ['--probe', 'value with spaces']),
      { PYTHONHOME: '/invalid/bundled/home', PYTHONPATH: '/invalid/bundled/packages' });
    let output = '';
    let errors = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { errors += data; });
    const [code] = await once(child, 'close');
    assert.equal(code, 0, errors);
    assert.match(output, /clean app Python/);
  } finally {
    await services.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('development keeps module launch arguments', () => {
  assert.deepEqual(pythonModuleArgs({ packaged: false }, 'uvicorn', ['--port', '1234']), ['-m', 'uvicorn', '--port', '1234']);
});
