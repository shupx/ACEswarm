## Environment

ubuntu22.04, nodejs 20.x, npm 10.x, python 3.11.x, pip 23.x, virtualenv 20.x.

Set pip mirror for faster installation in China:

```bash
pip config set global.index-url https://pypi.tuna.tsinghua.edu.cn/simple
```

Use **Node.js 22.x** and npm 10.x. The repository pins the expected major version in [`.nvmrc`](../.nvmrc) and `package.json` engines. 

```bash
# install nvm for node version management if you don't have it already
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc

export NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node
nvm install 22
nvm alias default 22 # set default node version to 22.x
```

Verify before setup:

```bash
node --version  # v22.x
npm --version   # 10.x
# Check that the npm registry is set to npmmirror for faster downloads in China:
npm config set registry https://registry.npmmirror.com
npm config get registry
```

The repository `.npmrc` configures npmmirror for Electron and electron-builder binary downloads.


## One-command development setup

From a fresh clone:

```bash
git clone https://github.com/shupx/ACEswarm.git
cd ACEswarm
npm run setup:dev
npm run dev
```

The setup script creates `.venv`, installs both submodule requirement sets, initializes the submodules, builds their frontends, and builds the private development runtime. It does not use external sibling checkouts. After setup, `npm run dev` starts ACEswarm with the private runtime and Caddy automatically. Set `ACESWARM_PYTHON` or `ACESWARM_CADDY` only when overriding those defaults. Embedded seed bootstrap uses the default `admin` / `admin123` credentials of AivudaOS and AivudaAppStore; no seed password environment variables are required.

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

The desktop integration test launches the actual Electron main process and local
services using a temporary browser profile and workspace. It checks page loading,
Dock pin/unpin, window controls, page popups, restart persistence, and screenshots
at 1280, 850 and 390 pixels wide. It also records videos in all three modes and
uses ffprobe/ffmpeg to verify decodable, nonblank output. It requires the development
Python environment, Caddy, FFmpeg/ffprobe and an X11 session with a window manager;
it does not change the normal user workspace or Videos folder.

```bash
npm run test:desktop
# On a headless Linux host:
ACESWARM_TEST_WINDOW_MANAGER=/usr/bin/openbox xvfb-run -a npm run test:desktop
```

Screenshots and sample recordings are written to `.smoke/desktop/`.
Native is tested with desktop `getUserMedia` disabled, including three consecutive
start/pause/resume/stop cycles. It records the application's content area as WebM
through Electron frame capture and browser MediaRecorder, without OS title bars.

Run `xvfb-run -a npm run test:cleanup` to verify real Electron window close,
SIGTERM, and SIGKILL during FFmpeg recording. The test checks that subprocesses
exit, gateway ports are released, and the stdio MCP has no Chromium subprocesses.
Services run in separate process groups. An independent Node guardian monitors
Electron's pipe and stops those groups and active FFmpeg recordings if Electron
crashes. Normal shutdown sends SIGTERM, escalates to SIGKILL after five seconds,
and waits for process termination. Forced exit cannot guarantee a saved recording.

Test packaged resources without opening an Electron window:

```bash
cd /path/to/ACEswarm
ACESWARM_RESOURCES=$PWD/dist/linux-unpacked/resources npm run smoke
```
