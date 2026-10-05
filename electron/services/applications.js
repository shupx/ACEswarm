async function installedApplications(osApi, gateway) {
  async function request(relative, options = {}) {
    const response = await fetch(new URL(relative, osApi), { ...options, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Application catalog request failed (${response.status})`);
    return response.json();
  }
  const login = await request('/aivuda_os/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  });
  if (!login.access_token) throw new Error('Application catalog login returned no token');
  const catalog = await request(`/aivuda_os/api/apps/installed?token=${encodeURIComponent(login.access_token)}`);
  return (catalog.items || []).filter(app => app.has_builtin_ui).map(app => ({
    title: app.name || app.app_id,
    url: new URL(`/${encodeURIComponent(app.app_id)}/ui/`, gateway).href,
    favicon: new URL(`/aivuda_os/api/apps/${encodeURIComponent(app.app_id)}/icon`, gateway).href,
  }));
}

module.exports = { installedApplications };
