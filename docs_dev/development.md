# Development and Local Startup

## Repository layout

ACEswarm is self-contained. AivudaOS and AivudaAppStore remain independent packages and are consumed from PyPI; no sibling checkout is needed.

```text
ACEswarm/
├── electron/
├── resources/
├── scripts/
└── tests/
```

ACEswarm consumes the two packages through local ASGI/HTTP services. It does not import their private Python modules or access their databases.

## Prerequisites

- Node.js and npm;
- one Python environment containing the pinned published packages;
- an executable Caddy binary;
- Install the published packages into that environment:

```bash
python3 -m pip install 'aivudaos==1.0.0.dev2026100201' 'aivudaappstore==1.0.0.dev2026100201'
```

## Start ACEswarm in development

```bash
cd /path/to/ACEswarm
npm ci --include=dev

ACESWARM_PYTHON=/absolute/path/to/python-in-that-environment \
ACESWARM_CADDY=/absolute/path/to/caddy \
npm start
```

`ACESWARM_PYTHON` is required in development and is the only Python executable used by both local services. ACEswarm discovers both package roots by importing the installed PyPI distributions from that environment. `ACESWARM_CADDY` selects the gateway binary.

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

Test packaged resources without opening an Electron window:

```bash
cd /path/to/ACEswarm
ACESWARM_RESOURCES=$PWD/dist/linux-unpacked/resources npm run smoke
```
