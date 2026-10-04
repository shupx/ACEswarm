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

The Electron renderer uses plain JavaScript, Dockview Core for tab groups,
nested splits and floating panels, and Lucide for controls. Tabs can be dragged
to group edges to split or onto tab bars to merge; splitters resize both sides.
Single docked panels use a floating drag grip and menu at the top right, reserving
no height for a tab bar. Groups with multiple panels and floating groups retain
a compact 28-pixel tab bar. The window menu provides pinning, floating/docking,
minimizing, maximizing, closing, page zoom and browser actions.
Each application owns an independent WebView using the persistent browser session.
WebViews stay mounted in permanent shell containers; Dockview content anchors
drive their position, size, visibility and floating z-order. Moving a panel or
minimizing it does not recreate its guest. Closing releases the WebView.

Show desktop hides the entire workspace without removing Dockview panels or
changing minimized flags. Clicking it again, or activating a running application
from the Dock, restores the layout. Desktop visibility and the last active panel
survive restart. A workspace may occupy the full desktop or either horizontal or
vertical half; the unused area exposes desktop shortcuts and the background.
A single docked window supports edge dragging with a placement preview. Opening
a second page in a half-screen workspace fills the complementary half. Group
maximization fills the desktop below the top panel and restores the previous region.

The collapsible top panel combines System, Applications/Store Admin, pinned page entries,
running applications, desktop actions and the clock. Its expanded/collapsed height
(48/28 pixels) is reserved by the window manager. Maximized windows fill the
viewport below it; Dockview recomputes the available workspace when it is toggled.
Expanded Dock entries show icons; collapsed entries show application names,
running state and window counts in a horizontally scrollable row. Applications
hosts AivudaOS, including its Online Store for downloads. Store Admin hosts the
AivudaAppStore upload/publication management backend. Internal IDs remain unchanged.
The native application menu is removed. System contains global recording,
performance, fullscreen, browser data and quit commands, plus current-page actions.
The performance and recording entries toggle visibility and show a dot when
enabled. Hiding the recording panel keeps an active recording running.
Each window's upper-right controls expose the address bar, pinning and a menu for
page zoom, reload and developer tools. Zoom retains Chromium's shared browser
session behavior. Main-process input handlers preserve shortcuts even in guests.
Applications are identified by their launch URL (ignoring the fragment), separately
from a window's current navigation URL. Multiple windows share a Dock entry;
ordinary clicks activate an existing window, while the context menu can open
another window, switch windows, pin/unpin, reorder pinned entries, or close them.
Pinned entries also appear as desktop shortcuts.

The existing shell-state file stores bookmarks, application launch URLs, page
URLs, minimized panel placement, address-bar visibility and the serialized Dockview
layout (split proportions, tab order, floating bounds and maximized groups).
State version 3 accepts legacy tabs/bookmarks and WinBox bounds; legacy floating
windows are migrated into Dockview floating panels. Invalid layouts fall back to
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
operations. ACEswarm has no standalone control backend, Control API, or MCP server
of its own. Agent control of the ACEswarm desktop is deferred to a future design.

After starting the local backends and Gateway, Electron launches two separate
stdio MCP processes with the private Python runtime:

- `python -m aivudaos.mcp_server`
- `python -m aivudaappstore.mcp_server`

These servers wrap their respective public HTTP APIs with each service's normal
authentication. Their stdin pipes remain open and stdout/stderr are logged by
the service manager; no external client bridge or HTTP MCP endpoint is provided.
They are tracked by the process guardian and stopped with the other services.
ACEswarm integrations do not access either service's databases.
