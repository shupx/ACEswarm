const { app } = require('electron');
app.setPath('userData', process.env.ACESWARM_UI_TEST_PROFILE);
require('../../electron/main.js');
