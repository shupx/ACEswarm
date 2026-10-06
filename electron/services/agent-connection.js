const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

function configureBrowserConnection(app, env = process.env) {
  const configuredPort = env.ACESWARM_CDP_PORT ?? '0';
  if (!/^\d+$/.test(configuredPort) || Number(configuredPort) > 65535) {
    throw new Error('ACESWARM_CDP_PORT must be an integer between 0 and 65535');
  }
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  // Playwright's Electron launcher supplies its own port.
  const launcherPort = app.commandLine.hasSwitch('remote-debugging-port');
  if (!launcherPort) app.commandLine.appendSwitch('remote-debugging-port', configuredPort);
  const port = Number(app.commandLine.getSwitchValue('remote-debugging-port'));
  const activePortFile = path.join(app.getPath('userData'), 'DevToolsActivePort');
  if (port === 0) fs.rmSync(activePortFile, { force: true });
  return { port, activePortFile, launcherPort };
}

function checkBrowserPort(configuration) {
  if (configuration.port === 0 || configuration.launcherPort) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', error => reject(new Error(`ACEswarm CDP port ${configuration.port} is unavailable: ${error.message}. Set ACESWARM_CDP_PORT to another port.`)));
    probe.listen(configuration.port, '127.0.0.1', () => probe.close(resolve));
  });
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
      const ws = new URL((await response.json()).webSocketDebuggerUrl);
      if (Number(ws.port) !== port || !['127.0.0.1', 'localhost'].includes(ws.hostname) ||
          (lines.length && ws.pathname !== lines[1])) throw new Error('CDP endpoint does not match this session');
      ws.hostname = '127.0.0.1';
      return { cdpEndpoint, browserWSEndpoint: ws.href };
    } catch (_) { /* Chromium initializes CDP asynchronously. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for ACEswarm browser CDP endpoint');
}

async function startAgentConnection({ configuration, stateDirectory, services }) {
  const browser = await readBrowserConnection(configuration);
  const mcpUrl = await services.startBrowserMcp(browser);
  const connection = { pid: process.pid, ...browser, mcpUrl, transport: 'streamable-http' };
  const discoveryFile = path.join(stateDirectory, 'agent-connection.json');
  const stop = async () => {
    try {
      if (JSON.parse(fs.readFileSync(discoveryFile, 'utf8')).pid === process.pid) fs.rmSync(discoveryFile, { force: true });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
  fs.writeFileSync(discoveryFile, JSON.stringify(connection, null, 2), { mode: 0o600 });
  console.log(`ACEswarm Playwright MCP CDP: ${browser.cdpEndpoint}`);
  return { connection, stop };
}

module.exports = { configureBrowserConnection, checkBrowserPort, readBrowserConnection, startAgentConnection };
