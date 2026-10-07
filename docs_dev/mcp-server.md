# MCP Services

ACEswarm provides three Streamable HTTP MCP servers: AivudaOS, AppStore and
bundled Playwright MCP attached to the existing Electron desktop over CDP.
All ACEswarm listeners bind to loopback.

| Service | Connection | Transport | Purpose |
|---|---|---|---|
| AivudaOS MCP | `http://127.0.0.1:28794/mcp` | Streamable HTTP | System configuration, app management, logs, operation events and interactive input |
| AppStore MCP | `http://127.0.0.1:28795/mcp` | Streamable HTTP | Store queries, package uploads/downloads, publishing, members and data import/export |
| Playwright MCP | `http://127.0.0.1:28792/mcp` | Streamable HTTP | Desktop and WebView snapshots, clicks, navigation and tab switching |

All three MCP servers start with ACEswarm and are stopped by its process guardian.
Playwright MCP is included in the AppImage and runs using Electron's Node mode;
no agent-side Node.js/npm or additional browser installation is required.

## Client Configuration

Start ACEswarm, then configure the MCP client:

```json
{
  "mcpServers": {
    "aceswarm-playwright": {"url": "http://127.0.0.1:28792/mcp"},
    "aceswarm-aivudaos": {"url": "http://127.0.0.1:28794/mcp"},
    "aceswarm-aivudaappstore": {"url": "http://127.0.0.1:28795/mcp"}
  }
}
```

Client configuration syntax varies. Internal CDP uses a random port by default;
Playwright MCP attaches automatically, and clients use `28792/mcp` for browser tools.

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

Backend API credentials are separate. Protected calls automatically log in with
the default account (`admin / admin123`), cache the temporary token in memory,
and log in again on token expiry before retrying once. Public Store queries do
not trigger login. Only a rejected login prompts for the current username/password.
Set the corresponding `*_MCP_USERNAME` / `*_MCP_PASSWORD` for a changed account,
or use the login tool and pass its token in subsequent calls. Explicit
`AIVUDAOS_MCP_TOKEN`, `AIVUDAAPPSTORE_MCP_TOKEN`, or per-call `token` / `authorization`
override automatic login and are never silently replaced. Login tools return
credentials without changing the shared server default account.

## Playwright MCP

After Electron CDP is ready, ACEswarm launches the bundled official Playwright
MCP CLI with `--port`, `--host 127.0.0.1` and this session's CDP WebSocket URL.
Its `/mcp` endpoint uses the official Streamable HTTP transport with a separate
session per client. Startup checks an MCP handshake before publishing discovery.
An occupied port fails startup; change it with `ACESWARM_MCP_PORT`.
Logs are stored as `playwright-mcp.log`, with tool output under
`playwright-mcp-output/` in the workspace logs directory.

Use `browser_tabs` to list existing pages and select the desktop `shell.html`
or an application's WebView. WebViews appear as separate pages. Use
`browser_snapshot`, `browser_click`, and other browser tools on the selected page.
The bundled MCP's `--init-page` hook rejects navigation, history navigation and
closing of `shell.html` before the operation reaches CDP. Select an application's
WebView before navigating, or use the desktop address input to open a page.
This protects ordinary MCP tools; direct CDP or arbitrary script execution can
still alter the desktop.
CDP controls renderer pages, not Electron main-process APIs.

Direct Playwright clients can also use `chromium.connectOverCDP` (Python:
`chromium.connect_over_cdp`). Disconnecting an attached client leaves the desktop
running; sending CDP `Browser.close` closes Electron. CDP allows local processes
to control the desktop and access session data, so keep the endpoint local.

## Ports And Discovery

| Setting | Default | Allowed Values |
|---|---|---|
| `ACESWARM_MCP_PORT` | 28792 | 1024–65535 |
| `AIVUDAOS_MCP_PORT` | 28794 | 1024–65535 |
| `AIVUDAAPPSTORE_MCP_PORT` | 28795 | 1024–65535 |
| `ACESWARM_CDP_PORT` | 0 (random) | 0–65535; nonzero selects a specific port |

Update MCP client URLs to match overridden MCP ports. Occupied fixed
ports fail startup rather than silently changing. Playwright's Electron launcher
may supply its own CDP port, which takes precedence.

CDP discovery is written to `$ACESWARM_WS_ROOT/state/agent-connection.json`
(default: `~/ACEswarm_ws/state/agent-connection.json`). It contains `pid`,
`mcpUrl`, `cdpEndpoint`, `browserWSEndpoint`, and `transport: "streamable-http"`.
The file is removed on normal exit but can remain stale after a forced kill.
The former `get_browser_connection` tool is no longer used.

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
Caddy and a graphical display (or `xvfb-run`). The agent test connects over HTTP
to bundled Playwright MCP in an isolated workspace/profile, operates the desktop and a WebView, reconnects
and checks cleanup. `npm run test:cleanup` checks package MCP, Gateway and CDP
listeners are released across desktop exit modes. Playwright MCP is a production
dependency; the client SDK and desktop test Playwright remain development dependencies.
