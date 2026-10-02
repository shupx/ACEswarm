const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { prepareGateway } = require('./gateway');

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

  launch(name, binary, args, environment = {}) {
    const log = fs.createWriteStream(path.join(this.paths.logs, `${name}.log`), { flags: 'a' });
    const env = { ...process.env, ...environment };
    if (!this.runtime.packaged) delete env.PYTHONHOME;
    const child = spawn(binary, args, {
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
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
    return child;
  }

  async start() {
    const [osPort, storePort, gatewayPort, adminPort, storeGatewayPort] = await Promise.all([freePort(), freePort(), freePort(), freePort(), freePort()]);
    if (new Set([osPort, storePort, gatewayPort, adminPort, storeGatewayPort]).size !== 5) throw new Error('Port allocation collision; retry launch');
    const gateway = prepareGateway(this.paths, this.runtime, gatewayPort, osPort, adminPort, storeGatewayPort, storePort);
    const caddyEnvironment = {
      XDG_CONFIG_HOME: path.join(this.paths.os, 'caddy-config'),
      XDG_DATA_HOME: path.join(this.paths.os, 'caddy-data'),
    };
    const common = this.runtime.packaged ? {
      PYTHONHOME: path.join(this.runtime.resourcesPath, 'python-runtime'),
      PYTHONPATH: path.join(this.runtime.resourcesPath, 'python-packages'),
    } : {
      PYTHONPATH: [this.runtime.osRoot, this.runtime.storeRoot, this.runtime.packages, process.env.PYTHONPATH || '']
        .filter(Boolean).join(path.delimiter),
    };
    const osChild = this.launch('aivudaos', this.runtime.python,
      ['-m', 'uvicorn', 'aivudaos.gateway.main:app', '--host', '127.0.0.1', '--port', String(osPort)], {
        ...common, ...caddyEnvironment, AIVUDAOS_EMBEDDED_MODE: '1', AIVUDAOS_WS_ROOT: this.paths.os,
        AIVUDAOS_PACKAGE_ROOT: path.join(this.runtime.osRoot, 'aivudaos', 'resources'),
      });
    await waitFor(`http://127.0.0.1:${osPort}/openapi.json`, osChild);
    const storeChild = this.launch('aivudaappstore', this.runtime.python,
      ['-m', 'uvicorn', 'aivudaappstore.backend.app.app:app', '--host', '127.0.0.1', '--port', String(storePort)], {
        ...common, AIVUDAAPPSTORE_WS_ROOT: this.paths.store,
        AIVUDAAPPSTORE_PACKAGE_ROOT: path.join(this.runtime.storeRoot, 'aivudaappstore', 'resources'),
      });
    await waitFor(`http://127.0.0.1:${storePort}/openapi.json`, storeChild);
    const gatewayChild = this.launch('gateway', gateway.binary, ['run', '--config', gateway.config], caddyEnvironment);
    await waitFor(`http://127.0.0.1:${gatewayPort}/`, gatewayChild);
    await waitFor(`http://127.0.0.1:${storeGatewayPort}/aivuda_app_store/store/index`, gatewayChild);
    this.endpoints = {
      os: `http://127.0.0.1:${osPort}/`,
      store: `http://127.0.0.1:${storeGatewayPort}/`,
      gateway: `http://127.0.0.1:${gatewayPort}`,
    };
    return this.endpoints;
  }

  async stop() {
    this.stopping = true;
    const children = [...this.children].reverse();
    for (const child of children) this.signalGroup(child, 'SIGTERM');
    await Promise.all(children.map((child) => new Promise((resolve) => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return resolve();
      const timer = setTimeout(() => { this.signalGroup(child, 'SIGKILL'); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    })));
  }

  signalGroup(child, signal) {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch (error) {
      if (error.code !== 'ESRCH') this.failures.push(`Shutdown ${child.pid}: ${error.message}`);
    }
  }
}
module.exports = { LocalServices, freePort, waitFor };
