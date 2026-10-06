# ACEswarm Ports

ACEswarm binds only to `127.0.0.1`. The two browser-facing Gateway ports are fixed so Electron WebView origins, cookies, local storage, and HTTP cache remain stable across restarts.

| Component | Address | Allocation | Purpose |
|---|---|---|---|
| ACEswarm main Gateway | `127.0.0.1:28790` by default | Fixed/configurable | AivudaOS UI, installed application UIs, and `/aivuda_os/api/*` proxy |
| AppStore Gateway | `127.0.0.1:28791` by default | Fixed/configurable | AppStore UI, AppStore APIs, and package file routes |
| AivudaOS Uvicorn API | `127.0.0.1:<random>` | Random per launch | Internal AivudaOS FastAPI service; not used as the browser UI origin |
| AivudaAppStore Uvicorn API | `127.0.0.1:<random>` | Random per launch | Internal AppStore FastAPI service |
| Caddy Admin API | `127.0.0.1:<random>` | Random per launch | Internal Caddy configuration reload API |
| Electron browser CDP | `127.0.0.1:28793` by default | Fixed/configurable | Playwright MCP attaches directly to the running desktop |

There are therefore **six TCP listeners** during a normal Electron session: two fixed Gateway listeners, one fixed CDP listener, and three random listeners. The AivudaOS and AivudaAppStore MCP services started by ACEswarm use stdio and do not add TCP ports. Playwright MCP runs on the agent side over stdio. See [agent-browser.md](agent-browser.md) for attachment and `ACESWARM_CDP_PORT` configuration (0 requests a random port).

If `28790` or `28791` is already occupied, ACEswarm fails startup instead of silently changing the UI origin. Override them when needed:

```bash
ACESWARM_GATEWAY_PORT=29790 \
ACESWARM_STORE_GATEWAY_PORT=29791 \
./ACEswarm-x86_64.AppImage
```

Both values must be distinct TCP ports between 1024 and 65535. Stop the conflicting process before launching ACEswarm if you do not override them.

The Electron UI must use the main Gateway address, not the internal AivudaOS Uvicorn port. The internal API addresses are used by seed bootstrap and package integrations.
