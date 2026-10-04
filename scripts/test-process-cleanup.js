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
      const application = await electron.launch({
        args: [path.join(root, 'tests/fixtures/desktop-electron.cjs'), '--no-sandbox'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '', ACESWARM_UI_TEST_PROFILE: path.join(temp, mode, 'profile'),
          ACESWARM_WS_ROOT: path.join(temp, mode, 'workspace'), ACESWARM_GATEWAY_PORT: String(gateway),
          ACESWARM_STORE_GATEWAY_PORT: String(store), ACESWARM_PYTHON: path.join(root, '.venv/bin/python') },
        timeout: 90000,
      });
      const owner = application.process();
      let children = [];
      try {
        const page = await application.firstWindow();
        await page.waitForFunction(() => document.querySelector('#dock .dock-item[data-app-url]'), { timeout: 30000 });
        if (mode === 'SIGKILL') {
          await page.evaluate(() => { screenRecordDetailsExpanded = true; showScreenRecordBar(); });
          await page.locator('[data-screen-record-mode="ffmpeg"]').click();
          await page.locator('[data-start-screen-record]').click();
          await page.waitForFunction(() => screenRecordStatus === 'recording', { timeout: 15000 });
        }
        children = descendants(owner.pid);
        if (mode === 'SIGKILL') assert.ok(children.some((child) => /(?:^|\/)ffmpeg\s/.test(child.command)), 'FFmpeg is running during forced exit');
        const mcp = children.find((child) => child.command.endsWith('/electron/services/mcp-server.js'));
        assert.ok(mcp, 'MCP is running');
        assert.equal(children.filter((child) => child.parent === mcp.pid).length, 0, 'MCP has no Chromium subprocesses');
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
        for (const port of [gateway, store]) await assert.rejects(fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) }));
        console.log(`PASS: ${mode} releases all ${children.length} subprocesses and both gateway ports`);
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
