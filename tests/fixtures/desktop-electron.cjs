const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.setPath('userData', process.env.ACESWARM_UI_TEST_PROFILE);
if (process.env.ACESWARM_UI_TEST_FAIL_ON_ERROR) {
  process.on('uncaughtException', error => { console.error(error); app.exit(1); });
}
const videos = path.join(process.env.ACESWARM_UI_TEST_PROFILE, 'videos');
fs.mkdirSync(videos, { recursive: true });
app.setPath('videos', videos);
if (process.env.ACESWARM_UI_TEST_STARTUP_ERROR) {
  dialog.showErrorBox = (title, message) => fs.writeFileSync(process.env.ACESWARM_UI_TEST_STARTUP_ERROR, `${title}\n${message}`);
}
if (process.env.ACESWARM_UI_TEST_HOLD_STARTUP) {
  const { ipcMain } = require('electron');
  const { LocalServices } = require('../../electron/services/local-services');
  const launch = LocalServices.prototype.launch;
  LocalServices.prototype.launch = function (...args) {
    const child = launch.apply(this, args);
    fs.appendFileSync(path.join(process.env.ACESWARM_UI_TEST_PROFILE, 'startup-service-pids'), `${child.pid}\n`);
    return child;
  };
  const start = LocalServices.prototype.start;
  const released = new Promise(resolve => ipcMain.once('aceswarm:test-continue-startup', resolve));
  LocalServices.prototype.start = async function (...args) { await released; return start.apply(this, args); };
}
require('../../electron/main.js');
