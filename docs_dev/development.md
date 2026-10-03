# Development and Local Startup

## Repository layout

ACEswarm is developed alongside the independent AivudaOS and AivudaAppStore repositories. The paths below are examples; use paths appropriate for your checkout.

```text
workspace/
├── ACEswarm/
├── aivudaOS/
└── aivudaAppStore/
```

ACEswarm consumes the two packages through local ASGI/HTTP services. It does not import their private Python modules or access their databases.

## Prerequisites

- Node.js and npm;
- a Python environment containing the AivudaOS and AivudaAppStore dependencies;
- an executable Caddy binary;
- built AivudaOS and AivudaAppStore frontends.

Build each independent frontend from its own checkout:

```bash
cd /path/to/aivudaOS/aivudaos/resources/ui
npm ci --include=dev
npm run build

cd /path/to/aivudaAppStore/aivudaappstore/resources/ui
npm ci --include=dev
npm run build
```

## Start ACEswarm in development

```bash
cd /path/to/ACEswarm
npm ci --include=dev

ACESWARM_PYTHON=/absolute/path/to/python3 \
ACESWARM_CADDY=/absolute/path/to/caddy \
ACESWARM_OS_ROOT=/path/to/aivudaOS \
ACESWARM_STORE_ROOT=/path/to/aivudaAppStore \
npm start
```

When a local bundled runtime exists, ACEswarm can use:

```text
resources/python-runtime/bin/python3
resources/app-gateway/caddy
```

Explicit `ACESWARM_PYTHON` and `ACESWARM_CADDY` values override those defaults.

## Local services

Development mode starts:

```text
AivudaOS FastAPI/Uvicorn
AivudaAppStore FastAPI/Uvicorn
ACEswarm Caddy App Gateway
```

All services bind to dynamically allocated loopback ports. ACEswarm does not call standalone installation scripts, systemd, Avahi, or ports 80/443.

## Tests

```bash
npm test
npm run check
npm run bundle:verify
npm run smoke
```

Run AivudaOS tests from its own checkout:

```bash
cd /path/to/aivudaOS
python3 -m unittest discover -s tests -p 'test*.py' -v
```

Test packaged resources without opening an Electron window:

```bash
cd /path/to/ACEswarm
ACESWARM_RESOURCES=$PWD/dist/linux-unpacked/resources npm run smoke
```
