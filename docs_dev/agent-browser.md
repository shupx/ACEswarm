# Agent browser connection

ACEswarm exposes the existing Electron desktop through CDP at
`http://127.0.0.1:28793`. Agents use Microsoft's Playwright MCP directly to
attach and access browser tools, including snapshots, clicks and tab switching.
ACEswarm does not host a browser discovery MCP server or launch another browser.
Playwright MCP runs on the agent side; it is not bundled in the AppImage.

Start ACEswarm first, then configure the MCP client:

```json
{
  "mcpServers": {
    "aceswarm": {
      "command": "npx",
      "args": [
        "-y", "@playwright/mcp@0.0.83",
        "--cdp-endpoint", "http://127.0.0.1:28793"
      ]
    }
  }
}
```

This uses stdio between the agent and Playwright MCP, and CDP between
Playwright MCP and Electron. Client configuration formats vary. Node.js and
access to the npm package are required on the agent machine.

## Port and connection lifecycle

The default CDP port is 28793 (not Chromium's usual 9222). Override it with:

```bash
ACESWARM_CDP_PORT=29793 ./ACEswarm-x86_64.AppImage
```

Update `--cdp-endpoint` in the client configuration to match. Values must be
integers between 0 and 65535. `0` requests a random port for isolated tests;
read its address from `$ACESWARM_WS_ROOT/state/agent-connection.json`
(default: `~/ACEswarm_ws/state/agent-connection.json`). The file contains
`pid`, `cdpEndpoint`, `browserWSEndpoint`, and `transport: "cdp"`.
It is removed on normal exit but can remain stale after a forced kill.
Playwright's Electron launcher may supply its own CDP port, which takes precedence.

An occupied fixed CDP port fails startup with an error directing the user to
`ACESWARM_CDP_PORT`. ACEswarm does not silently change the port.
`ACESWARM_MCP_PORT` and the former `get_browser_connection` tool are no longer used.

## Existing pages and WebViews

Use `browser_tabs` to list existing pages and select the desktop `shell.html`
or an application's WebView. WebViews appear as separate pages. Use
`browser_snapshot`, `browser_click`, and the other browser tools on the selected
page. Do not navigate the shell away from its local file URL or close user tabs.
CDP controls renderer pages, not Electron main-process APIs.

Direct Playwright clients can also use `chromium.connectOverCDP` (Python:
`chromium.connect_over_cdp`). Disconnecting an attached client leaves the
desktop running. Sending CDP `Browser.close` closes Electron.

CDP is bound to loopback and allows local processes to control the desktop and
access session data. Keep the endpoint local.

## Verification

```bash
npm run check
npm run test:agent
ACESWARM_CDP_PORT=29793 npm run test:agent
npm run test:cleanup
```

The live tests require the development Python environment, built frontends,
Caddy, and a graphical display (or `xvfb-run`). The agent test launches an isolated
workspace/profile, starts the real Playwright MCP over stdio, operates the existing
desktop, lists/selects a WebView and takes its snapshot, reconnects, and checks
shutdown cleanup. MCP and its SDK are development dependencies only.
