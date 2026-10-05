const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { installedApplications, runningApplications } = require('../electron/services/applications');

test('installed UI catalog uses authenticated API and gateway URLs, excluding backend-only apps', async () => {
  let authorized = false;
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url.endsWith('/auth/login')) response.end(JSON.stringify({ access_token: 'local-token' }));
    else {
      authorized = request.url === '/aivuda_os/api/apps/installed?token=local-token';
      response.end(JSON.stringify({ items: [
        { app_id: 'navigation', name: 'Navigation', has_builtin_ui: true },
        { app_id: 'backend', has_builtin_ui: false },
      ] }));
    }
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.deepEqual(await installedApplications(base, 'http://127.0.0.1:28790'), [{
      title: 'Navigation', url: 'http://127.0.0.1:28790/navigation/ui/',
      favicon: 'http://127.0.0.1:28790/aivuda_os/api/apps/navigation/icon',
    }]);
    assert.equal(authorized, true);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('running catalog includes backend-only apps and excludes stopped apps', async () => {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url.endsWith('/auth/login') ? { access_token: 'local-token' } : { items: [
      { app_id: 'navigation', name: 'Navigation', running: true, has_builtin_ui: true },
      { app_id: 'backend', running: true, has_builtin_ui: false },
      { app_id: 'stopped', running: false, has_builtin_ui: true },
    ] }));
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const result = await runningApplications(`http://127.0.0.1:${server.address().port}`, 'http://127.0.0.1:28790');
    assert.deepEqual(result.map(app => [app.appId, app.hasUi]), [['navigation', true], ['backend', false]]);
    assert.equal(result[1].title, 'backend');
    assert.equal(result[1].favicon, 'http://127.0.0.1:28790/aivuda_os/api/apps/backend/icon');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
