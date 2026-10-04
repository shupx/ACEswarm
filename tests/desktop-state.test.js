const assert = require('node:assert/strict');
const test = require('node:test');
const { appKey, windowBounds, workArea, workspaceBounds, remapUrl } = require('../electron/desktop-state');

test('application identity keeps paths and query but ignores in-page anchors', () => {
  assert.equal(appKey('https://robot.local/app#status'), appKey('https://robot.local/app#settings'));
  assert.notEqual(appKey('https://robot.local/app-a'), appKey('https://robot.local/app-b'));
  assert.notEqual(appKey('https://robot.local/app?id=a'), appKey('https://robot.local/app?id=b'));
});

test('restored windows remain below the top panel after viewport shrinks', () => {
  for (const viewport of [{ width: 1280, height: 820 }, { width: 850, height: 550 }, { width: 390, height: 844 }]) {
    const bounds = windowBounds({ x: 4000, y: -100, width: 3000, height: 2000 }, viewport);
    assert.ok(bounds.x >= 8 && bounds.y >= 56);
    assert.ok(bounds.x + bounds.width <= viewport.width - 8);
    assert.ok(bounds.y + bounds.height <= viewport.height - 8);
  }
});

test('maximized work area fills the display below the expanded or collapsed top panel', () => {
  assert.deepEqual(workArea({ width: 1280, height: 820 }, false, true), { x: 0, y: 48, width: 1280, height: 772 });
  assert.deepEqual(workArea({ width: 1280, height: 820 }, true, true), { x: 0, y: 28, width: 1280, height: 792 });
});

test('invalid window geometry receives finite defaults', () => {
  const bounds = windowBounds({ width: NaN, height: Infinity, x: '20', y: null });
  for (const value of Object.values(bounds)) assert.ok(Number.isFinite(value));
});

test('workspace halves cover the work area without gaps, including odd sizes', () => {
  for (const viewport of [{ width: 1280, height: 820 }, { width: 391, height: 845 }]) {
    for (const collapsed of [false, true]) {
      const full = workspaceBounds(viewport, collapsed);
      const left = workspaceBounds(viewport, collapsed, 'left');
      const right = workspaceBounds(viewport, collapsed, 'right');
      const top = workspaceBounds(viewport, collapsed, 'top');
      const bottom = workspaceBounds(viewport, collapsed, 'bottom');
      assert.equal(left.width + right.width, full.width);
      assert.equal(left.x + left.width, right.x);
      assert.equal(top.height + bottom.height, full.height);
      assert.equal(top.y + top.height, bottom.y);
      assert.equal(right.x + right.width, viewport.width);
      assert.equal(bottom.y + bottom.height, viewport.height);
    }
  }
});

test('session restore remaps local ports without altering remote robots or application routes', () => {
  const previous = { os: 'http://127.0.0.1:3000', store: 'http://127.0.0.1:3001', gateway: 'http://127.0.0.1:3002' };
  const current = { os: 'http://127.0.0.1:4000', store: 'http://127.0.0.1:4001', gateway: 'http://127.0.0.1:4002' };
  assert.equal(remapUrl('http://127.0.0.1:3002/apps/control?id=1#map', previous, current), 'http://127.0.0.1:4002/apps/control?id=1#map');
  assert.equal(remapUrl('http://127.0.0.1:3001/', previous, current), 'http://127.0.0.1:4001/');
  assert.equal(remapUrl('http://192.168.1.2:3000/app', previous, current), 'http://192.168.1.2:3000/app');
});
