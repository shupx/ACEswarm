const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const LIMIT = 64 * 1024 * 1024;
const management = {
  list_devices: {},
  add_device: { device_id: { type: 'string' }, mcp_url: { type: 'string' }, timeout_seconds: { type: 'number', minimum: 1, maximum: 120 }, ca_file: { type: 'string' }, insecure: { type: 'boolean', default: false, description: 'Skip HTTPS certificate and hostname verification for this device.' } },
  update_device: { device_id: { type: 'string' }, mcp_url: { type: 'string' }, timeout_seconds: { type: 'number', minimum: 1, maximum: 120 }, ca_file: { type: 'string' }, insecure: { type: 'boolean', default: false, description: 'Skip HTTPS certificate and hostname verification for this device.' } },
  remove_device: { device_id: { type: 'string' } },
  get_device_status: { device_id: { type: 'string' } },
  reconnect_device: { device_id: { type: 'string' } },
};

function settings(input) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(input.device_id || '')) throw new Error('Invalid device_id');
  const url = new URL(input.mcp_url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
    throw new Error('mcp_url must be an HTTP(S) URL without credentials, query or fragment');
  }
  const timeout = input.timeout_seconds ?? 90;
  if (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout < 1 || timeout > 120) throw new Error('timeout_seconds must be between 1 and 120');
  const ca = input.ca_file || '';
  if (typeof ca !== 'string' || (ca && !path.isAbsolute(ca))) throw new Error('ca_file must be an absolute certificate path');
  const insecure = input.insecure ?? false;
  if (typeof insecure !== 'boolean') throw new Error('insecure must be a boolean');
  return { insecure, device_id: input.device_id, mcp_url: url.href, timeout_seconds: timeout, ca_file: ca };
}

function upstream(device, method, params = {}, authorization = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(device.mcp_url);
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
    if (body.length > LIMIT) return reject(new Error('Upstream request exceeds 64 MiB'));
    const headers = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', 'Content-Length': body.length };
    if (authorization) headers.Authorization = authorization;
    let request;
    let timer;
    const fail = error => { clearTimeout(timer); reject(error); };
    try {
      request = (url.protocol === 'https:' ? https : http).request(url, {
        method: 'POST', headers,
        rejectUnauthorized: !device.insecure,
        ...(device.ca_file ? { ca: fs.readFileSync(device.ca_file) } : {}),
      }, response => {
        const chunks = [];
        let bytes = 0;
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > LIMIT) request.destroy(new Error('Upstream response exceeds 64 MiB'));
          else chunks.push(chunk);
        });
        response.on('error', fail);
        response.on('end', () => {
          clearTimeout(timer);
          try {
            if (response.statusCode !== 200) throw new Error(`Upstream HTTP ${response.statusCode}`);
            const message = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (message.jsonrpc !== '2.0' || message.id !== 1 || message.error || !message.result || typeof message.result !== 'object') {
              throw new Error('Invalid or rejected upstream MCP response');
            }
            resolve(message.result);
          } catch (error) { reject(error); }
        });
      });
      timer = setTimeout(() => request.destroy(new Error('Upstream request timed out')), device.timeout_seconds * 1000);
      request.on('error', fail);
      request.end(body);
    } catch (error) { fail(error); }
  });
}

