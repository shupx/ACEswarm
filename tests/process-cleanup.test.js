const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { LocalServices } = require('../electron/services/local-services');

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function waitUntil(check, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Process cleanup timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('service shutdown is idempotent and waits for SIGKILL of an unresponsive service', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-cleanup-'));
  const manager = new LocalServices({ logs: root }, {});
  try {
    const child = manager.launch('stubborn', process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"]);
    await once(child.stdout, 'data');
    const first = manager.stop();
    assert.equal(manager.stop(), first);
    await first;
    assert.equal(child.signalCode, 'SIGKILL');
    assert.equal(alive(child.pid), false);
    assert.equal(alive(manager.guardian.pid), false);
    assert.throws(() => manager.launch('late', process.execPath, []), /shutting down/);
  } finally { await manager.stop(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('guardian cleans service groups when the owner is killed without exit hooks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-crash-'));
  const modulePath = require.resolve('../electron/services/local-services');
  const owner = spawn(process.execPath, ['-e', `
    const { LocalServices } = require(${JSON.stringify(modulePath)});
    const manager = new LocalServices({ logs: ${JSON.stringify(root)} }, {});
    const child = manager.launch('service', process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    child.once('spawn', () => console.log(JSON.stringify({ service: child.pid, guardian: manager.guardian.pid })));
  `], { stdio: ['ignore', 'pipe', 'inherit'] });
  let pids;
  try {
    const [data] = await once(owner.stdout, 'data');
    pids = JSON.parse(data.toString());
    const exited = once(owner, 'exit');
    owner.kill('SIGKILL');
    await exited;
    await waitUntil(() => !alive(pids.service));
    await waitUntil(() => !alive(pids.guardian));
  } finally {
    owner.kill('SIGKILL');
    if (pids) for (const pid of Object.values(pids)) { try { process.kill(-pid, 'SIGKILL'); } catch (_) {} }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('shutdown removes descendants even after the process group leader exits', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-descendant-'));
  const manager = new LocalServices({ logs: root }, {});
  let descendant;
  try {
    const child = manager.launch('leader', process.execPath, ['-e', `
      const { spawn } = require('node:child_process');
      const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] });
      child.stdout.once('data', () => console.log(child.pid));
    `]);
    const [data] = await once(child.stdout, 'data');
    descendant = Number(data.toString().trim());
    await manager.stop();
    await waitUntil(() => !alive(descendant));
    assert.equal(alive(child.pid), false);
    assert.deepEqual(manager.failures, []);
  } finally {
    await manager.stop();
    if (descendant && alive(descendant)) process.kill(descendant, 'SIGKILL');
    fs.rmSync(root, { recursive: true, force: true });
  }
});
