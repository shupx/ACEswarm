const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'electron/shell.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'electron/shell.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.js'), 'utf8');
const guest = fs.readFileSync(path.join(root, 'electron/guest-preload.js'), 'utf8');

test('Aivuda-style browser shell exposes Home, AppStore, favorites and tabs', () => {
  for (const id of ['shell', 'tabs', 'address-input', 'favorites-bar', 'home-button', 'store-button', 'add-favorite', 'webview-stack']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), id);
  }
  assert.match(renderer, /persist:aivuda-shell/);
  assert.match(renderer, /renderFavorites/);
  assert.match(renderer, /addCurrentFavorite/);
  assert.match(renderer, /defaultUrl/);
  assert.match(renderer, /storeUrl/);
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
});

test('guest pages use persistent session and shell preload bridge', () => {
  assert.match(renderer, /setAttribute\("partition", "persist:aivuda-shell"\)/);
  assert.match(renderer, /guest-preload\.js/);
  assert.match(guest, /open-url-in-new-tab/);
  assert.match(guest, /set-performance-overlay-visible/);
});
