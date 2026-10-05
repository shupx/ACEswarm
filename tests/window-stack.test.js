const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('window stacking remains below system menus after prolonged use and preserves restored order', () => {
  const source = fs.readFileSync(path.join(__dirname, '../electron/window-manager.js'), 'utf8');
  const context = vm.createContext({});
  vm.runInContext(source.split('function createApplicationWindow(')[0], context);
  vm.runInContext(`
    appWindows.set('a', { zIndex: 99998 });
    appWindows.set('b', { zIndex: 99999 });
    normalizeWindowStack();
  `, context);
  assert.equal(vm.runInContext("appWindows.get('a').zIndex < appWindows.get('b').zIndex", context), true);
  vm.runInContext("for (let i = 0; i < 20000; i++) raiseWindow(appWindows.get('a'));", context);
  assert.equal(vm.runInContext("appWindows.get('a').zIndex > appWindows.get('b').zIndex", context), true);
  assert.equal(vm.runInContext('Math.max(...[...appWindows.values()].map(owner => owner.zIndex)) * 10 + 3 < 100000', context), true);
});
