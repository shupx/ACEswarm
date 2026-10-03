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
