const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.setPath('userData', process.env.ACESWARM_UI_TEST_PROFILE);
const videos = path.join(process.env.ACESWARM_UI_TEST_PROFILE, 'videos');
fs.mkdirSync(videos, { recursive: true });
app.setPath('videos', videos);
require('../../electron/main.js');
