async function authenticatedApplicationRequest(osApi) {
  async function request(relative, options = {}) {
    const response = await fetch(new URL(relative, osApi), { ...options, signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || `Application request failed (${response.status})`);
    return data;
  }
  const login = await request('/aivuda_os/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  if (!login.access_token) throw new Error('Application catalog login returned no token');
  return (relative, options) => request(`${relative}?token=${encodeURIComponent(login.access_token)}`, options);
}

async function applicationCatalog(osApi) {
  const request = await authenticatedApplicationRequest(osApi);
  const catalog = await request('/aivuda_os/api/apps/installed');
  return catalog.items || [];
}

function applicationEntry(app, gateway) {
  return {
    title: app.name || app.app_id,
    url: new URL(`/${encodeURIComponent(app.app_id)}/ui/`, gateway).href,
    favicon: new URL(`/aivuda_os/api/apps/${encodeURIComponent(app.app_id)}/icon`, gateway).href,
  };
}

async function installedApplications(osApi, gateway) {
  return (await applicationCatalog(osApi)).filter(app => app.has_builtin_ui).map(app => applicationEntry(app, gateway));
}

async function runningApplications(osApi, gateway) {
  return (await applicationCatalog(osApi)).filter(app => app.running).map(app => ({
    ...applicationEntry(app, gateway), appId: app.app_id, hasUi: Boolean(app.has_builtin_ui),
    detailUrl: new URL(`/dashboard/apps/${encodeURIComponent(app.app_id)}`, gateway).href,
  }));
}

async function controlApplication(osApi, appId, action) {
  if (!['stop', 'restart'].includes(action)) throw new Error('Unsupported application action');
  if (typeof appId !== 'string' || !appId.trim()) throw new Error('Application ID is required');
  const request = await authenticatedApplicationRequest(osApi);
  const queued = await request(`/aivuda_os/api/apps/${encodeURIComponent(appId)}/${action}`, { method: 'POST' });
  if (!queued.operation_id) throw new Error('Application action returned no operation ID');
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const operation = await request(`/aivuda_os/api/apps/operations/${encodeURIComponent(queued.operation_id)}`);
    if (['failed', 'canceled'].includes(operation.status)) throw new Error(operation.error || 'Application action failed');
    if (operation.done || operation.status === 'completed') return operation;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Application action timed out');
}

module.exports = { installedApplications, runningApplications, controlApplication };
