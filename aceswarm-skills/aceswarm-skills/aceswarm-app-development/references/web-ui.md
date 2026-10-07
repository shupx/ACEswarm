# Built-in web UI and Panel Hub

## Standalone UI

Set `ui_index_path` to the packaged HTML entrypoint, normally `ui/index.html`.
AivudaOS generates Caddy routing for `/{app_id}/ui/` and its resources when
installing, uninstalling or changing active versions. ACEswarm discovers apps
with built-in UI and opens their URLs in separate Electron WebViews.

Build for this subpath: configure the bundler's base/public path or use relative
asset URLs. Verify JavaScript, CSS, fonts, images, workers, WASM and lazy chunks
under the actual gateway URL. Do not assume hosting at `/` or a fixed gateway
port. Choose hash routing or verify server fallback before using history routing.

The desktop preload/IPC bridge is a shell implementation detail, not the normal
app integration contract. Use the web UI and declared backend routes rather than
requiring Electron changes for an ordinary app.

## Runtime configuration in a static UI

A static page cannot read `AIVUDA_APP_CONFIG_PATH` or shell environment variables
directly. Transform YAML into a browser-readable
`ui/app-config.js` at startup; load it before the application bundle. Use a JSON
serializer, not string interpolation of YAML values into JavaScript. Export only
the public settings the browser needs, never passwords or tokens.

For the `my_app` configuration in [the package contract](package-and-runtime.md),
a self-contained `start.sh` can generate the public title and refresh interval:

```bash
#!/usr/bin/env bash
set -euo pipefail
# This app requires host python3 with PyYAML; prepare that dependency explicitly.
python3 - <<'PY'
import json
import os
from pathlib import Path
import yaml

config = yaml.safe_load(Path(os.environ['AIVUDA_APP_CONFIG_PATH']).read_text())
settings = config['my_app']
public = {'title': settings['title'], 'refreshMs': settings['refresh_ms']}
output = Path(os.environ['AIVUDA_APP_INSTALL_PATH']) / 'ui' / 'app-config.js'
output.write_text('window.__MY_APP_CONFIG__ = ' + json.dumps(public) + ';\n',
                  encoding='utf-8')
PY
exec tail -f /dev/null
```

Package the UI entrypoint and load configuration before its code:

```html
<script src="./app-config.js"></script>
<script src="./main.js"></script>
```

In `main.js`, read `window.__MY_APP_CONFIG__`. Include `main.js` in the package;
for a bundled frontend, replace that script URL with the actual build output.

Document whether edited configuration applies live or requires app restart and
page reload. Writing YAML through Config Center does not automatically regenerate
a startup-produced JavaScript file. Verify that restart refreshes this file and
reload fetches its new content; account for browser caching.

For a backend app, an API can provide public runtime configuration instead.
Declare an app Caddy fragment through `caddyfile_config_path` when proxy routes
are needed. Inspect current generated gateway config and backend bind settings
to select paths and ports without conflicting with other apps. Installation,
removal and active-version changes manage the declared fragment; avoid editing
the managed top-level Caddyfile as a substitute for an app package.

## Panel Hub / qiankun

Set `ui_mount_type: qiankun` only for an app that implements qiankun mounting.
This marks the built-in UI as discoverable by Panel Hub; a metadata flag alone
does not implement integration. `panelhub_mountable` is derived by AivudaOS from
the built-in UI and this mount type; do not rely on a custom boolean field.

Use the selected frontend's qiankun integration. If a compatible example is
available through AppStore MCP, inspect its package for build/runtime conventions;
do not require its original source project. Provide the lifecycle exports (`bootstrap`,
`mount`, `unmount`) using that build system's supported integration, scope mounting
to the supplied container, and release subscriptions, timers, listeners and roots
on unmount. Configure public paths and chunk loading for embedded execution.

Test the page standalone and inside Panel Hub, including unmount/remount and
multiple panels where supported. Clean up live connections when a panel is
removed. Do not copy all of Panel Hub's default layout or robot-specific settings
into an unrelated app.

## Zenoh and robot UI, when requested

Zenoh apps need configurable WebSocket proxy paths,
key expressions and robot prefixes. Compatible packages discovered through
AppStore MCP can provide examples, but their settings and services are not
universally available. Discover the actual proxy/service and protocol before using
them. Derive same-origin URLs from the gateway; select `ws:`/`wss:` to match the
page scheme. Display connection, empty and stale-data states.

Test commands against mocks or an explicitly authorized target. Opening a remote
robot page does not change which device local AivudaOS MCP manages.
