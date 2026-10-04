# ACEswarm Ports

ACEswarm binds only to `127.0.0.1`. The two browser-facing Gateway ports are fixed so Electron WebView origins, cookies, local storage, and HTTP cache remain stable across restarts.

| Component | Address | Allocation | Purpose |
|---|---|---|---|
| ACEswarm main Gateway | `127.0.0.1:28790` by default | Fixed/configurable | AivudaOS UI, installed application UIs, and `/aivuda_os/api/*` proxy |
| AppStore Gateway | `127.0.0.1:28791` by default | Fixed/configurable | AppStore UI, AppStore APIs, and package file routes |
| AivudaOS Uvicorn API | `127.0.0.1:<random>` | Random per launch | Internal AivudaOS FastAPI service; not used as the browser UI origin |
| AivudaAppStore Uvicorn API | `127.0.0.1:<random>` | Random per launch | Internal AppStore FastAPI service |
| Caddy Admin API | `127.0.0.1:<random>` | Random per launch | Internal Caddy configuration reload API |

There are therefore **five TCP listeners** during a normal Electron session: two fixed Gateway listeners and three random listeners. The AivudaOS and AivudaAppStore MCP services started by ACEswarm use stdio and do not add TCP ports. ACEswarm has no Control API or MCP endpoint of its own.

If `28790` or `28791` is already occupied, ACEswarm fails startup instead of silently changing the UI origin. Override them when needed:

```bash
ACESWARM_GATEWAY_PORT=29790 \
ACESWARM_STORE_GATEWAY_PORT=29791 \
./ACEswarm-x86_64.AppImage
```

Both values must be distinct TCP ports between 1024 and 65535. Stop the conflicting process before launching ACEswarm if you do not override them.

The Electron UI must use the main Gateway address, not the internal AivudaOS Uvicorn port. The internal API addresses are used by seed bootstrap and package integrations.
