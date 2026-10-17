const path = require('node:path');
const { BrowserWindow, ipcMain, app } = require('electron');

function createSplash() {
  const window = new BrowserWindow({
    width: 460, height: 350, show: false, center: true,
    frame: false, resizable: false, maximizable: false, fullscreenable: false,
    title: 'Starting ACEswarm', backgroundColor: '#f2f7f4',
    icon: path.join(__dirname, '..', 'assets', 'aivuda_icon.png'),
    webPreferences: { preload: path.join(__dirname, '..', 'splash-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const quit = event => { if (event.sender === window.webContents) app.quit(); };
  ipcMain.on('aceswarm:startup-quit', quit);
  window.once('closed', () => ipcMain.removeListener('aceswarm:startup-quit', quit));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  const ready = new Promise((resolve, reject) => {
    window.once('ready-to-show', () => { window.show(); resolve(); });
    window.once('closed', () => reject(new Error('Startup window closed.')));
    window.loadFile(path.join(__dirname, '..', 'splash.html')).catch(reject);
  });
  return {
    window, ready,
    status(message, error) {
      if (window.isDestroyed()) return;
      if (error) window.setContentSize(460, 450);
      window.webContents.send('aceswarm:startup-status', { message, error });
    },
    close() { if (!window.isDestroyed()) window.destroy(); },
  };
}

module.exports = { createSplash };
