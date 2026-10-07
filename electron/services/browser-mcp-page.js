const path = require('node:path');
const { pathToFileURL } = require('node:url');

const shellUrl = pathToFileURL(path.join(__dirname, '..', 'shell.html')).href;
const guarded = Symbol('aceswarm-shell-guard');

// Official MCP init-page hook runs for each attached page, including existing CDP pages.
exports.default = async ({ page }) => {
  if (page[guarded]) return;
  page[guarded] = true;
  for (const method of ['goto', 'goBack', 'goForward', 'close']) {
    const original = page[method].bind(page);
    page[method] = async (...args) => {
      const url = new URL(page.url());
      url.search = '';
      url.hash = '';
      if (url.href === shellUrl) {
        throw new Error('ACEswarm desktop shell cannot be navigated or closed. Use browser_tabs to select an application WebView, or use the desktop address input to open a page.');
      }
      return original(...args);
    };
  }
};
