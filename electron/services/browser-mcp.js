const path = require('node:path');

// Electron's Node mode can load this launcher and its bundled dependencies from ASAR.
const cli = path.join(path.dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');
process.argv[1] = cli;
require(cli);
