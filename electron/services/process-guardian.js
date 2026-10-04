const readline = require('node:readline');

// The pipe closes even when Electron crashes or is killed without running hooks.
const groups = new Set();
const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  if (line.startsWith('remove ')) { groups.delete(Number(line.slice(7))); return; }
  const pid = Number(line);
  if (Number.isSafeInteger(pid) && Math.abs(pid) > 1) groups.add(pid);
});
function signal(signalName) {
  for (const pid of groups) {
    try { process.kill(-pid, signalName); } catch (_) { /* already stopped */ }
  }
}
input.on('close', () => {
  signal('SIGCONT');
  signal('SIGTERM');
  setTimeout(() => { signal('SIGKILL'); process.exit(0); }, 5000);
});
