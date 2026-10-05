const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { prepareGateway } = require('./gateway');
const { fixed } = require('./pages');
const { pythonModuleArgs } = require('./python-module');

const GATEWAY_PORT = Number(process.env.ACESWARM_GATEWAY_PORT || 28790);
const STORE_GATEWAY_PORT = Number(process.env.ACESWARM_STORE_GATEWAY_PORT || 28791);

function validateFixedPort(port, name) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`${name} must be an integer between 1024 and 65535`);
  return port;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, child, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.spawnError || child.exitCode !== null || child.signalCode !== null || !child.pid) {
      throw new Error(`Process exited while starting ${url}: ${child.spawnError?.message || child.exitCode || child.signalCode || 'no pid'}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
      if (response.ok) return;
    } catch (_) { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class LocalServices {
  constructor(paths, runtime) {
    this.paths = paths;
    this.runtime = runtime;
    this.children = [];
    this.failures = [];
  }

  launch(name, binary, args, environment = {}, keepStdin = false) {
    if (this.stopping) throw new Error('Services are shutting down');
    if (!this.guardian) {
      this.guardian = spawn(process.execPath, [path.join(__dirname, 'process-guardian.js')], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
      this.guardian.on('error', (error) => this.failures.push(`Process guardian: ${error.message}`));
      this.guardian.stdin.on('error', (error) => this.failures.push(`Process guardian pipe: ${error.message}`));
    }
    const log = fs.createWriteStream(path.join(this.paths.logs, `${name}.log`), { flags: 'a' });
    const env = { ...process.env, ...environment };
    delete env.PYTHONHOME;
    if (this.runtime.packaged) delete env.PYTHONPATH;
    const child = spawn(binary, args, {
      env,
      detached: true,
      stdio: [keepStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on('error', (error) => this.failures.push(`${name}: ${error.message}`));
    child.on('error', (error) => { child.spawnError = error; });
    child.on('exit', (code, signal) => {
      log.write(`\n${name} exited (${code ?? signal})\n`);
      log.end();
      if (!this.stopping) this.failures.push(`${name} exited (${code ?? signal}); see ${path.join(this.paths.logs, `${name}.log`)}`);
    });
    this.children.push(child);
    if (child.pid) this.guardian.stdin.write(`${child.pid}\n`);
    return child;
  }

  async start() {
    const gatewayPort = validateFixedPort(GATEWAY_PORT, 'ACESWARM_GATEWAY_PORT');
    const storeGatewayPort = validateFixedPort(STORE_GATEWAY_PORT, 'ACESWARM_STORE_GATEWAY_PORT');
    const [osPort, storePort, adminPort] = await Promise.all([
      freePort(), freePort(), freePort(),
    ]);
    if (new Set([osPort, storePort, gatewayPort, adminPort, storeGatewayPort]).size !== 5) throw new Error('Port allocation collision; retry launch');
    const gateway = prepareGateway(this.paths, this.runtime, gatewayPort, osPort, adminPort, storeGatewayPort, storePort);
    const caddyEnvironment = {
      XDG_CONFIG_HOME: path.join(this.paths.os, 'caddy-config'),
      XDG_DATA_HOME: path.join(this.paths.os, 'caddy-data'),
    };
    const common = this.runtime.packaged ? {} : {
      PYTHONPATH: this.runtime.pythonPath,
    };
    const osChild = this.launch('aivudaos', this.runtime.python,
      pythonModuleArgs(this.runtime, 'uvicorn', ['aivudaos.gateway.main:app', '--host', '127.0.0.1', '--port', String(osPort)]), {
        ...common, ...caddyEnvironment, AIVUDAOS_EMBEDDED_MODE: '1', AIVUDAOS_WS_ROOT: this.paths.os,
        AIVUDAOS_PACKAGE_ROOT: path.join(this.runtime.osRoot, 'aivudaos', 'resources'),
      });
    await waitFor(`http://127.0.0.1:${osPort}/openapi.json`, osChild);
    const storeChild = this.launch('aivudaappstore', this.runtime.python,
      pythonModuleArgs(this.runtime, 'uvicorn', ['aivudaappstore.backend.app.app:app', '--host', '127.0.0.1', '--port', String(storePort)]), {
        ...common, AIVUDAAPPSTORE_WS_ROOT: this.paths.store,
        AIVUDAAPPSTORE_PACKAGE_ROOT: path.join(this.runtime.storeRoot, 'aivudaappstore', 'resources'),
      });
    await waitFor(`http://127.0.0.1:${storePort}/openapi.json`, storeChild);
    const gatewayChild = this.launch('gateway', gateway.binary, ['run', '--config', gateway.config], caddyEnvironment);
    await waitFor(`http://127.0.0.1:${gatewayPort}/`, gatewayChild);
    await waitFor(`http://127.0.0.1:${storeGatewayPort}/aivuda_app_store/store/index`, gatewayChild);
    this.endpoints = {
      // UI pages must use the gateway origin: AivudaOS's embedded app iframe
      // uses relative /<app_id>/ui/ URLs that Caddy imports from installed apps.
      os: `http://127.0.0.1:${gatewayPort}/`,
      store: `http://127.0.0.1:${storeGatewayPort}/`,
      gateway: `http://127.0.0.1:${gatewayPort}`,
      osApi: `http://127.0.0.1:${osPort}/`,
      storeApi: `http://127.0.0.1:${storePort}/`,
    };
    return this.endpoints;
  }

  trackRecording(child) {
    if (!child.pid || !this.guardian) return;
    // Negative identifiers track a single PID instead of a detached process group.
    this.guardian.stdin.write(`${-child.pid}\n`);
    child.once('exit', () => {
      if (!this.guardian.stdin.destroyed) this.guardian.stdin.write(`remove ${-child.pid}\n`);
    });
  }

  startPackageMcps() {
    const common = this.runtime.packaged ? {} : { PYTHONPATH: this.runtime.pythonPath };
    this.startMcpPackage('aivudaos-mcp', 'aivudaos.mcp_server', {
      ...common,
      AIVUDAOS_MCP_BASE_URL: this.endpoints.osApi.replace(/\/$/, ''),
      ...(process.env.AIVUDAOS_MCP_TOKEN ? { AIVUDAOS_MCP_TOKEN: process.env.AIVUDAOS_MCP_TOKEN } : {}),
    });
    this.startMcpPackage('aivudaappstore-mcp', 'aivudaappstore.mcp_server', {
      ...common,
      AIVUDAAPPSTORE_MCP_BASE_URL: this.endpoints.store.replace(/\/$/, '').replace(/\/$/, '') + '/aivuda_app_store',
      ...(process.env.AIVUDAAPPSTORE_MCP_TOKEN ? { AIVUDAAPPSTORE_MCP_TOKEN: process.env.AIVUDAAPPSTORE_MCP_TOKEN } : {}),
    });
  }

  startMcpPackage(name, moduleName, environment) {
    return this.launch(name, this.runtime.python, pythonModuleArgs(this.runtime, moduleName), environment, true);
  }

  stop() {
    if (!this.stopPromise) this.stopPromise = this.stopChildren();
    return this.stopPromise;
  }

  async stopChildren() {
    this.stopping = true;
    const children = [...this.children].reverse();
    for (const child of children) this.signalGroup(child, 'SIGTERM');
    const deadline = Date.now() + 5000;
    while (children.some((child) => this.groupAlive(child)) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    for (const child of children) if (this.groupAlive(child)) this.signalGroup(child, 'SIGKILL');
    await Promise.all(children.map((child) => new Promise((resolve) => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', resolve);
    })));
    const killDeadline = Date.now() + 1000;
    while (children.some((child) => this.groupAlive(child)) && Date.now() < killDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    for (const child of children) if (this.groupAlive(child)) this.failures.push(`Shutdown process group ${child.pid} still exists`);
    if (this.guardian) {
      const guardian = this.guardian;
      const exited = new Promise((resolve) => {
        if (guardian.exitCode !== null || guardian.signalCode !== null) return resolve();
        guardian.once('exit', resolve);
      });
      guardian.kill('SIGTERM');
      await exited;
    }
  }

  groupAlive(child) {
    if (!child.pid) return false;
    try { process.kill(-child.pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
  }

  signalGroup(child, signal) {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) {
      if (error.code !== 'ESRCH') this.failures.push(`Shutdown ${child.pid}: ${error.message}`);
    }
  }
}
module.exports = { LocalServices, freePort, waitFor, GATEWAY_PORT, STORE_GATEWAY_PORT };
