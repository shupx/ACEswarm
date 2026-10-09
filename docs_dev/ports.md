# ACEswarm Ports

ACEswarm binds only to `127.0.0.1`. The two browser-facing Gateway ports are fixed so Electron WebView origins, cookies, local storage, and HTTP cache remain stable across restarts.

| Component | Address | Allocation | Override Environment Variable | Purpose |
|---|---|---|---|---|
| ACEswarm main Gateway | `127.0.0.1:28790` by default | Fixed/configurable | `ACESWARM_GATEWAY_PORT` | AivudaOS UI, installed application UIs, and `/aivuda_os/api/*` / `/aivuda_os/mcp` proxy |
| AppStore Gateway | `127.0.0.1:28791` by default | Fixed/configurable | `ACESWARM_STORE_GATEWAY_PORT` | AppStore UI, AppStore APIs, and package file routes |
| AivudaOS Uvicorn API | `127.0.0.1:<random>` | Random per launch | None | Internal AivudaOS FastAPI service; not used as the browser UI origin |
| AivudaAppStore Uvicorn API | `127.0.0.1:<random>` | Random per launch | None | Internal AppStore FastAPI service |
| Caddy Admin API | `127.0.0.1:<random>` | Random per launch | None | Internal Caddy configuration reload API |
| Electron browser CDP | `127.0.0.1:<random>` by default | Random per launch/configurable | `ACESWARM_CDP_PORT` | Playwright MCP attaches directly to the running desktop |
| Playwright MCP | `127.0.0.1:28792/mcp` by default | Fixed/configurable | `ACESWARM_MCP_PORT` | Bundled Streamable HTTP browser tools |
| AivudaOS MCP | `127.0.0.1:28790/aivuda_os/mcp` by default | Shares main Gateway | `ACESWARM_GATEWAY_PORT` | Built-in Streamable HTTP, all OS API operations |
| AivudaAppStore MCP | `127.0.0.1:28795/mcp` by default | Fixed/configurable | `AIVUDAAPPSTORE_MCP_PORT` | Streamable HTTP, all Store API operations |

There are **eight TCP listeners** during a normal Electron session: two fixed Gateway listeners, two fixed MCP listeners, and four random listeners. Override MCP ports with `ACESWARM_MCP_PORT` and `AIVUDAAPPSTORE_MCP_PORT` (1024–65535). Occupied fixed ports fail startup. CDP defaults to `ACESWARM_CDP_PORT=0` (random); set a nonzero value to use a specific port. See [mcp-server.md](mcp-server.md) for client configuration.

If `28790` or `28791` is already occupied, ACEswarm fails startup instead of silently changing the UI origin. Override them when needed:

```bash
ACESWARM_GATEWAY_PORT=29790 \
ACESWARM_STORE_GATEWAY_PORT=29791 \
./ACEswarm-x86_64.AppImage
```

Both values must be distinct TCP ports between 1024 and 65535. Stop the conflicting process before launching ACEswarm if you do not override them.

The Electron UI must use the main Gateway address, not the internal AivudaOS Uvicorn port. The internal API addresses are used by seed bootstrap and package integrations.
