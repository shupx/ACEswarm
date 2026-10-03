const http = require('node:http');
const { listItems } = require('../services/workspace-items');

const MCP_TOOLS = [
  { name: 'aceswarm_get_runtime_status', description: 'Read ACEswarm local service endpoints and failures.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aceswarm_list_pages', description: 'List ACEswarm navigation pages.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aceswarm_list_workspace', description: 'List names in a workspace collection.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['projects', 'experiments'] } }, required: ['kind'], additionalProperties: false } },
];

function json(response, status, value) {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (_) { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); }
}

function runtime(config) { return { endpoints: config.endpoints, failures: config.failures || [] }; }
function workspace(config, kind) {
  if (!['projects', 'experiments'].includes(kind)) throw Object.assign(new Error('kind must be projects or experiments'), { statusCode: 400 });
  return { kind, items: listItems(config.workspace, kind) };
}

function mcpResult(config, request) {
  const method = request.method;
  if (method === 'initialize') return { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'aceswarm-control', version: '0.1.0' } };
  if (method === 'notifications/initialized') return null;
  if (method === 'tools/list') return { tools: MCP_TOOLS };
  if (method === 'tools/call') {
    const name = request.params?.name;
    let value;
    if (name === 'aceswarm_get_runtime_status') value = runtime(config);
    else if (name === 'aceswarm_list_pages') value = { pages: config.pages || [] };
    else if (name === 'aceswarm_list_workspace') value = workspace(config, request.params?.arguments?.kind);
    else throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  }
  throw Object.assign(new Error(`Unsupported MCP method: ${method}`), { code: -32601 });
}

function createControlServer(config) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true, service: 'aceswarm-control' });
      if (request.method === 'GET' && url.pathname === '/runtime/status') return json(response, 200, runtime(config));
      if (request.method === 'GET' && url.pathname === '/pages') return json(response, 200, { pages: config.pages || [] });
      if (request.method === 'GET' && url.pathname === '/workspace') return json(response, 200, workspace(config, url.searchParams.get('kind') || 'projects'));
      if (url.pathname === '/mcp') {
        // Streamable HTTP clients may probe the session and clean it up after use.
        if (request.method === 'GET') {
          response.writeHead(405, { allow: 'POST, DELETE', 'content-type': 'application/json; charset=utf-8' });
          return response.end(JSON.stringify({ error: 'Use POST for JSON-RPC messages.' }));
        }
        if (request.method === 'DELETE') return response.writeHead(204).end();
        if (request.method !== 'POST') return json(response, 405, { error: 'method_not_allowed' });
        const rpc = await readJson(request);
        const result = mcpResult(config, rpc);
        response.setHeader('mcp-session-id', 'aceswarm-local');
        // Streamable HTTP clients may send notifications during the handshake.
        // Always return an explicit JSON content type, even when there is no result.
        if (rpc.method === 'notifications/initialized') return json(response, 202, {});
        return json(response, 200, { jsonrpc: '2.0', id: rpc.id ?? null, result });
      }
      return json(response, 404, { error: 'not_found' });
    } catch (error) {
      const code = error.code || -32603;
      const status = error.statusCode || (code === -32601 ? 404 : 400);
      return json(response, status, { jsonrpc: '2.0', id: null, error: { code, message: error.message } });
    }
  });
}

module.exports = { createControlServer, MCP_TOOLS };
