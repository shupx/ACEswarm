const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');

async function run() {
  const browser = await chromium.launch({ headless: true, ...(fs.existsSync('/usr/bin/google-chrome') ? { channel: 'chrome' } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const html = fs.readFileSync(path.join(root, 'electron/shell.html'), 'utf8')
      .replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, '');
    await page.setContent(html);
    await page.addStyleTag({ path: path.join(root, 'electron/shell.css') });
    await page.addScriptTag({ path: path.join(root, 'node_modules/lucide/dist/umd/lucide.min.js') });
    await page.addScriptTag({ content: `
      const defaultUrl = 'http://localhost/';
      const storeUrl = 'http://localhost/store/';
      const desktopState = { appKey: url => url };
      const tabs = new Map();
      let lastOpened, lastActivated, lastCommand, resolveCommand;
      function openApplication(url) { lastOpened = url; }
      function activateTab(id) { lastActivated = id; }
      window.aivudaShell = {
        getRunningApplications: async () => [],
        controlApplication: (appId, action) => {
          lastCommand = [appId, action];
          return new Promise(resolve => { resolveCommand = resolve; });
        },
      };
    ` });
    await page.addScriptTag({ content: fs.readFileSync(path.join(root, 'electron/desktop.js'), 'utf8').split('function applicationEntries()')[0] });
    await page.addScriptTag({ path: path.join(root, 'electron/background-apps.js') });
    await page.waitForTimeout(50);
    const entries = Array.from({ length: 7 }, (_, index) => ({
      appId: `app-${index}`, title: `Background application ${index}`, url: `http://localhost/app-${index}/`, hasUi: index !== 6,
      detailUrl: `http://localhost/dashboard/apps/app-${index}`,
    }));
    await page.evaluate(entries => renderBackgroundApps(entries), entries);
    assert.equal(await page.locator('#background-apps-visible button').count(), 4);
    assert.equal(await page.locator('#background-apps-overflow button').count(), 3);
    assert.equal(await page.locator('#background-apps-overflow').isVisible(), false);
    await page.locator('#background-apps-toggle').click();
    assert.equal(await page.locator('#background-apps-toggle').getAttribute('aria-expanded'), 'true');
    fs.mkdirSync(path.join(root, '.smoke/desktop'), { recursive: true });
    await page.screenshot({ path: path.join(root, '.smoke/desktop/background-apps.png') });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#background-apps-overflow').isVisible(), false);
    await page.locator('#background-apps-visible button').first().click();
    assert.equal(await page.evaluate(() => lastOpened), entries[0].url);
    await page.evaluate(url => tabs.set('existing', { id: 'existing', appUrl: url }), entries[0].url);
    await page.locator('#background-apps-visible button').first().click();
    assert.equal(await page.evaluate(() => lastActivated), 'existing');
    await page.locator('#background-apps-toggle').click();
    await page.locator('#background-apps-overflow button').last().click();
    assert.equal(await page.evaluate(() => lastOpened), 'http://localhost/');
    for (const width of [640, 375]) {
      await page.setViewportSize({ width, height: 640 });
      await page.locator('#background-apps-toggle').click();
      const overflow = await page.locator('#background-apps-overflow').boundingBox();
      assert.ok(overflow.x >= 0 && overflow.x + overflow.width <= width);
      const tray = await page.locator('#background-apps').boundingBox();
      const actions = await page.locator('#show-desktop').boundingBox();
      assert.ok(tray.x + tray.width <= actions.x);
      const newTab = await page.locator('#new-tab').boundingBox();
      assert.ok(newTab.x + newTab.width <= width);
      await page.screenshot({ path: path.join(root, `.smoke/desktop/background-apps-${width}.png`) });
      await page.mouse.click(width / 2, 100);
      assert.equal(await page.locator('#background-apps-overflow').isVisible(), false);
    }
    const menu = page.locator('#background-app-menu');
    const icon = page.locator('#background-apps-visible button').first();
    await icon.click({ button: 'right' });
    assert.deepEqual(await menu.locator('button').allTextContents(), ['Open UI', 'Detail', 'Stop', 'Restart']);
    const menuBounds = await menu.boundingBox();
    assert.ok(menuBounds.x >= 0 && menuBounds.x + menuBounds.width <= 375 && menuBounds.y >= 0);
    await page.screenshot({ path: path.join(root, '.smoke/desktop/background-app-menu.png') });
    await menu.locator('[data-action="ui"]').click();
    assert.equal(await page.evaluate(() => lastActivated), 'existing');
    await icon.click({ button: 'right' });
    await menu.locator('[data-action="detail"]').click();
    assert.equal(await page.evaluate(() => lastOpened), entries[0].detailUrl);
    for (const action of ['stop', 'restart']) {
      await page.evaluate(entries => renderBackgroundApps(entries), entries);
      await icon.click({ button: 'right' });
      await menu.locator(`[data-action="${action}"]`).click();
      assert.deepEqual(await page.evaluate(() => lastCommand), ['app-0', action]);
      await icon.click({ button: 'right' });
      assert.equal(await menu.locator('[data-action="stop"]').isDisabled(), true);
      assert.equal(await menu.locator('[data-action="restart"]').isDisabled(), true);
      await page.evaluate(() => resolveCommand({ ok: true }));
      await page.waitForFunction(() => pendingBackgroundAppActions.size === 0 && document.getElementById('background-apps').hidden);
      await page.mouse.click(100, 100);
    }
    await page.evaluate(entries => renderBackgroundApps(entries), entries);
    await page.locator('#background-apps-toggle').click();
    await page.locator('#background-apps-overflow button').last().click({ button: 'right' });
    assert.equal(await menu.locator('[data-action="ui"]').isDisabled(), true);
    assert.equal(await menu.locator('[data-action="detail"]').isEnabled(), true);
    await menu.locator('[data-action="detail"]').click();
    assert.equal(await page.evaluate(() => lastOpened), entries[6].detailUrl);
    await page.evaluate(entries => renderBackgroundApps(entries.slice(0, 4)), entries);
    assert.equal(await page.locator('#background-apps-toggle').isVisible(), false);
    await page.evaluate(() => renderBackgroundApps([]));
    assert.equal(await page.locator('#background-apps').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('PASS: application tray, context menu, UI/detail routes, stop/restart, pending controls and narrow layouts');
  } finally { await browser.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
