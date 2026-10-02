const fs = require('node:fs');
const path = require('node:path');

function directory(paths, kind) {
  if (!['projects', 'experiments'].includes(kind)) throw new Error('Unknown workspace collection');
  return paths[kind];
}

function listItems(paths, kind) {
  return fs.readdirSync(directory(paths, kind), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function createItem(paths, kind, name) {
  if (typeof name !== 'string' || !/^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,79}$/u.test(name) || name.endsWith('.')) {
    throw new Error('Use a name of 1–80 letters, digits, spaces, dots, hyphens or underscores');
  }
  const folder = path.join(directory(paths, kind), name);
  fs.mkdirSync(folder);
  return name;
}

module.exports = { listItems, createItem };