class Gateway {
  constructor({ localUrl, registryFile }) {
    this.registryFile = registryFile;
    this.devices = new Map([['local', settings({ device_id: 'local', mcp_url: localUrl, timeout_seconds: 90 })]]);
    this.queue = Promise.resolve();
    if (registryFile && fs.existsSync(registryFile)) {
      const saved = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.devices)) throw new Error('Invalid device registry');
      for (const input of saved.devices) {
        const device = settings(input);
        if (device.device_id === 'local' || this.devices.has(device.device_id)) throw new Error('Duplicate/reserved device in registry');
        this.devices.set(device.device_id, device);
      }
    }
  }

  persist() {
    if (!this.registryFile) return;
    fs.mkdirSync(path.dirname(this.registryFile), { recursive: true });
    const temporary = this.registryFile + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify({ version: 1, devices: [...this.devices.values()]
      .filter(device => device.device_id !== 'local').map(({ device_id, mcp_url, timeout_seconds, ca_file, insecure }) => ({ device_id, mcp_url, timeout_seconds, ca_file, insecure })) }, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, this.registryFile);
  }

  async discover(device) {
    if (device.connecting) return device.connecting;
    device.connecting = (async () => {
      try {
        const initialized = await upstream(device, 'initialize', { protocolVersion: VERSIONS[0], capabilities: {}, clientInfo: { name: 'aceswarm-aivudaos-gateway', version: '1.0' } });
        if (!VERSIONS.includes(initialized.protocolVersion)) throw new Error('Unsupported upstream MCP protocol');
        const tools = [];
        let cursor;
        const cursors = new Set();
        do {
          const page = await upstream(device, 'tools/list', cursor ? { cursor } : {});
          if (!Array.isArray(page.tools)) throw new Error('Invalid upstream tool list');
          for (const tool of page.tools) {
            if (typeof tool.name !== 'string' || !tool.inputSchema || tool.inputSchema.type !== 'object') throw new Error('Invalid upstream tool schema');
            if (Object.hasOwn(management, tool.name) || tool.inputSchema.properties?.device_id || tools.some(item => item.name === tool.name)) throw new Error(`Conflicting upstream tool: ${tool.name}`);
            tools.push(tool);
          }
          cursor = page.nextCursor;
          if (cursor && (typeof cursor !== 'string' || cursors.has(cursor))) throw new Error('Invalid upstream pagination');
          cursors.add(cursor);
        } while (cursor);
        device.tools = tools;
        device.server_info = initialized.serverInfo;
        device.status = 'connected';
        delete device.error;
      } catch (error) {
        device.status = 'unavailable';
        device.error = error.message;
        throw error;
      } finally { delete device.connecting; }
    })();
    return device.connecting;
  }

  info(device) {
    return { device_id: device.device_id, mcp_url: device.mcp_url, timeout_seconds: device.timeout_seconds,
      ca_file: device.ca_file, insecure: device.insecure, status: device.status || 'not_connected', server_info: device.server_info,
      tool_count: device.tools?.length || 0, error: device.error };
  }

  tools() {
    const deviceProperty = { type: 'string', default: 'local', description: 'Registered target device; omitted means local.' };
    return [
      ...Object.entries(management).map(([name, properties]) => ({ name, description: `ACEswarm device registry: ${name}`,
        inputSchema: { type: 'object', properties, additionalProperties: false,
          required: name === 'add_device' ? ['device_id', 'mcp_url'] : name === 'list_devices' ? [] : ['device_id'] } })),
      ...(this.devices.get('local').tools || []).map(tool => ({ ...tool,
        description: (tool.description || '') + '\nForwarded to device_id (default local).',
        inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, device_id: deviceProperty } } })),
    ];
  }

  async manage(name, args) {
    const properties = management[name];
    if (Object.keys(args).some(key => !Object.hasOwn(properties, key))) throw new Error('Unknown device management argument');
    if (name === 'list_devices') return { devices: [...this.devices.values()].map(device => this.info(device)) };
    if (typeof args.device_id !== 'string') throw new Error('device_id is required');
    const existing = this.devices.get(args.device_id);
    if (name === 'get_device_status' || name === 'reconnect_device') {
      if (!existing) throw new Error('Unknown device_id');
      try {
        if (name === 'reconnect_device' || !existing.tools) await this.discover(existing);
        else await upstream(existing, 'ping');
        existing.status = 'connected';
        delete existing.error;
      } catch (error) { existing.status = 'unavailable'; existing.error = error.message; }
      return this.info(existing);
    }
    if (args.device_id === 'local') throw new Error('The local device cannot be modified or removed');
    if (name === 'remove_device') {
      if (!existing) throw new Error('Unknown device_id');
      this.devices.delete(args.device_id);
      try { this.persist(); } catch (error) { this.devices.set(args.device_id, existing); throw error; }
      return { removed: args.device_id };
    }
    if (name === 'add_device' && existing) throw new Error('device_id already exists');
    if (name === 'update_device' && !existing) throw new Error('Unknown device_id');
    const next = settings({ ...existing, ...args });
    await this.discover(next);
    this.devices.set(next.device_id, next);
    try { this.persist(); } catch (error) {
      if (existing) this.devices.set(next.device_id, existing);
      else this.devices.delete(next.device_id);
      throw error;
    }
    return this.info(next);
  }

  async call(name, args, authorization) {
    if (Object.hasOwn(management, name)) {
      const operation = this.queue.then(() => this.manage(name, args));
      this.queue = operation.catch(() => {});
      return { content: [{ type: 'text', text: JSON.stringify(await operation) }] };
    }
    if (!this.devices.get('local').tools.some(tool => tool.name === name)) throw new Error('Unknown tool');
    const { device_id = 'local', ...arguments_ } = args;
    const device = this.devices.get(device_id);
    if (!device) throw new Error('Unknown device_id');
    try {
      if (!device.tools) await this.discover(device);
      if (!device.tools.some(tool => tool.name === name)) throw new Error(`Target does not support tool ${name}`);
      // Request-header credentials belong to the gateway's local target only.
      // Remote tokens must be explicitly supplied in the selected tool call.
      if (authorization && device_id !== 'local' && !Object.hasOwn(arguments_, 'token')) {
        throw new Error('For remote devices pass that device API token explicitly; gateway Bearer credentials are local-only');
      }
      const result = await upstream(device, 'tools/call', { name, arguments: arguments_ }, device_id === 'local' ? authorization : '');
      if (result.isError) return { ...result, content: [{ type: 'text', text: `Device ${device_id}: upstream tool failed` }, ...(result.content || [])] };
      device.status = 'connected';
      delete device.error;
      return result;
    } catch (error) {
      throw new Error(`Device ${device_id}: ${error.message}`);
    }
  }

  async handle(message, authorization = '') {
    const id = message?.id ?? null;
    const error = (code, text) => ({ jsonrpc: '2.0', id, error: { code, message: text } });
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return error(-32600, 'Invalid Request');
    if (!Object.hasOwn(message, 'id')) return null;
    if (!['string', 'number'].includes(typeof id) || typeof id === 'number' && !Number.isInteger(id)) return error(-32600, 'Invalid request id');
    const params = message.params || {};
    if (typeof params !== 'object' || Array.isArray(params)) return error(-32602, 'Invalid params');
    let result;
    if (message.method === 'initialize') result = { protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'aceswarm-aivudaos-gateway', version: '1.0' } };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') result = { tools: this.tools() };
    else if (message.method === 'tools/call') {
      if (typeof params.name !== 'string' || params.arguments && (typeof params.arguments !== 'object' || Array.isArray(params.arguments))) return error(-32602, 'Invalid tool params');
      try { result = await this.call(params.name, params.arguments || {}, authorization); }
      catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
    } else return error(-32601, 'Method not found');
    return { jsonrpc: '2.0', id, result };
  }
}

