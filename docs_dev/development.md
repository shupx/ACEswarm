## One-command development setup

From a fresh clone:

```bash
git clone https://github.com/shupx/ACEswarm.git
cd ACEswarm
npm run setup:dev
npm run dev
```

The setup script creates `.venv`, installs both submodule requirement sets, initializes the submodules, builds their frontends, and builds the private development runtime. It does not use external sibling checkouts. After setup, `npm run dev` starts ACEswarm with the private runtime and Caddy automatically. Set `ACESWARM_PYTHON` or `ACESWARM_CADDY` only when overriding those defaults.

## Applying source changes

Every invocation of `npm run dev` first rebuilds both submodule frontends and then starts Electron. After changing ACEswarm JavaScript/HTML/CSS, AivudaOS Python, AivudaAppStore Python, or either frontend:

```text
1. Edit the source
2. Stop ACEswarm with Ctrl+C
3. Run npm run dev again
```

The Electron main process and both Python services restart, and both frontend bundles are rebuilt before the new session starts. There is currently no background HMR/watch process; `npm run dev` is the single refresh boundary.

## One-command release build

From the ACEswarm repository:

```bash
npm run build:release
```

The release script initializes submodules, builds the private runtime from checked-out submodule source, verifies the bundle, and produces the AppImage under `dist/`.

## Build requirements

The release build uses the checked-out Git submodules and a private Python runtime. Ensure Node.js/npm, Python build tooling, `tar`, `curl`, `rsync`, compiler tools, and several GB of free disk space are available.

The runtime build does not use external sibling checkouts. It stages `./aivudaOS` and `./aivudaAppStore` into a temporary directory, builds their frontends, builds their Python wheels, and packages the resulting resources into the AppImage.

For a clean release build:

```bash
npm run build:release
```

The resulting artifact is written to:

```text
dist/ACEswarm-<version>-x86_64.AppImage
```

## Local services

Development mode starts:

```text
AivudaOS FastAPI/Uvicorn
AivudaAppStore FastAPI/Uvicorn
ACEswarm Caddy App Gateway
```

All services bind to dynamically allocated loopback ports. ACEswarm also starts its Control API and local MCP transport on a dynamic loopback port. The stdio compatibility transport is available with `ACESWARM_CONTROL_URL=http://127.0.0.1:<port> npm run mcp:stdio`; Electron starts it automatically for local Agent/Codex integrations. ACEswarm does not call standalone installation scripts, systemd, Avahi, or ports 80/443.

## Tests

```bash
npm test
npm run check
npm run bundle:verify
npm run smoke
```

Test packaged resources without opening an Electron window:

```bash
cd /path/to/ACEswarm
ACESWARM_RESOURCES=$PWD/dist/linux-unpacked/resources npm run smoke
```
