## One-command development setup


Use **Node.js 22.x** and npm 10.x. The repository pins the expected major version in [`.nvmrc`](../.nvmrc) and `package.json` engines. In a new shell, install and activate nvm, then install and switch to the project version:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] || { curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash; }
. "$NVM_DIR/nvm.sh"
NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node nvm install
nvm use
nvm alias default 22
```

Verify before setup:

```bash
node --version  # v22.x
npm --version   # 10.x
```

The repository `.npmrc` configures npmmirror for Electron and electron-builder binary downloads.

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

All services bind to dynamically allocated loopback ports. ACEswarm also starts its Control API and local MCP transport on a dynamic loopback port. The streamable HTTP endpoint is available at the reported control URL; a local MCP client such as Codex must be configured with that URL for the session. The stdio compatibility transport is available with `ACESWARM_CONTROL_URL=http://127.0.0.1:<port> npm run mcp:stdio`. AivudaOS and AivudaAppStore MCP servers are started as separate local processes. ACEswarm does not call standalone installation scripts, systemd, Avahi, or ports 80/443.

When ACEswarm is running, its console prints the MCP endpoint. For a local Codex smoke test, configure that endpoint for the session and ask Codex to list the pages:

```bash
codex exec --ephemeral --skip-git-repo-check --sandbox read-only \
  -c 'mcp_servers.aceswarm.url="http://127.0.0.1:<control-port>/mcp"' \
  'Use the ACEswarm MCP server. List the pages and report their ids.'
```

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
