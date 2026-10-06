const { app, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.setPath('userData', process.env.ACESWARM_UI_TEST_PROFILE);
const videos = path.join(process.env.ACESWARM_UI_TEST_PROFILE, 'videos');
fs.mkdirSync(videos, { recursive: true });
app.setPath('videos', videos);
if (process.env.ACESWARM_UI_TEST_STARTUP_ERROR) {
  dialog.showErrorBox = (title, message) => fs.writeFileSync(process.env.ACESWARM_UI_TEST_STARTUP_ERROR, `${title}\n${message}`);
}
require('../../electron/main.js');
