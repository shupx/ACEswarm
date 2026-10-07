# Desktop and WebView operations

## Discover and choose an interface

- Inspect available MCP tools and schemas. Client server names may vary;
  `aceswarm-playwright`, `aceswarm-aivudaos` and `aceswarm-aivudaappstore` are naming
  conventions. Use configured endpoints; ports and addresses may be overridden.
- Use AivudaOS MCP for app lifecycle, logs, config and system management, and
  AppStore MCP for catalog/package/developer operations. Read
  [AivudaOS workflows](../../aceswarm-aivudaos-mcp/SKILL.md) or
  [AppStore workflows](../../aceswarm-appstore-mcp/SKILL.md) when needed.
  Use Playwright MCP for desktop layout and UI interaction.
- Discover installed apps, versions, running state and UI entrypoints through live
  tools or Applications. Console and AppStore Admin open the two services;
  labels can vary with language/version. Do not assume initial tabs or window layout.
- Confirm the target device and account. Opening a remote robot page does not
  retarget the local AivudaOS MCP. Check page URLs and MCP service identity before
  commands, especially robot motion or bulk operations.

## Shell and WebView pages

1. Call `browser_tabs` with `action: "list"`. Identify desktop `shell.html` and
   application guest pages by URL/title; do not reuse stale indices.
2. Select the Shell for desktop controls, or the application's WebView for its
   content, then take `browser_snapshot` on that page.
3. The Shell snapshot shows the taskbar/window controls but normally does not
   expand cross-process `<webview>` content. Select the guest's separate CDP Page
   to snapshot its buttons, forms and links. Cross-origin hosting does not prevent
   this; a missing guest in the Shell snapshot does not imply an empty UI.
4. Open a service, app or remote URL through Shell Applications, shortcuts, Open
   page or the desktop address input. Re-list pages afterward. This creates/manages
   a WebView and authorizes the origin through the desktop.
5. Use `browser_navigate` only after selecting a guest. It navigates the selected
   CDP Page, not the active desktop window. Navigation, history changes and closing
   `shell.html` are rejected by the bundled MCP guard to preserve the taskbar.
   On rejection, select a guest; do not bypass the guard with arbitrary scripts.

An iframe inside a guest differs from the guest itself: inspect the selected
page's snapshot/frame structure before frame-specific interactions. Prefer text
snapshots (`browser_snapshot`) to save tokens and time; refresh them after
navigation or UI changes. Avoid image screenshots unless geometry, dragging,
canvas content or other visual information absent from the accessibility tree
is needed to complete the task.

## Desktop capabilities

| Task | Interface and behavior |
|---|---|
| Launch/favorite/reopen apps | Applications, shortcuts and context menus; discover live entries |
| Arrange pages | Tab menus, split groups, dragging and window controls; moving a tab preserves its WebView |
| Manage windows | Taskbar selects/restores/minimizes; controls resize/maximize/place halves; Show desktop temporarily hides windows |
| Navigate pages | Guest navigation or desktop address input; page menu provides reload, zoom and developer tools |
| Background apps | Running-app controls in the taskbar; OS MCP provides authoritative status/logs and lifecycle changes |
| Appearance | System theme, language and fullscreen controls |
| Recording/performance | System recording and FPS/GPU overlay; recording bar selects mode, pauses/resumes and stops/saves; FFmpeg modes require FFmpeg |
| Reset/exit | System browser-data clearing and Quit; clearing can remove login state, quitting stops managed local services |

Closing a UI tab differs from stopping its backend process. Hiding the recording
bar does not stop recording. Hidden/minimized guests may remain in CDP; selecting
a MCP Page does not prove its desktop window is visible.
