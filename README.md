# ACEswarm

Linux-first Electron workbench for robot fleets. The desktop app launches independent AivudaOS and AivudaAppStore ASGI applications on dynamic loopback ports and an ACEswarm-owned Caddy app gateway. Home, projects, simulation, experiments, fleet, settings, store, installed-app pages and remote robot targets share a product navigation shell.

## Development

Requires Node.js, a Python interpreter with dependencies from both sibling repositories, and Caddy. Build both independent frontends (`npm ci --include=dev && npm run build` in each `aivudaos/resources/ui` and `aivudaappstore/resources/ui`). From this directory:

```bash
npm ci --include=dev
ACESWARM_PYTHON=/absolute/path/to/python3 ACESWARM_CADDY=/absolute/path/to/caddy \
ACESWARM_OS_ROOT=/absolute/path/to/aivudaOS ACESWARM_STORE_ROOT=/absolute/path/to/aivudaAppStore npm start
```

The development executable paths must be absolute. The two package roots default to the sibling checkouts; set both explicitly to use other revisions. The Python environment must contain both packages' ASGI dependencies, or first build this repository's private runtime. The app never invokes standalone deployment scripts. Data lives in `$HOME/ACEswarm_ws` (override with `ACESWARM_WS_ROOT`); the embedded services do not write to `$HOME/aivudaOS_ws` or `$HOME/aivudaAppStore_ws`. Projects and experiments are folders under that workspace. Robot URLs and installed app IDs can be added from the sidebar.

## Offline release

`npm run bundle:runtime` stages already-built independent frontend distributions, standalone Python, local wheels for both packages and dependencies, and Caddy, then verifies the bundle. The sibling sources are copied into a temporary build directory; the packaging script never edits those repositories. Importable packages and UI assets are staged in `resources/python-packages` and copied into the AppImage. `npm run dist` builds `dist/ACEswarm-0.1.0-x86_64.AppImage`. See `docs/build.md` for host requirements and release gates. Packaged launch verifies executable and independent-package hashes; it never calls pip, a system Python, or a package index.

`resources/seed-apps/aceswarm-config-export.json` is the sole bootstrap descriptor: an AivudaOS format-version-1 export with an `aceswarm.packages` extension listing archive paths and SHA-256 digests. Four approved archives from `/home/spx/spx_ws/ACE/prepkg` live in the sibling `packages/` directory. At startup ACEswarm verifies every archive, parses its `manifest.yaml` through the local AppStore API, checks its app ID/version against `payload.apps`, publishes missing versions, and submits the export to AivudaOS's import API. Set `ACESWARM_SEED_ADMIN_PASSWORD` and `ACESWARM_SEED_STORE_PASSWORD` for the local OS and AppStore admin accounts. The desktop reports missing credentials or bootstrap failures instead of importing a database. See `docs/build.md` for the export layout.

Run `npm run check` for focused tests. `npm run smoke` exercises both source-mode ASGI apps and Caddy through two start/stop cycles with explicit `ACESWARM_PYTHON` and `ACESWARM_CADDY`; `ACESWARM_RESOURCES=$PWD/dist/linux-unpacked/resources npm run smoke` verifies the packaged resources without requiring a desktop session. For embedded OS-mode tests run `PYTHONPATH=../aivudaOS python3 -m unittest discover -s ../aivudaOS/tests -p test_embedded_mode.py`.

For a controlled graphical smoke test on Linux, set `ACESWARM_SMOKE_EXIT_MS=3000` when launching the packaged executable under a display server. It logs `ACEswarm workbench ready` after the shell loads and quits cleanly after the requested delay (maximum 60 seconds).
