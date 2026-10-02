const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function digest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function treeDigest(root) {
  const hash = crypto.createHash('sha256');
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue;
      const relative = path.posix.join(prefix, entry.name);
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file, relative);
      else if (entry.isFile()) {
        hash.update(relative + '\0');
        hash.update(fs.readFileSync(file));
      } else throw new Error(`Unsupported bundle entry: ${file}`);
    }
  }
  visit(root);
  return hash.digest('hex');
}

function verifyRelease(resourcesPath) {
  const manifest = JSON.parse(fs.readFileSync(path.join(resourcesPath, 'release-manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || manifest.platform !== process.platform || manifest.architecture !== process.arch) {
    throw new Error('Bundle manifest or architecture mismatch');
  }
  for (const [name, file] of [['python', 'python-runtime/bin/python3'], ['caddy', 'caddy']]) {
    if (digest(path.join(resourcesPath, file)) !== manifest.artifacts?.[name]) throw new Error(`Bundle hash mismatch: ${name}`);
  }
  for (const name of ['aivudaos', 'aivudaappstore']) {
    if (treeDigest(path.join(resourcesPath, 'python-packages', name)) !== manifest.packages?.[name]?.sha256) {
      throw new Error(`Bundle hash mismatch: ${name}`);
    }
  }
  return manifest;
}

module.exports = { digest, treeDigest, verifyRelease };
