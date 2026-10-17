// Startup now opens a splash before the desktop. Tests must select the desktop
// explicitly and wait until the handoff has removed the splash window.
async function desktopWindow(application, timeout = 90000) {
  const child = application.process();
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const page = application.windows().find(page => /\/shell\.html$/.test(page.url()));
    if (page && await application.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      return windows.length === 1 && windows[0].isVisible();
    })) return page;
    if (child.exitCode !== null) throw new Error('ACEswarm exited before showing its desktop.');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for the ACEswarm desktop.');
}

module.exports = { desktopWindow };
