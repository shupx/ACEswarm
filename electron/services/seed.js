const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Embedded AivudaOS and AivudaAppStore initialize their local admin accounts
// with this development/embedded default. Seed bootstrap is intentionally
// self-contained so launching an AppImage does not require shell variables.
const DEFAULT_ADMIN_PASSWORD = 'admin123';

function verifyArtifact(entry, directory) {
  if (!entry || typeof entry.artifact !== 'string' || !/^packages\/[^/\\]+\.(?:zip|tar|tar\.gz|tgz|tar\.xz|txz)$/.test(entry.artifact) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid seed artifact metadata');
  const artifact = path.resolve(directory, entry.artifact);
  if (!artifact.startsWith(path.resolve(directory, 'packages') + path.sep) || !fs.existsSync(artifact) ||
      !fs.realpathSync(artifact).startsWith(fs.realpathSync(path.join(directory, 'packages')) + path.sep) || !fs.statSync(artifact).isFile()) {
    throw new Error(`Invalid seed artifact: ${entry.artifact}`);
  }
  const hash = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
  if (hash !== entry.sha256) throw new Error(`Seed hash mismatch: ${entry.artifact}`);
  return artifact;
}

function discoverSeeds(document, directory) {
  if (document.format_version !== 1 || !Array.isArray(document.payload?.apps) || !Array.isArray(document.aceswarm?.packages)) throw new Error('Invalid AivudaOS config export');
  const packageDirectory = path.join(directory, 'packages');
  if (!fs.statSync(packageDirectory).isDirectory() || fs.realpathSync(packageDirectory) !== path.resolve(packageDirectory)) throw new Error('Invalid seed packages directory');
  const archives = fs.readdirSync(packageDirectory).filter((name) => /\.(?:zip|tar|tar\.gz|tgz|tar\.xz|txz)$/.test(name));
  const entries = new Map();
  for (const entry of document.aceswarm.packages) {
    if (!entry || entries.has(entry.artifact)) throw new Error('Duplicate or invalid seed artifact');
    entries.set(entry.artifact, verifyArtifact(entry, directory));
  }
  if (entries.size !== archives.length || archives.some((name) => !entries.has(`packages/${name}`))) throw new Error('Seed archives do not match config export');
  const ids = new Set();
  for (const item of document.payload.apps) {
    if (!item || typeof item.app_id !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(item.app_id) || item.app_id === '.' || item.app_id === '..' ||
        typeof item.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9_.-]+)?$/.test(item.version) || ids.has(item.app_id)) throw new Error('Invalid or duplicate seed app in config export');
    ids.add(item.app_id);
  }
  if (ids.size !== entries.size) throw new Error('Seed package count does not match config export');
  return entries;
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

async function parseSeed(artifact, storeUrl, authorization) {
  const base = new URL('aivuda_app_store/', storeUrl);
  const parsed = await requestJson(new URL('dev/apps/manifest/parse-package', base), {
    method: 'POST', headers: { Authorization: authorization }, body: packageForm(artifact),
  });
  return parsed.manifest;
}

async function publishSeed(entry, artifact, manifest, storeUrl, authorization) {
  const base = new URL('aivuda_app_store/', storeUrl);
  const downloadUrl = new URL(`store/apps/${encodeURIComponent(entry.id)}/versions/${encodeURIComponent(entry.version)}/download-url`, base);
  try {
    await requestJson(downloadUrl);
    return;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
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

async function provision({ osUrl, storeUrl, configPath }) {
  const directory = path.dirname(configPath);
  if (!fs.statSync(configPath).isFile() || fs.realpathSync(configPath) !== path.resolve(configPath)) throw new Error('Invalid seed config export');
  const document = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const artifacts = discoverSeeds(document, directory);
  const osLogin = await requestJson(new URL('aivuda_os/api/auth/login', osUrl), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: DEFAULT_ADMIN_PASSWORD }),
  });
  if (artifacts.size) {
    const storeForm = new FormData();
    storeForm.set('username', 'admin'); storeForm.set('password', DEFAULT_ADMIN_PASSWORD);
    const storeLogin = await requestJson(new URL('aivuda_app_store/dev/auth/login', storeUrl), { method: 'POST', body: storeForm });
    const authorization = `Bearer ${storeLogin.access_token}`;
    const expected = new Map(document.payload.apps.map((item) => [item.app_id, item.version]));
    const seeds = [];
    for (const artifact of artifacts.values()) {
      const manifest = await parseSeed(artifact, storeUrl, authorization);
      const id = manifest?.app_id;
      const version = String(manifest?.version);
      if (expected.get(id) !== version || seeds.some((seed) => seed.id === id)) throw new Error(`Seed package identity mismatch: ${path.basename(artifact)}`);
      seeds.push({ id, version, artifact, manifest });
    }
    for (const seed of seeds) await publishSeed(seed, seed.artifact, seed.manifest, storeUrl, authorization);
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

module.exports = { provision, discoverSeeds, verifyArtifact, publishSeed };
