// Guest pages share a session, so every removal must be scoped to an origin.
async function clearPageCache({ sender, desktop, target }) {
  if (!desktop || sender !== desktop) throw new Error('Only the desktop can clear page cache.');
  if (!target || target.isDestroyed() || target.hostWebContents !== desktop) {
    throw new Error('Page is no longer available.');
  }
  const url = new URL(target.getURL());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS pages have a site cache.');
  await target.session.clearData({ dataTypes: ['cache'], origins: [url.origin] });
  await target.session.clearStorageData({ origin: url.origin, storages: ['cachestorage'] });
  // Navigation or closing the tab while clearing must not refresh a different page.
  if (!target.isDestroyed() && target.getURL() === url.href) target.reloadIgnoringCache();
  return { ok: true };
}

module.exports = { clearPageCache };
