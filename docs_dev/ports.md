# ACEswarm Ports

ACEswarm binds only to `127.0.0.1`. The two browser-facing Gateway ports are fixed so Electron WebView origins, cookies, local storage, and HTTP cache remain stable across restarts.

| Component | Address | Allocation | Purpose |
|---|---|---|---|
| ACEswarm main Gateway | `127.0.0.1:18790` | Fixed | AivudaOS UI, installed application UIs, and `/aivuda_os/api/*` proxy |
| AppStore Gateway | `127.0.0.1:18791` | Fixed | AppStore UI, AppStore APIs, and package file routes |
| AivudaOS Uvicorn API | `127.0.0.1:<random>` | Random per launch | Internal AivudaOS FastAPI service; not used as the browser UI origin |
| AivudaAppStore Uvicorn API | `127.0.0.1:<random>` | Random per launch | Internal AppStore FastAPI service |
| Caddy Admin API | `127.0.0.1:<random>` | Random per launch | Internal Caddy configuration reload API |
| ACEswarm Control API / HTTP MCP | `127.0.0.1:<random>` | Random per launch | ACEswarm Control API and `/mcp` endpoint |

There are therefore **six TCP listeners** during a normal Electron session: two fixed Gateway listeners and four random listeners. The three MCP services started by ACEswarm use stdio and do not add TCP ports.

If `18790` or `18791` is already occupied, ACEswarm fails startup instead of silently changing the UI origin. Stop the conflicting process before launching ACEswarm.

The Electron UI must use the main Gateway address, not the internal AivudaOS Uvicorn port. The internal API addresses are used by seed bootstrap and package integrations.
