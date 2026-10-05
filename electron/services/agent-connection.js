const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

function configureBrowserConnection(app) {
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  // Preserve the port supplied by Playwright's Electron test launcher.
  if (!app.commandLine.hasSwitch('remote-debugging-port')) app.commandLine.appendSwitch('remote-debugging-port', '0');
  const port = Number(app.commandLine.getSwitchValue('remote-debugging-port'));
  const activePortFile = path.join(app.getPath('userData'), 'DevToolsActivePort');
  if (port === 0) fs.rmSync(activePortFile, { force: true });
  return { port, activePortFile };
}

async function readBrowserConnection(configuration, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const lines = configuration.port === 0 ? fs.readFileSync(configuration.activePortFile, 'utf8').trim().split(/\r?\n/) : [];
      const port = configuration.port || Number(lines[0]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CDP port');
      const cdpEndpoint = `http://127.0.0.1:${port}`;
      const response = await fetch(`${cdpEndpoint}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (!response.ok) throw new Error('CDP is unavailable');
      const version = await response.json();
      const ws = new URL(version.webSocketDebuggerUrl);
      if (Number(ws.port) !== port || !['127.0.0.1', 'localhost'].includes(ws.hostname) ||
          (lines.length && ws.pathname !== lines[1])) throw new Error('CDP endpoint does not match this session');
      ws.hostname = '127.0.0.1';
      return { cdpEndpoint, browserWSEndpoint: ws.href };
    } catch (_) { /* Chromium writes DevToolsActivePort asynchronously. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for ACEswarm browser CDP endpoint');
}

async function startAgentConnection({ configuration, stateDirectory, port = Number(process.env.ACESWARM_MCP_PORT || 28792) }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('ACESWARM_MCP_PORT must be an integer between 0 and 65535');
  const browser = await readBrowserConnection(configuration);
  const active = new Set();
  let connection;
  const server = http.createServer(async (request, response) => {
    const authority = `127.0.0.1:${server.address().port}`;
    if (![authority, `localhost:${server.address().port}`].includes(request.headers.host) || request.headers.origin) {
      response.writeHead(403).end('Local agent clients only');
      return;
    }
    if (request.url !== '/mcp') { response.writeHead(404).end(); return; }
    if (request.method !== 'POST') { response.writeHead(405, { Allow: 'POST' }).end(); return; }
    const mcp = new McpServer({ name: 'aceswarm-browser', version: '1.0.0' }, {
      instructions: 'Call get_browser_connection, then attach Playwright chromium.connectOverCDP to cdpEndpoint. Reuse existing pages to control the running ACEswarm desktop and webviews. Disconnect with browser.close(); never send Browser.close through CDP.',
    });
    mcp.registerTool('get_browser_connection', {
      description: 'Get the running ACEswarm Playwright CDP connection, current page targets, and attachment examples.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    }, async () => {
      const result = await fetch(`${browser.cdpEndpoint}/json/list`, { signal: AbortSignal.timeout(2000) });
      if (!result.ok) throw new Error('ACEswarm browser is unavailable');
      const targets = await result.json();
      const details = {
        ...connection,
        targets: targets.map(({ id, type, title, url }) => ({ id, type, title, url })),
        javascript: `const { chromium } = require('playwright');\nconst browser = await chromium.connectOverCDP('${browser.cdpEndpoint}');\nconst pages = browser.contexts().flatMap(context => context.pages());\n// Reuse an existing page. browser.close() disconnects this client.`,
        python: `from playwright.async_api import async_playwright\nasync with async_playwright() as p:\n    browser = await p.chromium.connect_over_cdp('${browser.cdpEndpoint}')\n    pages = [page for context in browser.contexts for page in context.pages]\n    # Reuse an existing page. await browser.close() disconnects this client.`,
        notes: 'CDP controls renderer pages, not Electron main-process APIs. Electron webviews may appear as separate targets; enumerate pages and frames. Do not launch a new browser or close user pages.',
      };
      return { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }], structuredContent: details };
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    active.add(mcp);
    response.once('close', () => { active.delete(mcp); mcp.close().catch(() => {}); });
    try {
      await mcp.connect(transport);
      await transport.handleRequest(request, response);
    } catch (error) {
      console.error('ACEswarm agent MCP:', error.message);
      if (!response.headersSent) response.writeHead(500).end('MCP request failed');
      else response.end();
    }
  });
  server.requestTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  server.on('error', error => console.error('ACEswarm agent MCP:', error.message));
  connection = { pid: process.pid, ...browser, mcpUrl: `http://127.0.0.1:${server.address().port}/mcp`, transport: 'streamable-http' };
  const discoveryFile = path.join(stateDirectory, 'agent-connection.json');
  let stopPromise;
  const stop = () => {
    if (!stopPromise) stopPromise = (async () => {
      await Promise.allSettled([...active].map(mcp => mcp.close()));
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
      try {
        if (JSON.parse(fs.readFileSync(discoveryFile, 'utf8')).pid === process.pid) fs.rmSync(discoveryFile, { force: true });
      } catch (error) { if (error.code !== 'ENOENT') console.error('ACEswarm agent discovery cleanup:', error.message); }
    })();
    return stopPromise;
  };
  try {
    fs.writeFileSync(discoveryFile, JSON.stringify(connection, null, 2), { mode: 0o600 });
  } catch (error) { await stop(); throw error; }
  console.log(`ACEswarm agent MCP: ${connection.mcpUrl}; Playwright CDP: ${browser.cdpEndpoint}`);
  return { connection, stop };
}

module.exports = { configureBrowserConnection, readBrowserConnection, startAgentConnection };
