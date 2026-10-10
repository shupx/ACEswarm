// One controller for all desktop/guest downloads, including generated blob files.
module.exports = function createDownloadController({ getWindow, onChange, historyLimit = 50 }) {
  const sessions = new WeakSet();
  const records = new Map();
  let nextId = 1;
  let revision = 0;

  function snapshot(changedId = null) {
    return { revision, changedId, items: [...records.values()].map(record => ({ ...record.data })).reverse() };
  }

  function publish(record) {
    clearTimeout(record.timer);
    record.timer = null;
    record.lastPublished = Date.now();
    revision += 1;
    const active = [...records.values()].filter(entry => entry.item);
    const window = getWindow();
    if (window && !window.isDestroyed()) {
      if (!active.length) window.setProgressBar(-1);
      else if (active.some(entry => entry.data.totalBytes <= 0)) window.setProgressBar(2, { mode: 'indeterminate' });
      else {
        const total = active.reduce((sum, entry) => sum + entry.data.totalBytes, 0);
        const received = active.reduce((sum, entry) => sum + entry.data.receivedBytes, 0);
        window.setProgressBar(Math.min(1, received / total));
      }
    }
    onChange(snapshot(record.data.id));
  }

  function readItem(record, state) {
    const item = record.item;
    Object.assign(record.data, {
      filename: item.getFilename(),
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      savePath: item.getSavePath(),
      state: item.isPaused() && state === 'progressing' ? 'paused' : state,
    });
  }

  function trimHistory() {
    const finished = [...records.values()].filter(record => !record.item);
    while (records.size > historyLimit && finished.length) records.delete(finished.shift().data.id);
  }

  function attach(targetSession) {
    if (sessions.has(targetSession)) return;
    sessions.add(targetSession);
    targetSession.on('will-download', (_event, item, contents) => {
      const window = getWindow();
      if (!window || window.isDestroyed() ||
          (contents !== window.webContents && contents?.hostWebContents !== window.webContents)) return;
      const record = {
        item, timer: null, lastPublished: 0,
        data: { id: String(nextId++), startedAt: Date.now(), filename: '', receivedBytes: 0, totalBytes: 0, savePath: '', state: 'progressing' },
      };
      records.set(record.data.id, record);
      readItem(record, 'progressing');
      trimHistory();
      publish(record);
      const updated = (_event, state) => {
        readItem(record, state);
        if (state !== 'progressing' || Date.now() - record.lastPublished >= 200) publish(record);
        else if (!record.timer) record.timer = setTimeout(() => publish(record), 200);
      };
      item.on('updated', updated);
      item.once('done', (_event, state) => {
        readItem(record, state);
        record.data.finishedAt = Date.now();
        item.removeListener('updated', updated);
        record.item = null;
        trimHistory();
        publish(record);
      });
    });
  }

  function cancel(id) {
    const record = records.get(String(id));
    if (!record?.item) return { ok: false, error: 'Download is no longer active.' };
    record.item.cancel();
    return { ok: true };
  }

  function completedPath(id) {
    const record = records.get(String(id));
    return record?.data.state === 'completed' ? record.data.savePath : '';
  }

  function clearFinished() {
    for (const [id, record] of records) if (!record.item) records.delete(id);
    revision += 1;
    onChange(snapshot());
    return { ok: true };
  }

  return { attach, snapshot, cancel, completedPath, clearFinished };
};
