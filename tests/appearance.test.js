const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizePreferences, resolveAppearance } = require('../electron/services/appearance');

test('desktop follows system by default, supports overrides, and falls back to English/light', () => {
  assert.deepEqual(normalizePreferences(null), { theme: 'system', language: 'system' });
  assert.deepEqual(resolveAppearance({}, 'zh-CN', true), { theme: 'system', language: 'system', resolvedTheme: 'dark', resolvedLanguage: 'zh-CN' });
  assert.equal(resolveAppearance({}, 'de-DE', false).resolvedLanguage, 'en-US');
  assert.equal(resolveAppearance({}, undefined, undefined).resolvedTheme, 'light');
  const value = resolveAppearance({ theme: 'light', language: 'en-US' }, 'zh-CN', true);
  assert.equal(value.resolvedLanguage, 'en-US'); assert.equal(value.resolvedTheme, 'light');
});

test('guest browser adaptation supplies standard language/media APIs and change events', () => {
  const navigator = {};
  const ipcListeners = new Map();
  const windowEvents = new EventTarget();
  let languageChanges = 0;
  windowEvents.addEventListener('languagechange', () => languageChanges++);
  const context = vm.createContext({ navigator, Event, EventTarget,
    MediaQueryListEvent: class extends Event {
      constructor(type, init) { super(type); Object.assign(this, init); }
    },
    window: { matchMedia: media => ({ media, matches: false }), open() {},
      addEventListener: windowEvents.addEventListener.bind(windowEvents), dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents) },
    console,
    require: () => ({
      contextBridge: { executeInMainWorld: ({ func, args }) => vm.runInContext('(' + func.toString() + ')(... ' + JSON.stringify(args) + ')', context) },
      ipcRenderer: { sendSync: channel => channel === 'aivuda-shell:get-appearance' ? { resolvedLanguage: 'zh-CN', resolvedTheme: 'dark' } : null,
        on: (channel, callback) => ipcListeners.set(channel, callback), sendToHost() {} },
    }),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../electron/guest-preload.js'), 'utf8'), context);
  assert.equal(navigator.language, 'zh-CN');
  assert.equal(navigator.languages[0], 'zh-CN');
  vm.runInContext('var darkQuery = window.matchMedia("(prefers-color-scheme: dark)"); var changes = []; darkQuery.addEventListener("change", event => changes.push(event.matches))', context);
  assert.equal(vm.runInContext('darkQuery.matches', context), true);
  assert.equal(vm.runInContext('window.matchMedia("(min-width: 100px)").matches', context), false);
  ipcListeners.get('aivuda-shell:appearance')(null, { resolvedLanguage: 'en-US', resolvedTheme: 'light' });
  assert.equal(navigator.language, 'en-US');
  assert.equal(vm.runInContext('darkQuery.matches', context), false);
  assert.equal(vm.runInContext('changes[0]', context), false);
  assert.equal(languageChanges, 2);
});

for (const packageName of ['aivudaOS/aivudaos', 'aivudaAppStore/aivudaappstore']) {
  test(packageName + ' uses browser APIs and preserves independent overrides', () => {
    const storage = new Map();
    const listeners = new Map();
    let dark = true;
    const context = vm.createContext({
      localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
      navigator: { language: 'zh-CN' },
      window: { matchMedia: () => ({ matches: dark, addEventListener() {}, removeEventListener() {} }),
        addEventListener: (key, callback) => listeners.set(key, callback), removeEventListener: key => listeners.delete(key) },
    });
    const source = fs.readFileSync(path.join(__dirname, '..', packageName, 'resources/ui/src/appearance.js'), 'utf8');
    assert.doesNotMatch(source, /aceswarm/i);
    vm.runInContext(source.replaceAll('export function ', 'function '), context);
    const evaluate = code => vm.runInContext(code, context);
    assert.equal(evaluate("resolveLanguage('system')"), 'zh-CN');
    assert.equal(evaluate("resolveTheme('system')"), 'dark');
    evaluate("navigator.language = 'en-US'"); dark = false;
    assert.equal(evaluate("resolveLanguage('system')"), 'en-US');
    assert.equal(evaluate("resolveTheme('system')"), 'light');
    assert.equal(evaluate("resolveLanguage('zh-CN')"), 'zh-CN');
    assert.equal(evaluate("resolveTheme('dark')"), 'dark');
    evaluate('navigator.language = undefined; window.matchMedia = () => { throw new Error("unavailable") }');
    assert.equal(evaluate("resolveLanguage('system')"), 'en-US');
    assert.equal(evaluate("resolveTheme('system')"), 'light');
    evaluate('let changes = 0; const unsubscribe = subscribeAppearance(() => changes++)');
    listeners.get('languagechange')();
    assert.equal(evaluate('changes'), 1);
    evaluate('unsubscribe()'); assert.equal(listeners.size, 0);
  });
}