async function startGateway({ port, localUrl, registryFile }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid gateway port');
  const gateway = new Gateway({ localUrl, registryFile });
  await gateway.discover(gateway.devices.get('local'));
  const server = http.createServer(async (request, response) => {
    const send = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(value === undefined ? '' : JSON.stringify(value));
    };
    try {
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(request.headers.host) ||
          request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) return send(403);
      if (request.url === '/health' && request.method === 'GET') return send(200, { status: 'ok', transport: 'streamable-http' });
      if (request.url !== '/mcp') return send(404);
      if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); return send(405); }
      if (request.headers['mcp-session-id']) return send(404);
      const version = request.headers['mcp-protocol-version'] || '2025-03-26';
      if (!VERSIONS.includes(version)) return send(400);
      if (!request.headers.accept?.includes('application/json') || !request.headers.accept?.includes('text/event-stream')) return send(406);
      if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') return send(415);
      let bytes = 0;
      const chunks = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > LIMIT) return send(413);
        chunks.push(chunk);
      }
      let message;
      try { message = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch (_) { return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
      if (Array.isArray(message)) {
        if (!message.length || version === VERSIONS[0]) return send(400);
        const results = [];
        for (const item of message) {
          const result = await gateway.handle(item, request.headers.authorization || '');
          if (result) results.push(result);
        }
        return results.length ? send(200, results) : send(202);
      }
      const result = await gateway.handle(message, request.headers.authorization || '');
      return result ? send(200, result) : send(202);
    } catch (_) { if (!response.headersSent) send(500, { error: 'Gateway request failed' }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { gateway, server };
}

if (require.main === module) {
  const [port, localUrl, registryFile] = process.argv.slice(2);
  startGateway({ port: Number(port), localUrl, registryFile }).then(({ server }) => {
    const close = () => { server.close(); server.closeAllConnections(); };
    process.once('SIGTERM', close);
    process.once('SIGINT', close);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { Gateway, startGateway, upstream, settings };
