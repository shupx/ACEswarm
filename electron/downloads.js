(() => {
  const panel = document.getElementById('downloads-panel');
  const toggle = document.getElementById('downloads-button');
  const list = document.getElementById('downloads-list');
  const empty = document.getElementById('downloads-empty');
  const count = document.getElementById('downloads-count');
  const notice = document.getElementById('downloads-notice');
  const clear = document.getElementById('downloads-clear');
  const rows = new Map();
  let revision = -1;
  let items = [];
  let noticeState = null;

  const text = key => document.documentElement.lang === 'zh-CN' ? shellTranslations[key] || key : key;
  const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  function showNotice(key, detail) {
    noticeState = { key, detail };
    setText(notice, `${text(key)}: ${detail}`);
  }
  function bytes(value) {
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function setOpen(open) {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) render();
  }

  async function action(id, name) {
    try {
      const result = await window.aivudaShell.downloadAction(id, name);
      if (!result.ok) showNotice('Download action failed', result.error);
    } catch (error) {
      showNotice('Download action failed', error.message);
    }
  }

  function createRow(item) {
    const root = document.createElement('article');
    root.className = 'download-item';
    root.dataset.downloadId = item.id;
    const filename = document.createElement('div');
    filename.className = 'download-filename';
    filename.dataset.downloadUserText = '';
    const status = document.createElement('span');
    status.className = 'download-status';
    const size = document.createElement('span');
    size.className = 'download-size';
    const details = document.createElement('div');
    details.className = 'download-details';
    details.append(status, size);
    const progress = document.createElement('progress');
    const actions = document.createElement('div');
    actions.className = 'download-actions';
    const buttons = {};
    for (const [name, label] of [['open', 'Open file'], ['show', 'Show in folder'], ['cancel', 'Cancel download']]) {
      const button = document.createElement('button');
      button.dataset.downloadAction = name;
      button.onclick = () => action(item.id, name);
      actions.append(button);
      buttons[name] = { button, label };
    }
    root.append(filename, details, progress, actions);
    return { root, filename, status, size, progress, buttons };
  }

  function render() {
    const activeCount = items.filter(item => !item.finishedAt).length;
    count.hidden = !activeCount;
    setText(count, String(activeCount));
    toggle.title = text('Downloads');
    toggle.setAttribute('aria-label', `${text('Downloads')}${activeCount ? ` (${activeCount})` : ''}`);
    setText(document.getElementById('downloads-title'), text('Downloads'));
    setText(empty, text('No downloads yet'));
    setText(clear, text('Clear finished downloads'));
    clear.disabled = !items.some(item => item.finishedAt);
    empty.hidden = items.length > 0;
    if (noticeState) setText(notice, `${text(noticeState.key)}: ${noticeState.detail}`);
    if (panel.hidden) return;
    const ids = new Set(items.map(item => item.id));
    for (const [id, row] of rows) {
      if (!ids.has(id)) { row.root.remove(); rows.delete(id); }
    }
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      let row = rows.get(item.id);
      if (!row) { row = createRow(item); rows.set(item.id, row); }
      if (list.children[index] !== row.root) list.insertBefore(row.root, list.children[index] || null);
      const active = !item.finishedAt;
      const completed = item.state === 'completed';
      row.root.dataset.state = item.state;
      setText(row.filename, item.filename || text('Download'));
      row.filename.title = item.savePath || item.filename;
      const labels = { progressing: 'Downloading', completed: 'Completed', cancelled: 'Cancelled', interrupted: 'Download failed', paused: 'Paused' };
      setText(row.status, text(labels[item.state] || 'Downloading'));
      const percent = item.totalBytes > 0 ? Math.min(100, Math.floor(item.receivedBytes / item.totalBytes * 100)) : null;
      setText(row.size, `${bytes(item.receivedBytes)}${item.totalBytes > 0 ? ` / ${bytes(item.totalBytes)}${active ? ` · ${percent}%` : ''}` : ''}`);
      row.progress.hidden = !active;
      row.progress.setAttribute('aria-label', text('Download progress'));
      row.progress.max = item.totalBytes > 0 ? item.totalBytes : 1;
      if (item.totalBytes > 0) row.progress.value = item.receivedBytes;
      else row.progress.removeAttribute('value');
      for (const [name, { button, label }] of Object.entries(row.buttons)) {
        setText(button, text(label));
        button.hidden = name === 'cancel' ? !active : !completed;
      }
    }
  }

  function update(value) {
    if (!value || value.revision <= revision) return;
    const previous = new Map(items.map(item => [item.id, item]));
    revision = value.revision;
    items = value.items;
    if (!value.changedId) { noticeState = null; setText(notice, ''); }
    const changed = items.find(item => item.id === value.changedId);
    if (changed && (!previous.has(changed.id) ||
        (changed.finishedAt && !previous.get(changed.id).finishedAt && changed.state !== 'cancelled'))) {
      setOpen(true);
      const label = changed.state === 'completed' ? 'Download complete' : changed.state === 'interrupted' ? 'Download failed' : 'Downloading';
      showNotice(label, changed.filename);
    }
    render();
  }

  toggle.onclick = () => setOpen(panel.hidden);
  document.getElementById('downloads-close').onclick = () => setOpen(false);
  clear.onclick = () => action(null, 'clear');
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !panel.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { setOpen(false); toggle.focus(); }
  });
  window.aivudaShell.onDownloads(update);
  window.aivudaShell.onAppearance(render);
  window.aivudaShell.getDownloads().then(update).catch(error => console.warn('Could not read downloads:', error));
})();
