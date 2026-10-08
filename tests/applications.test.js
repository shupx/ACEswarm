const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { installedApplications, runningApplications, controlApplication } = require('../electron/services/applications');

test('installed catalog includes UI and backend apps with appropriate gateway URLs', async () => {
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
    }, {
      title: 'backend', url: 'http://127.0.0.1:28790/dashboard/apps/backend',
      favicon: 'http://127.0.0.1:28790/aivuda_os/api/apps/backend/icon',
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
    assert.equal(result[1].detailUrl, 'http://127.0.0.1:28790/dashboard/apps/backend');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('application controls authenticate, wait for completion and propagate failures', async () => {
  const commands = [];
  let failed = false;
  let polls = 0;
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url.endsWith('/auth/login')) return response.end(JSON.stringify({ access_token: 'local-token' }));
    assert.ok(request.url.endsWith('?token=local-token'));
    if (request.method === 'POST') {
      commands.push(request.url);
      response.statusCode = 202;
      response.end(JSON.stringify({ operation_id: 'operation-1' }));
    } else {
      polls++;
      response.end(JSON.stringify(failed ? { done: true, status: 'failed', error: 'Process failed to restart' }
        : { status: polls === 1 ? 'running' : 'completed' }));
    }
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    await controlApplication(base, 'app /test', 'stop');
    assert.equal(polls, 2);
    assert.equal(commands[0], `/aivuda_os/api/apps/${encodeURIComponent('app /test')}/stop?token=local-token`);
    failed = true;
    await assert.rejects(controlApplication(base, 'backend', 'restart'), /Process failed to restart/);
    assert.equal(commands[1], '/aivuda_os/api/apps/backend/restart?token=local-token');
    await assert.rejects(controlApplication(base, 'backend', 'delete'), /Unsupported/);
    await assert.rejects(controlApplication(base, '', 'stop'), /ID is required/);
    assert.equal(commands.length, 2);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
