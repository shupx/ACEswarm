const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function workspace(root = process.env.ACESWARM_WS_ROOT || path.join(os.homedir(), 'ACEswarm_ws')) {
  const base = path.resolve(root);
  const paths = {
    root: base,
    os: path.join(base, 'services', 'aivudaos'),
    store: path.join(base, 'services', 'aivudaappstore'),
    logs: path.join(base, 'logs'),
    projects: path.join(base, 'projects'),
    experiments: path.join(base, 'experiments'),
    state: path.join(base, 'state'),
  };
  for (const directory of Object.values(paths)) fs.mkdirSync(directory, { recursive: true });
  return paths;
}
module.exports = { workspace };
