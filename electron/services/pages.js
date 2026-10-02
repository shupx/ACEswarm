const fixed = Object.freeze([
  { id: 'home', label: 'Home', kind: 'internal' },
  { id: 'projects', label: 'Projects', kind: 'internal' },
  { id: 'simulation', label: 'Simulation', kind: 'internal' },
  { id: 'experiments', label: 'Experiments', kind: 'internal' },
  { id: 'fleet', label: 'Fleet', kind: 'internal' },
  { id: 'settings', label: 'Settings', kind: 'os' },
  { id: 'store', label: 'App Store', kind: 'store' },
]);

function resolvePage(id, endpoints, context = {}) {
  const page = fixed.find((item) => item.id === id);
  if (page) return { ...page, url: page.kind === 'os' ? endpoints.os : page.kind === 'store' ? endpoints.store : null, context };
  if (id.startsWith('app:') && /^[a-zA-Z0-9_.-]+$/.test(id.slice(4))) {
    return { id, label: id.slice(4), kind: 'app', url: `${endpoints.gateway}/${encodeURIComponent(id.slice(4))}/ui/`, context };
  }
  if (id.startsWith('robot:')) {
    const robot = new URL(id.slice(6));
    if (!['http:', 'https:'].includes(robot.protocol) || robot.username || robot.password) throw new Error('Invalid robot URL');
    return { id, label: robot.hostname, kind: 'robot', url: robot.origin, context };
  }
  throw new Error(`Unknown page: ${id}`);
}
module.exports = { fixed, resolvePage };
