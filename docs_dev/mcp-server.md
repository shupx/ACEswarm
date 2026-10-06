# MCP Services

ACEswarm provides two Streamable HTTP MCP servers for AivudaOS and AppStore,
and exposes its existing Electron desktop through CDP for agent-side Playwright MCP.
All ACEswarm listeners bind to loopback.

| Service | Connection | Transport | Purpose |
|---|---|---|---|
| AivudaOS MCP | `http://127.0.0.1:28794/mcp` | Streamable HTTP | System configuration, app management, logs, operation events and interactive input |
| AppStore MCP | `http://127.0.0.1:28795/mcp` | Streamable HTTP | Store queries, package uploads/downloads, publishing, members and data import/export |
| Playwright MCP | Electron CDP: `http://127.0.0.1:28793` | Agent-side stdio MCP, attached over CDP | Desktop and WebView snapshots, clicks, navigation and tab switching |

ACEswarm hosts the two package MCP servers. Playwright MCP runs on the agent
machine and attaches to the existing desktop; it is not bundled in the AppImage
and does not launch another browser.

## Client Configuration

Start ACEswarm, then configure the MCP client:

```json
{
  "mcpServers": {
    "aivudaos": {"url": "http://127.0.0.1:28794/mcp"},
    "aivudaappstore": {"url": "http://127.0.0.1:28795/mcp"},
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

Client configuration syntax varies. Playwright MCP requires Node.js and access
to the npm package on the agent machine. The `28793` address is a CDP endpoint,
not an HTTP MCP endpoint.

## AivudaOS And AppStore MCP

ACEswarm starts both Python MCP processes after the local APIs and Caddy Gateway
are ready, and waits for their `/health` endpoints. Each exposes stateless
Streamable HTTP at `/mcp`. Startup fails if a port is occupied or either server
cannot become ready. The process guardian stops both servers and releases their
ports on desktop exit.

ACEswarm supplies each server with its Caddy Gateway URL, including the service
prefix: `/aivuda_os` on port 28790 and `/aivuda_app_store` on port 28791 by default.
AppStore package redirects therefore reach Caddy's static file server.
Logs are `aivudaos-mcp.log` and `aivudaappstore-mcp.log` in the workspace logs directory.

Tools are generated from backend route definitions, including file endpoints
and HEAD. OS also exposes interactive WebSocket input and bounded batches of
SSE operation events. AppStore includes authenticated write operations; backend
roles and ownership checks still apply. JSON requests use a `body` argument,
forms use named fields, uploads use base64 file objects, and binary downloads
return base64 content. Complete tool lists and parameters are documented in:

- [AivudaOS MCP](../aivudaOS/docs/mcp.md)
- [AppStore MCP](../aivudaAppStore/docs/mcp.md)

### Authentication

Set `AIVUDAOS_MCP_ACCESS_TOKEN` or `AIVUDAAPPSTORE_MCP_ACCESS_TOKEN` to protect
the corresponding MCP endpoint. Clients then send `Authorization: Bearer <access-token>`
in their HTTP headers.

Backend API credentials are separate: set `AIVUDAOS_MCP_TOKEN` or
`AIVUDAAPPSTORE_MCP_TOKEN`, or pass `token` / `authorization` in individual tool
calls. Login tools return credentials without changing the server's default
account, allowing clients to use different backend accounts.

## Playwright MCP

Use `browser_tabs` to list existing pages and select the desktop `shell.html`
or an application's WebView. WebViews appear as separate pages. Use
`browser_snapshot`, `browser_click`, and other browser tools on the selected page.
Do not navigate the shell away from its local file URL or close user tabs.
CDP controls renderer pages, not Electron main-process APIs.

Direct Playwright clients can also use `chromium.connectOverCDP` (Python:
`chromium.connect_over_cdp`). Disconnecting an attached client leaves the desktop
running; sending CDP `Browser.close` closes Electron. CDP allows local processes
to control the desktop and access session data, so keep the endpoint local.

## Ports And Discovery

| Setting | Default | Allowed Values |
|---|---|---|
| `AIVUDAOS_MCP_PORT` | 28794 | 1024–65535 |
| `AIVUDAAPPSTORE_MCP_PORT` | 28795 | 1024–65535 |
| `ACESWARM_CDP_PORT` | 28793 | 0–65535; 0 requests a random port |

Update client URLs and `--cdp-endpoint` to match overridden ports. Occupied fixed
ports fail startup rather than silently changing. Playwright's Electron launcher
may supply its own CDP port, which takes precedence.

CDP discovery is written to `$ACESWARM_WS_ROOT/state/agent-connection.json`
(default: `~/ACEswarm_ws/state/agent-connection.json`). It contains `pid`,
`cdpEndpoint`, `browserWSEndpoint`, and `transport: "cdp"`. The file is removed
on normal exit but can remain stale after a forced kill. `ACESWARM_MCP_PORT`
and the former `get_browser_connection` tool are no longer used.

See [ports.md](ports.md) for all ACEswarm listeners.

## Verification

```bash
npm run check
npm run smoke
npm run test:agent
ACESWARM_CDP_PORT=29793 npm run test:agent
npm run test:cleanup
```

Package `tests/test_mcp_server.py` verifies API coverage, forwarding, HTTP protocol
handling, authentication, file encoding and limits. `npm run smoke` connects the
official SDK to both package servers and verifies backend login, published package
upload/download and two startup/shutdown cycles.

Live desktop tests require the development Python environment, built frontends,
Caddy and a graphical display (or `xvfb-run`). The agent test starts real Playwright
MCP in an isolated workspace/profile, operates the desktop and a WebView, reconnects
and checks cleanup. `npm run test:cleanup` checks package MCP, Gateway and CDP
listeners are released across desktop exit modes. Playwright MCP and its SDK are
development dependencies only.
