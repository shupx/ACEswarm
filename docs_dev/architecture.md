# Architecture and Project Layout

## Product relationship

```text
ACEswarm Electron Workbench
├── ACEswarm workbench pages
├── Local AivudaOS page
├── Local AivudaAppStore page
├── Remote robot AivudaOS pages
└── Local service lifecycle manager
    ├── AivudaOS Uvicorn
    ├── AivudaAppStore Uvicorn
    └── Caddy App Gateway
```

AivudaOS and AivudaAppStore remain independent distributions. ACEswarm launches and hosts their pages without turning them into internal ACEswarm business libraries.

## ACEswarm layout

```text
ACEswarm/
├── electron/
│   ├── main.js                 # Electron main process and IPC
│   ├── preload.js              # Security bridge
│   ├── shell.html/js/css       # Workbench shell
│   ├── backend/
│   │   ├── control-api.js      # Loopback Control API and HTTP MCP transport
│   │   └── server.js           # Standalone backend entry point
│   └── services/
│       ├── local-services.js   # Service lifecycle, ports, health checks
│       ├── runtime.js          # Runtime and package resolution
│       ├── workspace.js        # User workspace paths
│       ├── gateway.js          # Dynamic Caddy configuration
│       ├── seed.js             # Config-export bootstrap
│       ├── pages.js            # Page registry and routing
│       └── integrity.js        # Release integrity checks
├── resources/
│   └── seed-apps/
│       ├── aceswarm-config-export.json
│       └── packages/
├── scripts/
├── tests/
├── docs_dev/
└── package.json
```

## Page routes

`electron/services/pages.js` resolves targets such as:

```text
settings        → local AivudaOS
store           → local AivudaAppStore
app:<app_id>    → installed application UI through the Gateway
robot:<url>     → remote robot AivudaOS
home/projects/simulation/... → ACEswarm pages
```

## Security boundaries

- WebViews reject unapproved navigation;
- local pages are limited to ACEswarm-managed loopback origins;
- remote robot pages must be explicitly added;
- runtime paths are absolute;
- bundled package paths are restricted to the seed package directory;
- every bundled archive is checked with SHA-256;
- ACEswarm does not write to AivudaOS or AppStore databases.

## Control API and MCP boundary

The renderer receives only the narrow preload adapter; it does not import Node or backend modules. The ACEswarm backend owns loopback runtime state and exposes:

```text
GET  /health
GET  /runtime/status
GET  /pages
GET  /workspace?kind=projects|experiments
POST /mcp
```

The MCP endpoint uses JSON-RPC 2.0 over streamable HTTP. `initialize`, `tools/list`, and `tools/call` are supported. The initial read-only tools are `aceswarm_get_runtime_status`, `aceswarm_list_pages`, and `aceswarm_list_workspace`. It binds only to `127.0.0.1` on a dynamically allocated port; Electron passes the endpoint to local Agent/Codex integrations. `npm run mcp:stdio` is the stdio compatibility entry point when a client cannot use HTTP.

AivudaOS and AivudaAppStore should provide separate MCP servers. Their stable ACEswarm-facing interfaces are public HTTP only (with each service's normal auth):

- AivudaOS: `GET /aivuda_os/api/apps/configs/active`, `GET /aivuda_os/api/apps/{app_id}/status`, `GET /aivuda_os/api/apps/{app_id}/config`, and `PUT /aivuda_os/api/apps/{app_id}/config`.
- AivudaAppStore: `GET /aivuda_app_store/store/apps/{app_id}`, `GET /aivuda_app_store/store/apps/{app_id}/versions/{version}/manifest`, and `GET /aivuda_app_store/store/apps/{app_id}/versions/{version}/download-url` (plus download when explicitly requested).

Those MCP servers should wrap these HTTP contracts, return structured JSON, and avoid exposing database or private Python implementation details. ACEswarm must not import their Python modules or access their databases.
