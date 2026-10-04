const fs = require('node:fs');
const path = require('node:path');

function gatewayConfig({ port, osPort, adminPort = port + 1, uiRoot, storeGatewayPort, storePort, storeFilesRoot, storeUiRoot }) {
  const ui = JSON.stringify(uiRoot);
  const storeSite = storeGatewayPort && storePort && storeFilesRoot ? `
http://127.0.0.1:${storeGatewayPort} {
  bind 127.0.0.1
  handle_path /aivuda_app_store/files/* {
    root * ${JSON.stringify(storeFilesRoot)}
    file_server
  }
  @storeApi path /aivuda_app_store/* /openapi.json /docs /docs/* /redoc
  handle @storeApi {
    reverse_proxy 127.0.0.1:${storePort}
  }
  handle {
    encode zstd gzip
    root * ${JSON.stringify(storeUiRoot)}
    try_files {path} /index.html
    file_server
  }
}
` : '';
  return `{\n  admin 127.0.0.1:${adminPort}\n}\n(aivudaos_common_route) {
  @api path /aivuda_os/api*
  route {
    handle @api {
      reverse_proxy 127.0.0.1:${osPort}
    }
    # BEGIN AIVUDA APP IMPORTS
    # END AIVUDA APP IMPORTS
    handle {
      encode zstd gzip
      root * ${ui}
      try_files {path} /index.html
      file_server
    }
  }
}
http://127.0.0.1:${port} {
  bind 127.0.0.1
  import aivudaos_common_route
}${storeSite}
`;
}

function prepareGateway(paths, runtime, port, osPort, adminPort, storeGatewayPort, storePort) {
  const binary = path.join(paths.os, '.tools', 'caddy', 'caddy');
  const config = path.join(paths.os, 'config', 'Caddyfile');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.mkdirSync(path.dirname(config), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(binary), '.caddy-'));
  try {
    const stagedBinary = path.join(staging, 'caddy');
    fs.writeFileSync(stagedBinary, fs.readFileSync(runtime.caddy));
    fs.chmodSync(stagedBinary, 0o755);
    fs.renameSync(stagedBinary, binary);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  const uiRoot = path.join(runtime.osRoot, 'aivudaos', 'resources', 'ui', 'dist');
  if (!fs.existsSync(path.join(uiRoot, 'index.html'))) throw new Error(`AivudaOS UI not built: ${uiRoot}`);
  const storeUiRoot = storeGatewayPort && storePort
    ? path.join(runtime.storeRoot, 'aivudaappstore', 'resources', 'ui', 'dist') : undefined;
  if (storeUiRoot && !fs.existsSync(path.join(storeUiRoot, 'index.html'))) throw new Error(`AppStore UI not built: ${storeUiRoot}`);
  const previous = fs.existsSync(config) ? fs.readFileSync(config, 'utf8') : '';
  const match = previous.match(/^    # BEGIN AIVUDA APP IMPORTS\n([\s\S]*?)^    # END AIVUDA APP IMPORTS$/m);
  if (previous && !match) throw new Error(`Gateway import markers missing: ${config}`);
  const imports = match ? match[1] : '';
  if (imports.split('\n').some((line) => line.trim() && !/^\s*import "[^"\n]+"\s*$/.test(line))) {
    throw new Error(`Unexpected gateway imports: ${config}`);
  }
  const generated = gatewayConfig({ port, osPort, adminPort, uiRoot, storeGatewayPort, storePort, storeUiRoot, storeFilesRoot: path.join(paths.store, 'data', 'files') }).replace(
    '    # BEGIN AIVUDA APP IMPORTS\n', `    # BEGIN AIVUDA APP IMPORTS\n${imports}`,
  );
  fs.writeFileSync(config, generated);
  return { binary, config };
}
module.exports = { gatewayConfig, prepareGateway };
