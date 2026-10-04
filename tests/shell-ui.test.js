const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'electron/shell.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'electron/shell.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8');
const guest = fs.readFileSync(path.join(root, 'electron/guest-preload.js'), 'utf8');

test('app UI Dock icons prefer the manifest icon and fall back to the page favicon', () => {
  const nodes = [];
  const context = vm.createContext({
    URL, defaultUrl: 'http://localhost:28790/', storeUrl: 'http://localhost:28791/',
    desktopState: { appKey: (url) => url }, lucide: { createIcons() {} },
    document: {
      querySelectorAll: () => [],
      createElement(tag) {
        const node = { tag, dataset: {}, classList: { add() {} }, children: [],
          append(child) { this.children.push(child); },
          replaceChildren(...children) { this.children = children; } };
        nodes.push(node);
        return node;
      },
    },
  });
  const desktop = fs.readFileSync(path.join(root, 'electron/desktop.js'), 'utf8');
  vm.runInContext(desktop.split('function applicationEntries()')[0], context);
  const holder = vm.runInContext('applicationIcon({url: "https://robot/navigation/ui/index.html", favicon: "https://robot/favicon.ico"})', context);
  const image = nodes.find((node) => node.tag === 'img');
  assert.equal(image.src, 'https://robot/aivuda_os/api/apps/navigation/icon');
  image.onerror();
  assert.equal(image.src, 'https://robot/favicon.ico');
  image.onload();
  assert.equal(holder.children[0], image);
  image.onerror();
  assert.equal(holder.children[0].dataset.lucide, 'globe');
  nodes.length = 0;
  vm.runInContext('applicationIcon({url: "https://example.org/page", favicon: "https://example.org/icon.png"})', context);
  assert.equal(nodes.find((node) => node.tag === 'img').src, 'https://example.org/icon.png');
});

test('desktop shell exposes application windows, Dock, address bar and tools', () => {
  for (const id of ['shell', 'dock', 'desktop-shortcuts', 'show-desktop', 'open-page-dialog', 'address-input', 'add-favorite', 'tools-button', 'tools-menu', 'tools-fps', 'tools-record', 'webview-stack']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), id);
  }
  assert.match(renderer, /persist:aivuda-shell/);
  assert.match(renderer, /renderFavorites/);
  assert.match(renderer, /addCurrentFavorite/);
  assert.match(renderer, /defaultUrl/);
  assert.match(renderer, /storeUrl/);
  assert.match(renderer, /setToolsMenuOpen/);
});

test('System and window controls replace the native application menu', () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  assert.match(main, /Menu\.setApplicationMenu\(null\)/);
  assert.match(main, /before-input-event/);
  assert.match(html, /aria-label="System"/);
  assert.match(html, /id="system-address"/);
  assert.match(html, /id="window-zoom-in"/);
  assert.doesNotMatch(main, /label: 'File'|label: 'View'|label: 'Address Bar'/);
});

test('browser shell preserves FPS overlay and recording controls', () => {
  assert.match(renderer, /performanceOverlayVisible/);
  assert.match(renderer, /screenRecordMode/);
  assert.match(renderer, /startScreenRecording/);
  assert.match(renderer, /pauseScreenRecording/);
  assert.match(renderer, /resumeScreenRecording/);
  assert.match(renderer, /stopScreenRecording/);
  assert.match(preload, /getGpuStatus/);
  assert.match(preload, /prepareWindowRecording/);
  assert.match(preload, /startFfmpegWindowRecording/);
  assert.match(preload, /saveRecordingFile/);
  assert.match(renderer, /canvas.captureStream/);
  assert.match(preload, /captureRecordingFrame/);
  assert.match(renderer, /data-screen-record-mode/);
  assert.match(renderer, /ffmpeg-x11/);
});

test('native recording captures the application without the desktop capturer', () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.js'), 'utf8');
  assert.match(main, /window.webContents.capturePage/);
  assert.doesNotMatch(main, /desktopCapturer/);
  assert.doesNotMatch(renderer, /getUserMedia/);
});

test('guest pages use persistent session and shell preload bridge', () => {
  assert.match(renderer, /setAttribute\("partition", "persist:aivuda-shell"\)/);
  assert.match(renderer, /guest-preload\.js/);
  assert.match(guest, /open-url-in-new-tab/);
  assert.match(guest, /set-performance-overlay-visible/);
});
