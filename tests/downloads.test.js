const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const createDownloads = require('../electron/services/downloads');

class Download extends EventEmitter {
  constructor(filename = 'package.tar.gz', total = 100) {
    super(); this.filename = filename; this.total = total; this.received = 0; this.path = ''; this.paused = false;
  }
  getFilename() { return this.filename; }
  getReceivedBytes() { return this.received; }
  getTotalBytes() { return this.total; }
  getSavePath() { return this.path; }
  isPaused() { return this.paused; }
  cancel() { this.emit('done', {}, 'cancelled'); }
  progress(received) { this.received = received; this.emit('updated', {}, 'progressing'); }
  finish(state = 'completed') { this.emit('done', {}, state); }
}

function setup(historyLimit) {
  const contents = {};
  const window = { webContents: contents, isDestroyed: () => false, setProgressBar: (...args) => progress.push(args) };
  const progress = [];
  const events = [];
  const controller = createDownloads({ getWindow: () => window, onChange: value => events.push(value), historyLimit });
  const session = new EventEmitter();
  controller.attach(session);
  return { controller, session, progress, events, guest: { hostWebContents: contents } };
}

test('sessions attach once and downloads outside this desktop are ignored', () => {
  const { controller, session } = setup();
  controller.attach(session);
  assert.equal(session.listenerCount('will-download'), 1);
  session.emit('will-download', {}, new Download(), {});
  assert.equal(controller.snapshot().items.length, 0);
});

test('progress is throttled, completion flushes the final path and cancels pending updates', async () => {
  const { controller, session, guest, events, progress } = setup();
  const item = new Download();
  session.emit('will-download', {}, item, guest);
  assert.equal(events.length, 1);
  item.progress(10); item.progress(50);
  assert.equal(events.length, 1);
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(events.at(-1).items[0].receivedBytes, 50);
  item.progress(100);
  item.path = '/tmp/chosen-package.tar.gz';
  item.finish();
  assert.equal(events.at(-1).items[0].state, 'completed');
  assert.equal(controller.completedPath('1'), item.path);
  assert.equal(item.listenerCount('updated'), 0);
  assert.deepEqual(progress.at(-1), [-1]);
  const count = events.length;
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(events.length, count, 'No progress events after completion');
  assert.equal(controller.cancel('1').ok, false);
});

test('concurrent downloads include unknown totals, cancellation, interruption and clearing', () => {
  const { controller, session, guest, events, progress } = setup();
  const first = new Download('first.zip');
  const second = new Download('stream.zip', 0);
  session.emit('will-download', {}, first, guest);
  session.emit('will-download', {}, second, guest);
  assert.deepEqual(progress.at(-1), [2, { mode: 'indeterminate' }]);
  controller.cancel('2');
  assert.equal(events.at(-1).items[0].state, 'cancelled');
  controller.clearFinished();
  assert.deepEqual(controller.snapshot().items.map(item => item.filename), ['first.zip']);
  first.finish('interrupted');
  assert.equal(controller.snapshot().items[0].state, 'interrupted');
  assert.equal(controller.completedPath('1'), '');
  controller.clearFinished();
  assert.equal(controller.snapshot().items.length, 0);
});

test('history is bounded without evicting an active download', () => {
  const { controller, session, guest } = setup(2);
  session.emit('will-download', {}, new Download('active.zip'), guest);
  for (let index = 0; index < 4; index++) {
    const item = new Download(`file${index}.zip`);
    session.emit('will-download', {}, item, guest);
    item.finish();
  }
  assert.deepEqual(controller.snapshot().items.map(item => item.filename), ['file3.zip', 'active.zip']);
  assert.equal(controller.cancel('1').ok, true);
});
