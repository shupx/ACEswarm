const http = require('node:http');
const { listItems, createItem } = require('./workspace-items');
const { fixed, resolvePage } = require('./pages');

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(body);
}
function readBody(request) {
  return new Promise((resolve, reject) => { let data = ''; request.on('data', (chunk) => { data += chunk; if (data.length > 100_000) reject(new Error('request too large')); }); request.on('end', () => resolve(data)); request.on('error', reject); });
}
class ControlServer {
  constructor({ paths, endpoints, bootstrap = { status: 'pending' } }) { this.paths = paths; this.endpoints = endpoints; this.bootstrap = bootstrap; this.server = null; }
  async start(port = 0) {
    this.server = http.createServer(async (request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      try {
        if (request.method === 'GET' && url.pathname === '/api/v1/health') return json(response, 200, { ok: true, service: 'aceswarm-control', version: 1 });
        if (request.method === 'GET' && url.pathname === '/api/v1/status') return json(response, 200, { ok: true, endpoints: this.endpoints, bootstrap: this.bootstrap });
        if (request.method === 'GET' && url.pathname === '/api/v1/pages') return json(response, 200, fixed);
        if (request.method === 'GET' && url.pathname === '/api/v1/pages/resolve') return json(response, 200, resolvePage(url.searchParams.get('id') || '', this.endpoints, {}));
        if (request.method === 'GET' && url.pathname === '/api/v1/bootstrap') return json(response, 200, this.bootstrap);
        if (request.method === 'GET' && url.pathname === '/api/v1/settings/target') return json(response, 200, { url: this.endpoints.os, kind: 'aivudaos-settings' });
        if (request.method === 'GET' && url.pathname === '/api/v1/store/target') return json(response, 200, { url: this.endpoints.store, kind: 'aivudaappstore' });
        const match = url.pathname.match(/^\/api\/v1\/workspace\/(projects|experiments)$/);
        if (match && request.method === 'GET') return json(response, 200, { kind: match[1], items: listItems(this.paths, match[1]) });
        if (match && request.method === 'POST') { const body = JSON.parse(await readBody(request) || '{}'); return json(response, 201, { kind: match[1], name: createItem(this.paths, match[1], body.name) }); }
        json(response, 404, { error: 'not_found' });
      } catch (error) { json(response, /Unknown|Invalid|Use a name|JSON/.test(error.message) ? 400 : 500, { error: error.message }); }
    });
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(port, '127.0.0.1', resolve); });
    this.port = this.server.address().port;
    this.url = `http://127.0.0.1:${this.port}`;
    return this.url;
  }
  setBootstrap(status, details = {}) { this.bootstrap = { status, ...details }; }
  async stop() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  }
}
module.exports = { ControlServer };
