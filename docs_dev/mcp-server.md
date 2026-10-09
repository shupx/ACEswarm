# MCP Services

ACEswarm provides three Streamable HTTP MCP servers: AivudaOS, AppStore and
bundled Playwright MCP attached to the existing Electron desktop over CDP.
All ACEswarm listeners bind to loopback.

| Service | Connection | Transport | Purpose |
|---|---|---|---|
| AivudaOS MCP Gateway | `http://127.0.0.1:28794/mcp` | Streamable HTTP | System configuration, app management, logs, operation events and interactive input |
| AppStore MCP | `http://127.0.0.1:28795/mcp` | Streamable HTTP | Store queries, package uploads/downloads, publishing, members and data import/export |
| Playwright MCP | `http://127.0.0.1:28792/mcp` | Streamable HTTP | Desktop and WebView snapshots, clicks, navigation and tab switching |

All three MCP endpoints become available with ACEswarm. OS MCP lives in the OS
backend, with an ACEswarm forwarding gateway; AppStore and Playwright MCP run as managed processes. The process guardian
stops these services on desktop exit.
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

## AivudaOS MCP Gateway

Agents connect to `http://127.0.0.1:28794/mcp`, configurable with
`ACESWARM_AIVUDAOS_MCP_PORT`. ACEswarm starts a managed Electron Node-mode
`aivudaos-mcp-gateway.js` process, checks `/health`, and logs to
`aivudaos-mcp-gateway.log`. No agent-side Node installation is needed.

The gateway discovers all tools via `tools/list` from the local built-in OS MCP
at `http://127.0.0.1:28790/aivuda_os/mcp`, adds optional `device_id` (default
`local`) to each schema, and forwards the name/arguments without copying business
logic. It also provides `list_devices`, `add_device`, `update_device`,
`remove_device`, `get_device_status` and `reconnect_device`.

For example, call `add_device` with `device_id: "robot-a"` and
`mcp_url: "https://robot-a.local/aivuda_os/mcp"`, then call `start_app` with
`device_id: "robot-a"` and `app_id`. `local` cannot be edited or removed.
Remote registrations persist in `state/aivudaos-mcp-devices.json`; credentials
are not saved. Add/update validates the handshake and tool list before saving.
Remote addresses must use HTTP(S) without URL credentials, queries or fragments.
Optional `ca_file` is an absolute PEM CA path on the ACEswarm machine; HTTPS
certificate and hostname verification remain enabled by default. Set `insecure: true`
on `add_device` / `update_device` to skip both checks for that device, without
changing Caddy. The setting persists and appears in device status; use
`insecure: false` to restore verification. `timeout_seconds` defaults
to 90 (range 1–120), covering bounded operation-event reads.

Remote tools are checked against the selected device's discovered tool list;
unsupported tools return an error. The published catalog follows the local OS
version; reconnect refreshes a target's capabilities. Registrations do not change
the public catalog. Different parameter versions are validated by the target.
The gateway uses stateless Streamable HTTP requests, supports JSON responses and
never automatically retries business calls. It targets AivudaOS built-in MCP,
not arbitrary session/SSE MCP servers. To follow jobs, pass the same `device_id`
with the returned `operation_id` for events, status, cancellation and input.

Default-account auto-login remains at each target OS. If rejected, call `login`
on that device and explicitly supply its token on subsequent calls. Gateway HTTP
Bearer headers apply only to `local`; remote calls with a gateway Bearer header
require an explicit tool token to prevent cross-device credential forwarding.
The listener binds loopback and validates Host/Origin. Local processes can use
its registry and tools. Removing a device never stops the remote OS or its apps.

## AivudaOS And AppStore MCP

AivudaOS MCP is built into its FastAPI backend at `/aivuda_os/mcp`. Caddy forwards
it alongside `/aivuda_os/api/*`, on the same gateway origin (28790 by default).
There is no OS MCP child process, extra listener or `aivudaos-mcp.log`; OS and MCP
logs belong to `aivudaos.log`. Internal HTTP, event and WebSocket requests use
ASGI to preserve the existing API routing and authorization without a network
round trip. Startup checks MCP `ping` through Caddy before publishing `osDirectMcp`.

