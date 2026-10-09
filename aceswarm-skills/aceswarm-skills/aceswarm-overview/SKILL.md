---
name: aceswarm-overview
description: Understand ACEswarm and operate its Electron desktop with Playwright MCP, including application WebViews, windows, remote device pages, recording, and desktop settings.
---

# ACEswarm desktop

ACEswarm hosts AivudaOS, AppStore, application WebViews and remote device pages.
Discover apps, URLs, accounts and capabilities from live tools and UI; do not
assume an installed app set, fixed ports or initial window layout.

## Choose the interface

- Playwright MCP: desktop/app UI, windows/tabs/splits, favorites, remote pages,
  theme/language/fullscreen, recording, performance overlay, browser data and exit.
- [AivudaOS MCP](../aceswarm-aivudaos-mcp/SKILL.md): app lifecycle, logs, config and device administration.
- [AppStore MCP](../aceswarm-appstore-mcp/SKILL.md): catalog, packages, publication and developer administration.

## Essential rules

- List `browser_tabs`, select the correct Page, then snapshot. Shell `shell.html`
  contains desktop controls; application WebViews are separate CDP Pages. Their
  content normally does not appear in the Shell's accessibility snapshot.
- Prefer text snapshots (`browser_snapshot`) to save tokens and time. Use image
  screenshots only when layout, coordinates, canvas content or other visual
  information absent from the text snapshot is needed to complete the task.
- Open pages through desktop controls. Navigate guests only: Shell navigation,
  history changes and closing are guarded. Do not bypass the guard with scripts.
- A selected MCP Page need not be the visible desktop window. Closing a UI tab
  does not stop its backend app; opening a remote page does not retarget local OS MCP.
- The OS forwarding gateway uses `device_id` (default `local`); opening a remote
  UI does not select the MCP target. Discover devices and explicitly select the
  requested one. Direct OS MCP has no `device_id`.
- OS/Store MCP automatically log in. Try tools first; ask for current credentials
  only after default/configured login is rejected. Explicit tokens override the
  automatic identity. Browser login does not authenticate MCP calls.
- Follow the user's target/scope and existing authorization; keep credentials out of files/logs.

## Read when needed

- For UI navigation, snapshots, app discovery or window layout, read [desktop.md](references/desktop.md).
- For recording, performance, appearance, clearing data or exit, read [recording-and-system.md](references/recording-and-system.md).
