# Architecture and Project Layout

## Product relationship

```text
ACEswarm Electron Workbench
├── ACEswarm workbench pages
├── Local AivudaOS page
├── Local AivudaAppStore page
├── Remote robot AivudaOS pages
└── Local service lifecycle manager
    ├── AivudaOS Uvicorn
    ├── AivudaAppStore Uvicorn
    └── Caddy App Gateway
```

AivudaOS and AivudaAppStore remain independent distributions. ACEswarm launches and hosts their pages without turning them into internal ACEswarm business libraries.

## Desktop shell

First launch shows one fixed desktop with Console and AppStore Admin shortcuts,
without opening any application windows. Subsequent launches restore the saved session.

The Electron renderer uses plain JavaScript, Dockview Core and Lucide controls.
The desktop window manager owns outer windows: their bounds, stacking order,
minimization, maximization and half-screen placement. Each outer window owns its
own Dockview instance, which manages only that window's tabs and nested splits.
Launching an application adds a tab to the current window, creating a window
when none exists. The tab row's plus control also opens a tab in that window.

Drag tabs to group edges to split or onto tab bars to merge. Tabs can also move
between windows by dropping onto another window's content, tab bar or taskbar
entry. Cross-window edge drops split the destination group. A drop on the desktop
background creates a new outer window. The tab menu offers a window selector as
an alternative to dragging. Moving the last tab out closes the empty source window.

Each page owns an independent WebView using the persistent browser session.
WebViews stay mounted in permanent desktop host containers; Dockview anchors
drive their position, size and visibility, while outer-window stacking determines
their z-order. Moving tabs between windows, rearranging splits and minimizing
windows do not recreate guests. Closing a tab releases its WebView; closing an
outer window releases all of its tabs.

Drop previews are drawn above guests for both internal splits and cross-window
transfers. Sash hit regions mirror Dockview's native dividers above the guest
layer and forward drag starts to Dockview, so the complete divider remains
draggable while Dockview owns split sizing and constraints.

The Dockview tab row is the only window header. Its empty space moves the outer
window; edges and corners resize it. Double-clicking empty space toggles
maximization. Dragging the header to the display edges
snaps the whole window to the left/right half or maximizes it. Normal bounds are
retained for restoration. All non-minimized windows can remain visible together.
The desktop background and shortcuts remain fixed underneath them.

Show desktop temporarily hides all windows without altering their inner layouts
or minimized flags. Clicking it again restores them. The compact bottom taskbar
contains one entry per outer window; clicking an entry restores and raises that
window, or minimizes it when it is already active and visible. Open page adds a
tab to the current window, creating a window when none exists. Applications
remains beside System on the left. The bottom 28 pixels are
reserved for the taskbar, including Show desktop and Open page. Taskbar labels
scroll horizontally when necessary.

Applications contains an expandable All list of installed apps with static UI
entrypoints, obtained through the authenticated local AivudaOS API, followed by
favorite apps. Favorites have remove buttons; Console and AppStore Admin remain
permanent entries. Console hosts AivudaOS, including its Online Store for downloads.
AppStore Admin hosts the AivudaAppStore upload/publication management backend.

Guest preload initializes the internal AivudaOS Online Store URL to the actual
local AppStore gateway before page scripts run. A stored marker allows managed
defaults to follow port changes while preserving manually saved URLs. Remote
pages and installed app UI pages do not receive this default.

The AppStore gateway serves public package files at `/aivuda_app_store/files/*`
with CORS headers and OPTIONS support, allowing AivudaOS on its separate gateway
origin to fetch packages for Online Store installation and Config Center imports.

The native application menu is removed. System contains global recording,
performance, fullscreen, browser data and quit commands, plus current-page actions.
The performance and recording entries toggle visibility and show a dot when
enabled. Hiding the recording panel keeps an active recording running.
Each window's tab row contains one set of outer window controls. Each Dockview
group retains a menu for address bar, pinning, page zoom, reload and developer
tools. Zoom retains Chromium's shared browser
session behavior. Main-process input handlers preserve shortcuts even in guests.
Applications are identified by their launch URL (ignoring the fragment), separately
from a tab's current navigation URL. Applications menus and desktop shortcuts
open apps as tabs in the current window. Favorite
entries also appear as desktop shortcuts. Their context menus support new
windows, switching windows and removing favorites.

