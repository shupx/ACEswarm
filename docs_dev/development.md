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

## GitHub Nightly Builds

[Nightly AppImage](../.github/workflows/nightly.yml) runs daily at 18:00 UTC
(02:00 Asia/Shanghai) and through
the Actions page's **Run workflow** button on the default branch.
Scheduled runs build only when the current commit differs from the last
successful AppImage build. Runs that skipped packaging are excluded from this
comparison; failed builds can be retried on the next schedule. Manual runs build
unconditionally. Pushes do not trigger the workflow.
It checks out the pinned submodules, runs source checks, and uses the existing
release build to package Linux x86_64. Only a successful build moves the `nightly`
tag and updates the **Nightly** prerelease with these assets:

- `ACEswarm-nightly-x86_64.AppImage`
- `SHA256SUMS`

The same files are retained as an Actions artifact for 14 days. Release asset
names stay constant so each build replaces the previous downloads. The workflow
uses the repository's `GITHUB_TOKEN` with `contents: write`; no release token
secret is required. Repository rules must allow this workflow to update the
`nightly` tag. A workflow dispatch from another branch does not publish.

## Local backends

Development mode starts:

```text
AivudaOS FastAPI/Uvicorn
AivudaAppStore FastAPI/Uvicorn
ACEswarm Caddy App Gateway
```

See [ports.md](ports.md) for the default and configurable ports.

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
application favorites, compact bottom window tasks, independent outer windows,
window movement/resizing/minimization/maximization, nested splits and splitter
resizing inside windows, tab transfers via the taskbar and content edges,
tab tear-off onto the desktop, preserved guest instances, version-3 session
migration, restart persistence, and screenshots at 1280 and 390 pixels wide.
It also records videos in all three modes and
uses ffprobe/ffmpeg to verify decodable, nonblank output. It requires the development
Python environment, Caddy, FFmpeg/ffprobe, OpenSSL and an X11 session with a window manager;
it does not change the normal user workspace or Videos folder.
It also compares desktop background pixels and checks show-desktop restoration
without layout or guest loss, window half-screen placement and desktop state
across restarts.
Existing checks for self-signed HTTPS, load-failure retry, managed store URL
defaults, cross-origin package downloads and their SHA-256 hashes remain covered.

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

## Language and Theme

System offers Theme (Follow System / Light / Dark) and Language (Follow System / English / Simplified Chinese). Both default to Follow System. Desktop preferences persist in Electron userData/appearance.json; unsupported system languages resolve to English and unavailable theme information resolves to Light.

Console and AppStore Admin default to Follow System for both settings. Their upstream code reads only standard browser APIs: navigator.language and matchMedia('(prefers-color-scheme: dark)'). Existing explicit page choices remain independent. Unsupported language or unavailable browser APIs fall back to English/Light.

ACEswarm adapts the browser environment: Electron nativeTheme.themeSource supplies the desktop theme to hosted pages. For local built-in pages, the guest preload sets navigator.language/languages and adapts the standard dark/light matchMedia queries before page scripts run, avoiding inconsistent Electron guest theme reports. Updates dispatch standard languagechange and MediaQueryList change events. No upstream package depends on ACEswarm names, storage keys, IPC or custom events for appearance. Individual page overrides still take precedence. Rebuild both submodule frontends and the AppImage to ship changes.

Address bar, Reload, Window controls and Developer tools remain in window menus; they are no longer duplicated in System.
