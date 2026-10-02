const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function verifySeed(entry, directory) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(entry.id) || !/^\d+\.\d+\.\d+/.test(entry.version)) throw new Error('Invalid seed identity/version');
  if (entry.policy !== 'install-if-missing' || typeof entry.artifact !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(`Invalid seed manifest entry: ${entry.id}`);
  const artifact = path.resolve(directory, entry.artifact);
  if (!artifact.startsWith(path.resolve(directory) + path.sep) || !fs.existsSync(artifact) ||
      !fs.realpathSync(artifact).startsWith(fs.realpathSync(directory) + path.sep) || !fs.statSync(artifact).isFile()) {
    throw new Error(`Invalid seed artifact: ${entry.id}`);
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
  if (hash !== entry.sha256) throw new Error(`Seed hash mismatch: ${entry.id}`);
  return artifact;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}

async function provision({ osUrl, paths, manifestPath }) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.apps)) throw new Error('Unsupported seed manifest');
  if (!manifest.apps.length) return;
  for (const entry of manifest.apps) verifySeed(entry, path.dirname(manifestPath));
  const password = process.env.ACESWARM_SEED_ADMIN_PASSWORD;
  if (!password) throw new Error('Set ACESWARM_SEED_ADMIN_PASSWORD to provision seed apps via the public AivudaOS API');
  const login = await requestJson(new URL('aivuda_os/api/auth/login', osUrl), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password }),
  });
  const token = encodeURIComponent(login.access_token);
  const statePath = path.join(paths.state, 'seed-bootstrap.json');
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
  for (const entry of manifest.apps) {
    try {
    const artifact = verifySeed(entry, path.dirname(manifestPath));
    const installed = await requestJson(new URL(`aivuda_os/api/apps/installed?token=${token}`, osUrl));
    const existing = (installed.items || []).find((item) => item.app_id === entry.id);
    if (existing && (existing.versions || []).includes(entry.version)) continue;
    if (existing && entry.policy === 'install-if-missing') continue;
    if (entry.policy !== 'install-if-missing') throw new Error(`Unsupported seed policy for ${entry.id}`);
    const data = new FormData();
    data.append('file', new Blob([fs.readFileSync(artifact)]), path.basename(artifact));
    const result = await requestJson(new URL(`aivuda_os/api/apps/upload?token=${token}`, osUrl), { method: 'POST', body: data });
    let operation;
    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      operation = await requestJson(new URL(`aivuda_os/api/apps/operations/${result.operation_id}?token=${token}`, osUrl));
      if (['completed', 'failed', 'canceled'].includes(operation.status)) break;
    }
    if (operation?.status !== 'completed') throw new Error(`Seed ${entry.id} install ${operation?.status || 'timed out'}: ${operation?.error || ''}`);
    state[entry.id] = { version: entry.version, sha256: entry.sha256, completedAt: new Date().toISOString() };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
    } catch (error) {
      if (entry.required !== false) throw error;
      console.warn(`Optional seed ${entry.id} skipped: ${error.message}`);
    }
  }
}
module.exports = { provision, verifySeed };
