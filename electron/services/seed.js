const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function verifyArtifact(entry, directory) {
  if (!entry || typeof entry.artifact !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid seed artifact metadata');
  const artifact = path.resolve(directory, entry.artifact);
  if (!artifact.startsWith(path.resolve(directory) + path.sep) || !fs.existsSync(artifact) ||
      !fs.realpathSync(artifact).startsWith(fs.realpathSync(directory) + path.sep) || !fs.statSync(artifact).isFile()) {
    throw new Error(`Invalid seed artifact: ${entry.artifact}`);
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
  if (hash !== entry.sha256) throw new Error(`Seed hash mismatch: ${entry.artifact}`);
  return artifact;
}

function verifySeed(entry, directory) {
  if (!entry || !/^[a-zA-Z0-9_.-]+$/.test(entry.id) || !/^\d+\.\d+\.\d+/.test(entry.version)) throw new Error('Invalid seed identity/version');
  if (entry.policy !== 'install-if-missing' || (entry.required !== undefined && typeof entry.required !== 'boolean')) throw new Error(`Invalid seed policy: ${entry.id}`);
  return verifyArtifact(entry, directory);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const error = new Error(`${url}: HTTP ${response.status} ${await response.text()}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function packageForm(artifact) {
  const data = new FormData();
  data.append('package_zip', new Blob([fs.readFileSync(artifact)]), path.basename(artifact));
  return data;
}

async function publishSeed(entry, artifact, storeUrl, authorization) {
  const base = new URL('aivuda_app_store/', storeUrl);
  const downloadUrl = new URL(`store/apps/${encodeURIComponent(entry.id)}/versions/${encodeURIComponent(entry.version)}/download-url`, base);
  try {
    await requestJson(downloadUrl);
    return;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const parsed = await requestJson(new URL('dev/apps/manifest/parse-package', base), {
    method: 'POST', headers: { Authorization: authorization }, body: packageForm(artifact),
  });
  const manifest = parsed.manifest;
  if (manifest?.app_id !== entry.id || String(manifest?.version) !== entry.version) throw new Error(`Seed package identity mismatch: ${entry.id}`);
  const data = packageForm(artifact);
  data.set('manifest_json', JSON.stringify(manifest));
  const detailUrl = new URL(`store/apps/${encodeURIComponent(entry.id)}`, base);
  let exists = false;
  try { await requestJson(detailUrl); exists = true; } catch (error) { if (error.status !== 404) throw error; }
  const endpoint = exists ? `dev/apps/${encodeURIComponent(entry.id)}/versions` : 'dev/apps/upload-package';
  const result = await requestJson(new URL(endpoint, base), {
    method: 'POST', headers: { Authorization: authorization }, body: data,
  });
  if (result.app_id !== entry.id || result.version !== entry.version || result.status !== 'published') throw new Error(`Seed publishing failed: ${entry.id}`);
  await requestJson(downloadUrl);
}

async function provision({ osUrl, storeUrl, manifestPath }) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.apps)) throw new Error('Unsupported seed manifest');
  if (!manifest.configExport && !manifest.apps.length) return;
  if (!manifest.configExport) throw new Error('Seed configExport is required for seed apps');
  const directory = path.dirname(manifestPath);
  const configPath = verifyArtifact(manifest.configExport, directory);
  const document = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (document.format_version !== 1 || !Array.isArray(document.payload?.apps)) throw new Error('Invalid AivudaOS config export');
  const ids = new Set();
  for (const entry of manifest.apps) {
    verifySeed(entry, directory);
    if (ids.has(entry.id) || !document.payload.apps.some((item) => item.app_id === entry.id && item.version === entry.version)) throw new Error(`Seed missing from config export: ${entry.id}`);
    ids.add(entry.id);
  }
  if (document.payload.apps.some((item) => !ids.has(item.app_id))) throw new Error('Config export references an unstaged seed app');
  const password = process.env.ACESWARM_SEED_ADMIN_PASSWORD;
  const storePassword = process.env.ACESWARM_SEED_STORE_PASSWORD;
  if (!password || (manifest.apps.length && !storePassword)) throw new Error('Set ACESWARM_SEED_ADMIN_PASSWORD and ACESWARM_SEED_STORE_PASSWORD for seed provisioning');
  const osLogin = await requestJson(new URL('aivuda_os/api/auth/login', osUrl), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password }),
  });
  if (manifest.apps.length) {
    const storeForm = new FormData();
    storeForm.set('username', 'admin'); storeForm.set('password', storePassword);
    const storeLogin = await requestJson(new URL('aivuda_app_store/dev/auth/login', storeUrl), { method: 'POST', body: storeForm });
    const authorization = `Bearer ${storeLogin.access_token}`;
    const skipped = new Set();
    for (const entry of manifest.apps) {
      try { await publishSeed(entry, verifySeed(entry, directory), storeUrl, authorization); } catch (error) {
        if (entry.required !== false) throw error;
        skipped.add(entry.id);
        console.warn(`Optional seed ${entry.id} skipped: ${error.message}`);
      }
    }
    if (skipped.size) document.payload.apps = document.payload.apps.filter((item) => !skipped.has(item.app_id));
  }
  const token = encodeURIComponent(osLogin.access_token);
  const queued = await requestJson(new URL(`aivuda_os/api/config/import?token=${token}`, osUrl), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document, app_store_base_url: storeUrl }),
  });
  let operation;
  for (let attempt = 0; attempt < 600; attempt++) {
    operation = await requestJson(new URL(`aivuda_os/api/apps/operations/${encodeURIComponent(queued.operation_id)}?token=${token}`, osUrl));
    if (['completed', 'failed', 'canceled'].includes(operation.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (operation?.status !== 'completed') throw new Error(`Config import ${operation?.status || 'timed out'}: ${operation?.error || ''}`);
  return operation.result;
}

module.exports = { provision, verifySeed, verifyArtifact, publishSeed };
