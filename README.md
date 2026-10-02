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

The seed manifest in `resources/seed-apps/seed-manifest.json` is intentionally empty until approved app archives are supplied. Each entry must include `id`, `version`, `artifact`, `sha256`, `policy: "install-if-missing"`, and `required`. Set `ACESWARM_SEED_ADMIN_PASSWORD` to provision seeds using the public OS upload API. Bootstrap state is stored separately in the ACEswarm workspace; a non-empty manifest without credentials reports a visible error instead of modifying the OS database directly.

Run `npm run check` for focused tests. `npm run smoke` exercises both source-mode ASGI apps and Caddy through two start/stop cycles with explicit `ACESWARM_PYTHON` and `ACESWARM_CADDY`; `ACESWARM_RESOURCES=$PWD/dist/linux-unpacked/resources npm run smoke` verifies the packaged resources without requiring a desktop session. For embedded OS-mode tests run `PYTHONPATH=../aivudaOS python3 -m unittest discover -s ../aivudaOS/tests -p test_embedded_mode.py`.

For a controlled graphical smoke test on Linux, set `ACESWARM_SMOKE_EXIT_MS=3000` when launching the packaged executable under a display server. It logs `ACEswarm workbench ready` after the shell loads and quits cleanly after the requested delay (maximum 60 seconds).