AppStore still uses a separate Python MCP process, with `/mcp` on 28795 and
`/health` readiness checks. Its API base URL is the Store Caddy entry including
`/aivuda_app_store`, so package redirects reach Caddy's static file server.
Its log is `aivudaappstore-mcp.log`; the process guardian stops it on desktop exit.

Tools are generated from backend route definitions, including file endpoints
and HEAD. OS also exposes interactive WebSocket input and bounded batches of
SSE operation events. AppStore includes authenticated write operations; backend
roles and ownership checks still apply. JSON requests use a `body` argument,
forms use named fields, uploads use base64 file objects, and binary downloads
return base64 content. Complete tool lists and parameters are documented in:

- [AivudaOS MCP](../aivudaOS/docs/mcp.md)
- [AppStore MCP](../aivudaAppStore/docs/mcp.md)

### Authentication

OS MCP automatically logs in with `admin / admin123` when the agent does not
supply an API token. The managed token is cached in the backend process; concurrent
calls share a login. On an API 401 it refreshes the managed token and retries once.
Only a rejected default/configured login asks the agent for current credentials;
network/service failures do not prompt for a different password.

Call `login` with a JSON `body` containing username/password when that fallback is
needed, then pass `access_token` as tool argument `token` or the MCP HTTP header
`Authorization: Bearer <access_token>`. Explicit tool tokens override the header.
Explicit tokens are never replaced with default-account credentials. Manual login
and HTTP Bearer identities do not change the shared automatic login account.
Origin headers must match the gateway origin.

`AIVUDAOS_MCP_USERNAME` / `AIVUDAOS_MCP_PASSWORD` configure automatic login;
`AIVUDAOS_MCP_TOKEN` configures an explicit API token. `AIVUDAOS_MCP_MAX_BYTES`
still sets the size limit (64 MiB). OS no longer uses separate MCP HOST/PORT/
BASE_URL/ACCESS_TOKEN settings. Change `ACESWARM_GATEWAY_PORT` to change its entry.

AppStore retains its standalone authentication: `AIVUDAAPPSTORE_MCP_ACCESS_TOKEN`
protects inbound requests, separately from backend API tokens. Protected Store
calls automatically log in as `admin / admin123`, refresh expired managed tokens,
and retry once. Set `AIVUDAAPPSTORE_MCP_USERNAME` / `PASSWORD` for another account,
or supply `AIVUDAAPPSTORE_MCP_TOKEN` / per-call `authorization`. Explicit API tokens
are never replaced. Public Store queries do not trigger login.

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
| `ACESWARM_AIVUDAOS_MCP_PORT` | 28794 | 1024–65535; forwarding gateway |
| `ACESWARM_GATEWAY_PORT` | 28790 | 1024–65535; OS UI/API/MCP share this port |
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

Package `tests/test_mcp*.py` verifies API coverage, forwarding, HTTP protocol
handling, ASGI middleware dispatch, authentication isolation, file encoding and limits,
bounded SSE, WebSocket input and old Caddyfile migration. `test_mcp_gateway.py`
uses the shipped Caddy template to verify real HTTP and CA-verified HTTPS without
installing trust into the system. `npm run smoke` connects the official SDK to both
package MCP endpoints and verifies automatic OS login, explicit login, Bearer authentication,
identity isolation, app upload/install/start/restart/logs/stop/uninstall, config
revision conflicts, SSE, Store automatic login and published package downloads,
across two startup/shutdown cycles. Use `ACESWARM_RESOURCES` with the packaged
resource layout to run the same smoke checks against bundled Python packages.

Live desktop tests require the development Python environment, built frontends,
Caddy and a graphical display (or `xvfb-run`). The agent test connects over HTTP
to bundled Playwright MCP in an isolated workspace/profile, operates the desktop and a WebView, reconnects
and checks cleanup. `npm run test:cleanup` checks the single Store MCP process, built-in OS MCP, Gateway and CDP
listeners are released across desktop exit modes. Playwright MCP is a production
dependency; the client SDK and desktop test Playwright remain development dependencies.

Gateway tests (`tests/aivudaos-mcp-gateway.test.js`) exercise SDK discovery, local
and remote routing, registry persistence, capability differences, credential
isolation, upstream deadlines, non-retry behavior and HTTPS CA/hostname checks.
The smoke test registers an additional target and calls it through `device_id`;
the lifecycle test also verifies the gateway process and port across exit modes.
