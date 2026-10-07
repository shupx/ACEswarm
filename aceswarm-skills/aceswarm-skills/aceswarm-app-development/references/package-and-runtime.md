# Package and runtime contract

## Minimal package

Support `.tar.gz`, `.tgz`, `.tar`, `.tar.xz`, `.txz` or `.zip` according to the
target installer. Prefer `.tar.gz` to preserve Unix executable permissions.
Place `manifest.yaml` at archive root, or under its single wrapping directory.

```text
manifest.yaml
start.sh
config/default_config.yaml
config/config_schema.yaml
ui/index.html                 # only for apps with UI
assets/icon.svg               # optional
scripts/pre_install.sh        # optional
```

```yaml
app_id: my-app
name: My App
description: An ACEswarm app
version: 0.1.0
run:
  entrypoint: ./start.sh
  args: []
default_config_path: ./config/default_config.yaml
config_schema_path: ./config/config_schema.yaml
# Include only if these files actually exist:
# icon: ./assets/icon.svg
# ui_index_path: ./ui/index.html
# ui_mount_type: qiankun
# caddyfile_config_path: ./config/app.caddy
# pre_install: ./scripts/pre_install.sh
# pre_uninstall: ./scripts/pre_uninstall.sh
# update_this_version: ./scripts/update_this_version.sh
```

The app ID and version must agree with store metadata when uploading a version.
All referenced package files must exist inside the package; use relative paths.
`run.entrypoint` is executed as a file, not a shell command string. Supply a
shebang and executable permissions; `run.args` is a list of arguments.

## Configuration

The installer requires both configuration file paths. Their YAML/JSON contents
must parse as objects. For an app without parameters, use `{}` in the default
file and an object schema, rather than omitting the files.

Example default configuration:

```yaml
my_app:
  title: My App
  refresh_ms: 1000
```

Corresponding schema:

```yaml
type: object
properties:
  my_app:
    type: object
    properties:
      title:
        type: string
        default: My App
        description: Display title
      refresh_ms:
        type: integer
        default: 1000
        minimum: 100
        description: Refresh interval in milliseconds
    required: [title, refresh_ms]
required: [my_app]
```

AivudaOS checks defaults against the schema at installation and validates
configuration again before startup. The Config Center uses schema descriptions,
types, enums, ranges and defaults to present editable parameters. A schema
`default` alone is not a replacement for values in the default configuration file.
Namespace app-specific values. Inspect magnets/shared parameters before changing
keys used by other apps; do not invent global dependencies from one example.

## Entrypoint and environment

AivudaOS starts the app with its installation directory as working directory and
provides:

| Variable | Purpose |
|---|---|
| `AIVUDA_APP_ID`, `AIVUDA_APP_VERSION` | App identity and active version |
| `AIVUDA_APP_INSTALL_PATH` | Absolute version installation directory |
| `AIVUDA_APP_CONFIG_PATH` | Active app configuration YAML path |
| `AIVUDA_APP_RUNTIME_DATA_PATH` | Writable runtime data directory for this version |
| `AIVUDA_APP_HELPERS_ENTRY_PATH` | Shell helper entrypoint |
| `AIVUDA_OS_AVAHI_HOSTNAME` | Configured OS Avahi hostname |

For shell configuration access, use the runtime-provided helper:

```bash
#!/usr/bin/env bash
set -euo pipefail
source "${AIVUDA_APP_HELPERS_ENTRY_PATH}"
title="$(aivuda_yaml_get 'my_app.title' 'My App')"
# Prepare app-specific configuration, then exec the actual foreground process.
```

Use `exec` for the foreground backend so stop/restart reaches the service.
For several processes, implement cleanup and signal handling. Do not daemonize
the only tracked process and exit while claiming it is healthy.

Static UI is served by Caddy, not by `start.sh`. A static UI app can
generate `ui/app-config.js` at startup and then use `exec tail -f /dev/null` to
keep a managed process alive. This is an example convention, not a backend
server; check both generated configuration and the actual page behavior.

Keep runtime artifacts under the supplied runtime data path. It is version
specific; define explicit persistence/migration if data must survive version
changes. Avoid hardcoding `$HOME/aivudaOS_ws`: embedded ACEswarm uses its own
workspace. Do not modify service databases directly.

## Hooks and dependencies

`pre_install` runs in the final version directory. After it completes, the
installer reloads schema/default files and validates defaults, allowing hooks to
generate those files. `pre_uninstall` and `update_this_version` are optional;
nonzero hook exits are failures. Version updates are explicitly triggered;
do not confuse them with uploading a new version.

Declare required interpreters, libraries and external services. Make installation
repeatable and surface dependency failures. Do not assume Electron's embedded
Python is the app's host interpreter or that a ROS/Docker/Zenoh setup exists.
Check the relevant example and target environment when these are requested.

For host/container dispatch, read [Docker helpers](docker-helpers.md). App-local
Docker helpers and AivudaOS's configuration helper are separate; packaging one
does not imply the other is available inside a container.

## Packaging

Build into a staging directory containing only runtime files and the manifest.
Keep the output archive outside that directory. For example, from a package's
parent directory:

```bash
chmod +x my-app/start.sh
tar -czf my-app-0.1.0.tar.gz -C my-app .
tar -tzf my-app-0.1.0.tar.gz
```

Include built assets and required dependencies; omit credentials, caches,
development-only `node_modules`, VCS metadata and earlier output archives.
Inspect the resulting archive, not just the app source tree. If a downloaded
example includes `pack.sh`, it can be adapted, but its exclusions do not replace
selecting the intended package contents. No platform source files are needed to
build this archive.
