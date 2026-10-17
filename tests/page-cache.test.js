const assert = require('node:assert/strict');
const test = require('node:test');
const { clearPageCache } = require('../electron/services/page-cache');

function fixture() {
  const desktop = {};
  const calls = [];
  const target = {
    hostWebContents: desktop,
    isDestroyed: () => false,
    getURL: () => 'https://example.org:8443/app/ui?tab=1',
    session: {
      async clearData(options) { calls.push(['http', options]); },
      async clearStorageData(options) { calls.push(['storage', options]); },
    },
    reloadIgnoringCache() { calls.push(['reload']); },
  };
  return { desktop, sender: desktop, target, calls };
}

test('page cache removal scopes both caches to the guest origin and preserves user data', async () => {
  const context = fixture();
  assert.deepEqual(await clearPageCache(context), { ok: true });
  assert.deepEqual(context.calls, [
    ['http', { dataTypes: ['cache'], origins: ['https://example.org:8443'] }],
    ['storage', { origin: 'https://example.org:8443', storages: ['cachestorage'] }],
    ['reload'],
  ]);
});

test('rejects guest callers, unrelated web contents, destroyed pages and non-web URLs before clearing', async () => {
  for (const change of [
    context => { context.sender = {}; },
    context => { context.target.hostWebContents = {}; },
    context => { context.target.isDestroyed = () => true; },
    context => { context.target.getURL = () => 'file:///offline.html'; },
    context => { context.target.getURL = () => 'about:blank'; },
  ]) {
    const context = fixture();
    change(context);
    await assert.rejects(clearPageCache(context));
    assert.deepEqual(context.calls, []);
  }
});

test('does not reload a closed or navigated page after cache clearing', async () => {
  for (const closed of [true, false]) {
    const context = fixture();
    context.target.session.clearStorageData = async () => {
      if (closed) context.target.isDestroyed = () => true;
      else context.target.getURL = () => 'https://another.example/';
    };
    await clearPageCache(context);
    assert.equal(context.calls.some(([action]) => action === 'reload'), false);
  }
});

test('propagates cache removal failures without reloading', async () => {
  const context = fixture();
  context.target.session.clearData = async () => { throw new Error('disk failure'); };
  await assert.rejects(clearPageCache(context), /disk failure/);
  assert.deepEqual(context.calls, []);
});
