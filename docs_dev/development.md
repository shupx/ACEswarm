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

All listeners bind to loopback. The two browser-facing Gateway ports are fixed
and configurable; internal backend and Caddy admin ports are dynamically allocated.
AivudaOS and AivudaAppStore MCP servers are started as separate stdio processes
using the private Python runtime. Their logs are `aivudaos-mcp.log` and
`aivudaappstore-mcp.log` in the workspace logs directory. These processes are not
exposed through an HTTP endpoint or external client bridge. ACEswarm has no
Control API or MCP server of its own; desktop agent integration is deferred.
ACEswarm does not call standalone installation scripts, systemd, Avahi, or ports 80/443.

## Tests

```bash
npm test
npm run check
npm run bundle:verify
npm run smoke
```

The desktop integration test launches the actual Electron main process and local
services using a temporary browser profile and workspace. It checks page loading,
top-panel Dock pin/unpin, collapsed text entries and horizontal scrolling,
System menus, panel zoom/address controls, drag docking, nested splits,
splitter resizing, floating panels and preserved guest instances,
single-panel compact grips and menus with no reserved header height,
28-pixel headers for stacked tabs and floating groups,
shortcuts with guest focus, page popups, restart persistence, and screenshots
at 1280, 850 and 390 pixels wide. It also records videos in all three modes and
uses ffprobe/ffmpeg to verify decodable, nonblank output. It requires the development
Python environment, Caddy, FFmpeg/ffprobe, OpenSSL and an X11 session with a window manager;
it does not change the normal user workspace or Videos folder.
It also checks desktop background pixels, workspace hide/restore without layout
or guest loss, single-window half-screen snapping, desktop state across restarts,
self-signed HTTPS loading and retrying a failed URL after its service starts.

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
System-menu quit, SIGTERM, and SIGKILL during FFmpeg recording. The test checks that subprocesses
exit, gateway ports are released, both package MCP servers are running before exit,
and no ACEswarm control backend or MCP process is launched.
Services run in separate process groups. An independent Node guardian monitors
Electron's pipe and stops those groups and active FFmpeg recordings if Electron
crashes. Normal shutdown sends SIGTERM, escalates to SIGKILL after five seconds,
and waits for process termination. Forced exit cannot guarantee a saved recording.

Test packaged resources without opening an Electron window:

```bash
cd /path/to/ACEswarm
ACESWARM_RESOURCES=$PWD/dist/linux-unpacked/resources npm run smoke
```
