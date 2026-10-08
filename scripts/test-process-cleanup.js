const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');
const { freePort } = require('../electron/services/local-services');

const root = path.resolve(__dirname, '..');
function descendants(owner) {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' }).trim().split('\n')
    .map((line) => { const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return { pid: Number(match[1]), parent: Number(match[2]), command: match[3] }; });
  const pids = new Set([owner]);
  let previous;
  do { previous = pids.size; for (const row of rows) if (pids.has(row.parent)) pids.add(row.pid); } while (previous !== pids.size);
  return rows.filter((row) => row.pid !== owner && pids.has(row.pid));
}
function running(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0] !== 'Z';
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
async function run() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aceswarm-exit-'));
  try {
    for (const mode of ['close', 'system-quit', 'SIGTERM', 'SIGKILL']) {
      const gateway = await freePort();
      const store = await freePort();
      const osMcp = await freePort();
      const storeMcp = await freePort();
      const browserMcp = await freePort();
      const startupErrorFile = path.join(temp, mode, 'startup-error.txt');
      const application = await electron.launch({
        args: [path.join(root, 'tests/fixtures/desktop-electron.cjs'), '--no-sandbox'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '', ACESWARM_UI_TEST_PROFILE: path.join(temp, mode, 'profile'),
          ACESWARM_WS_ROOT: path.join(temp, mode, 'workspace'), ACESWARM_GATEWAY_PORT: String(gateway),
          ACESWARM_UI_TEST_STARTUP_ERROR: startupErrorFile,
          ACESWARM_STORE_GATEWAY_PORT: String(store), ACESWARM_CDP_PORT: '0', ACESWARM_PYTHON: path.join(root, '.venv/bin/python'),
          AIVUDAOS_MCP_PORT: String(osMcp), AIVUDAAPPSTORE_MCP_PORT: String(storeMcp),
          ACESWARM_MCP_PORT: String(browserMcp) },
        timeout: 90000,
      });
      const owner = application.process();
      let children = [];
      try {
        const page = await application.firstWindow().catch(error => {
          if (fs.existsSync(startupErrorFile)) throw new Error(fs.readFileSync(startupErrorFile, 'utf8'));
          throw error;
        });
        await page.waitForFunction(() => document.querySelector('#dock') &&
          typeof isRestoringShellState !== 'undefined' && !isRestoringShellState, { timeout: 30000 });
        const discoveryFile = path.join(temp, mode, 'workspace/state/agent-connection.json');
        const discoveryDeadline = Date.now() + 10000;
        while (!fs.existsSync(discoveryFile) && Date.now() < discoveryDeadline) await new Promise(resolve => setTimeout(resolve, 50));
        const discovery = JSON.parse(fs.readFileSync(discoveryFile));
        if (mode === 'SIGKILL') {
          await page.evaluate(() => { screenRecordDetailsExpanded = true; showScreenRecordBar(); });
          await page.locator('[data-screen-record-mode="ffmpeg"]').click();
          await page.locator('[data-start-screen-record]').click();
          await page.waitForFunction(() => screenRecordStatus === 'recording', { timeout: 15000 });
        }
        // Exercise an actual Popen app, including a child that escapes its
        // parent's session. Service-only cleanup previously missed both.
        const packageDir = path.join(temp, mode, 'fixture-app');
        fs.mkdirSync(packageDir, { recursive: true });
        fs.writeFileSync(path.join(packageDir, 'manifest.yaml'), `app_id: cleanup_fixture
name: Cleanup fixture
version: 1.0.0
run:
  entrypoint: start.sh
default_config_path: config.yaml
config_schema_path: schema.yaml
`);
        fs.writeFileSync(path.join(packageDir, 'config.yaml'), '{}\n');
        fs.writeFileSync(path.join(packageDir, 'schema.yaml'), 'type: object\n');
        fs.writeFileSync(path.join(packageDir, 'start.sh'), `#!/usr/bin/env bash
exec python3 -c 'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c","import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(300)"],start_new_session=True); time.sleep(300)'
`, { mode: 0o755 });
        const archive = path.join(temp, mode, 'fixture.tar.gz');
        execFileSync('tar', ['-czf', archive, '-C', packageDir, '.']);
        const base = `http://127.0.0.1:${gateway}/aivuda_os/api`;
        const login = await (await fetch(`${base}/auth/login`, { method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'admin123' }) })).json();
        async function request(route, options = {}) {
          const response = await fetch(`${base}${route}?token=${encodeURIComponent(login.access_token)}`, options);
          const result = await response.json();
          assert.ok(response.ok, JSON.stringify(result));
          return result;
        }
        async function operation(job) {
          const deadline = Date.now() + 15000;
          while (Date.now() < deadline) {
            const result = await request(`/apps/operations/${job.operation_id}`);
            if (result.done) { assert.equal(result.status, 'completed', JSON.stringify(result)); return; }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          assert.fail('Fixture operation timed out');
        }
        const form = new FormData();
        form.append('file', new Blob([fs.readFileSync(archive)], { type: 'application/gzip' }), 'fixture.tar.gz');
        await operation(await request('/apps/upload', { method: 'POST', body: form }));
        await operation(await request('/apps/cleanup_fixture/start', { method: 'POST' }));
        await new Promise(resolve => setTimeout(resolve, 500));
        children = descendants(owner.pid);
        const fixtureStatus = await request('/apps/cleanup_fixture/status');
        assert.ok(fixtureStatus.runtime.running, 'Installed Popen fixture is running');
        assert.ok(children.some(child => child.pid === fixtureStatus.runtime.pid), 'Popen fixture is included in cleanup verification');
        assert.ok(children.some(child => /SIG_IGN.*time.sleep\(300\)/.test(child.command)), 'Detached stubborn fixture child is running');
        if (mode === 'SIGKILL') assert.ok(children.some((child) => /(?:^|\/)ffmpeg\s/.test(child.command)), 'FFmpeg is running during forced exit');
        const mcps = children.filter((child) => / -m (aivudaos|aivudaappstore)\.mcp_server$/.test(child.command));
        assert.equal(mcps.length, 2, 'Both package MCP servers are running');
        assert.equal(children.filter(child => /electron\/services\/browser-mcp\.js/.test(child.command)).length, 1,
          'Bundled Playwright HTTP MCP is running');
        assert.equal(discovery.mcpUrl, `http://127.0.0.1:${browserMcp}/mcp`);
        for (const port of [osMcp, storeMcp]) {
          const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
          assert.equal(health.transport, 'streamable-http');
        }
        assert.equal(children.some((child) => /electron\/(backend\/server|services\/mcp-server)\.js/.test(child.command)), false, 'No ACEswarm control or MCP process is running');
        for (const mcp of mcps) assert.equal(children.filter((child) => child.parent === mcp.pid).length, 0, 'Python MCP has no subprocesses');
        if (mode === 'close') await application.close();
        else {
          const exited = new Promise((resolve) => owner.once('exit', resolve));
          if (mode === 'system-quit') {
            await page.locator('#tools-button').click();
            await page.locator('#system-quit').click();
          } else owner.kill(mode);
          await exited;
        }
        const deadline = Date.now() + 12000;
        while (children.some((child) => running(child.pid)) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
        assert.deepEqual(children.filter((child) => running(child.pid)), [], `${mode} left running processes`);
        for (const port of [gateway, store, osMcp, storeMcp, browserMcp]) await assert.rejects(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }));
        await assert.rejects(fetch(`${discovery.cdpEndpoint}/json/version`, { signal: AbortSignal.timeout(1000) }));
        if (mode !== 'SIGKILL') assert.equal(fs.existsSync(discoveryFile), false);
        console.log(`PASS: ${mode} releases all ${children.length} subprocesses, gateway and CDP ports`);
      } finally {
        if (running(owner.pid)) await application.close();
        for (const child of children) if (running(child.pid)) {
          try { process.kill(child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
        }
      }
    }
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