The existing shell-state file stores bookmarks, application launch URLs, page
URLs, tab-to-window ownership, address-bar visibility and the serialized Dockview
layout for every outer window, plus outer bounds, stacking, minimized/maximized
state, half-screen placement and the active window.
State version 4 migrates legacy tabs/bookmarks, WinBox bounds and virtual desktop
sessions. Each former virtual desktop with pages becomes an outer window;
legacy internal floating groups flatten into tabs. Invalid layouts fall back to
the restored page list.
The outer Electron window stores its normal size and maximized state separately
in `window-state.json` under the Electron user-data directory. Restored dimensions
are constrained by the primary display's work area and the window's minimum size.
Legacy tab/bookmark state is accepted. Saved local service origins are remapped
to the current endpoints at startup. Address entry from the trusted desktop
authorizes HTTP(S) origins; guest navigation remains subject to the existing
origin checks. Allowed page popups open internal application windows.
As in aivuda-shell, the shell and persistent guest sessions bypass TLS certificate
validation, including self-signed and hostname-mismatched certificates. This also
applies to HTTPS subresources and WSS in those sessions; origin authorization still
applies to page navigation. The generic ACEswarm loading-error page reports the
target URL and Chromium error, and retries that URL when the service is available.

Recording exposes the same three modes as aivuda-shell: Native captures the
Electron content area into WebM; FFmpeg encodes window frames into MP4; FFmpeg X11 records
the native window's screen region on X11. The movable recording bar supports mode
selection, pause/resume, stop/save, and opening saved files. FFmpeg is an optional
system dependency. Window close finalizes recording before destroying its renderer.
Native reads frames with `webContents.capturePage()`, draws them on a CPU-backed
canvas, and feeds `canvas.captureStream()` to `MediaRecorder` (VP8 preferred).
It avoids `desktopCapturer` and desktop `getUserMedia`, whose driver capture path
can crash on NVIDIA/X11. Frames are captured sequentially at up to 20 FPS, with
fixed output dimensions and explicit timer/track cleanup. Native needs no FFmpeg.

## ACEswarm layout

```text
ACEswarm/
├── electron/
│   ├── main.js                 # Electron main process and IPC
│   ├── preload.js              # Security bridge
│   ├── shell.html/js/css       # Workbench shell
│   ├── desktop.js             # Dock and application operations
│   ├── dock-layout.js         # Dockview and stable WebView containers
│   ├── window-manager.js      # Outer windows, taskbar and application launcher
│   └── services/
│       ├── local-services.js   # Service lifecycle, ports, health checks
│       ├── runtime.js          # Runtime and package resolution
│       ├── workspace.js        # User workspace paths
│       ├── gateway.js          # Dynamic Caddy configuration
│       ├── seed.js             # Config-export bootstrap
│       ├── pages.js            # Page registry and routing
│       └── integrity.js        # Release integrity checks
├── resources/
│   └── seed-apps/
│       ├── aceswarm-config-export.json
│       └── packages/
├── scripts/
├── tests/
├── docs_dev/
└── package.json
```

## Page routes

`electron/services/pages.js` resolves targets such as:

```text
settings        → local AivudaOS
store           → local AivudaAppStore
app:<app_id>    → installed application UI through the Gateway
robot:<url>     → remote robot AivudaOS
home/projects/simulation/... → ACEswarm pages
```

## Security boundaries

- WebViews reject unapproved navigation;
- local pages are limited to ACEswarm-managed loopback origins;
- remote robot pages must be explicitly added;
- runtime paths are absolute;
- bundled package paths are restricted to the seed package directory;
- every bundled archive is checked with SHA-256;
- ACEswarm does not write to AivudaOS or AppStore databases.

## IPC and package MCP boundary

The renderer uses the `aivudaShell` preload bridge and Electron IPC for desktop
operations. Electron also enables a loopback CDP listener on a random port by default
(override with `ACESWARM_CDP_PORT`). Bundled Playwright MCP attaches directly
to the existing desktop and WebViews and exposes Streamable HTTP on port 28792
(configurable with `ACESWARM_MCP_PORT`). It runs in a managed Electron Node-mode
process without an extra browser or Node installation. See
[mcp-server.md](mcp-server.md) for the connection contract and lifecycle.

AivudaOS provides built-in Streamable HTTP at `/aivuda_os/mcp`, forwarded by the
main Caddy gateway alongside OS APIs. It shares the backend lifecycle and uses
an in-process ASGI transport to call authenticated API routes. OS defaults to automatic backend login,
with a cached managed token and request-isolated explicit identities. Electron checks MCP `ping` through the gateway
and publishes `osMcp`; no separate OS MCP process or listener exists.

AppStore retains `python -m aivudaappstore.mcp_server`, exposing `/mcp` on loopback
28795 by default. The service manager waits for `/health`, logs stdout/stderr,
and publishes `storeMcp`. Its process is tracked by the guardian. See
[mcp-server.md](mcp-server.md) for clients and authentication.
The browser MCP process is tracked by the same guardian; discovery publishes its
`mcpUrl` alongside the internal CDP connection, after a successful HTTP handshake.
ACEswarm integrations do not access either service's databases.
