const readline = require('node:readline');
const CONTROL_URL = process.env.ACESWARM_CONTROL_URL;
if (!CONTROL_URL) { process.stderr.write('ACESWARM_CONTROL_URL is required\n'); process.exit(2); }
async function call(path, options) { const response = await fetch(`${CONTROL_URL}${path}`, options); const body = await response.json(); if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`); return body; }
const tools = [
  { name: 'aceswarm_status', description: 'Read ACEswarm service and bootstrap status.', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aceswarm_list_pages', description: 'List safe ACEswarm page descriptors.', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aceswarm_bootstrap_status', description: 'Read seed bootstrap status.', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'aceswarm_list_workspace_items', description: 'List projects or experiments.', annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['projects', 'experiments'] } }, required: ['kind'], additionalProperties: false } },
  { name: 'aceswarm_create_workspace_item', description: 'Create a project or experiment folder.', inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['projects', 'experiments'] }, name: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['kind', 'name'], additionalProperties: false } },
  { name: 'aceswarm_targets', description: 'Get settings and app store UI targets.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
];
async function result(id, value, error) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error: { code: -32000, message: error.message } } : { result: value }) }) + '\n'); }
async function handle(message) {
  const { id, method, params = {} } = message;
  if (method === 'initialize') return result(id, { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'aceswarm', version: '0.1.0' } });
  if (method === 'notifications/initialized') return;
  if (method === 'tools/list') return result(id, { tools });
  if (method !== 'tools/call') return result(id, null, new Error(`Unsupported method: ${method}`));
  try {
    let value;
    if (params.name === 'aceswarm_status') value = await call('/api/v1/status');
    else if (params.name === 'aceswarm_list_pages') value = await call('/api/v1/pages');
    else if (params.name === 'aceswarm_bootstrap_status') value = await call('/api/v1/bootstrap');
    else if (params.name === 'aceswarm_list_workspace_items') value = await call(`/api/v1/workspace/${encodeURIComponent(params.arguments?.kind || '')}`);
    else if (params.name === 'aceswarm_create_workspace_item') value = await call(`/api/v1/workspace/${encodeURIComponent(params.arguments?.kind || '')}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: params.arguments?.name }) });
    else if (params.name === 'aceswarm_targets') value = { settings: await call('/api/v1/settings/target'), store: await call('/api/v1/store/target') };
    else throw new Error(`Unknown tool: ${params.name}`);
    return result(id, { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, isError: false });
  } catch (error) { return result(id, null, error); }
}
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => { try { handle(JSON.parse(line)); } catch (error) { result(null, null, error); } });
