# Docker helpers for app development

## Helper sources and discovery

`source "${AIVUDA_APP_HELPERS_ENTRY_PATH}"` loads AivudaOS runtime helpers,
including `aivuda_yaml_get`. It does not guarantee Docker functions.
Docker-capable apps typically package their own `scripts/docker_helpers.sh`
and source it separately in `start.sh` and installation hooks.

Use AppStore MCP `store_sample_package` to obtain the standard example archive,
decode/download it as described in [the MCP development loop](mcp-development-loop.md),
and extract it into scratch space. The updated example includes
`scripts/docker_helpers.sh`; copy that file into the new app's `scripts/` directory
and package it with the app. Read its included README and definitions before use.
No platform source checkout or installed example app is needed.

Check that the downloaded archive actually contains the helper: older AppStore
deployments may serve an earlier sample. If absent, discover and download a
Docker-capable app through the catalog and inspect its helper and callers together,
subject to its reuse license, or implement an app-local wrapper with the lifecycle
behavior below. Do not call functions absent from the package. Fetching a sample
does not update a running AppStore to a newer distribution.

## Common interfaces, not a universal API

One managed helper family exposes:

| Function | Behavior |
|---|---|
| `docker_helper_target_use_host` | Select host execution |
| `docker_helper_target_use_docker_container NAME` | Select an existing container |
| `docker_helper_target_require_available [PREFIX]` | Check availability; the Docker target must already be running |
| `docker_helper_target_exec_bash COMMAND` | Run a Bash command string on the selected target |
| `docker_helper_target_select_install_target` | Interactively select host or a running container during installation |
| `docker_helper_target_is_docker` | Test selected mode |
| `docker_helper_target_container` | Print selected container name |
| `docker_helper_set_yaml_value PATH KEY TYPE VALUE` | Set a dotted YAML key; requires host Python/PyYAML |

Other packages use `docker_use_host`, `docker_use_container`,
`docker_require_target` and `docker_run_script`. These can be app-specific and
may lack managed process cleanup. Inspect definitions before adapting them;
matching a filename does not prove API or lifecycle compatibility.

Selecting a target does not create/start containers, mount files, forward app
environment variables or install dependencies.

## Configuration and dispatch

Use app-specific configuration and matching boolean/string schema fields:

```yaml
my_app:
  docker:
    enabled: false
    container: ""
```

When enabled, require a nonempty container name and report CLI, daemon,
permission or target failures. Do not silently fall back to host execution.
For the managed helper family above, dispatch from the host entrypoint to a
separate target script:

```bash
#!/usr/bin/env bash
set -euo pipefail
APP_ROOT="${AIVUDA_APP_INSTALL_PATH:?}"
source "${AIVUDA_APP_HELPERS_ENTRY_PATH:?}"
source "${APP_ROOT}/scripts/docker_helpers.sh"
enabled="$(aivuda_yaml_get 'my_app.docker.enabled' 'false')"
container="$(aivuda_yaml_get 'my_app.docker.container' '')"
if [[ "$enabled" == true ]]; then
  docker_helper_target_use_docker_container "$container"
  docker_helper_target_require_available '[start.sh]'
  # Contract: these absolute paths are also accessible inside the container.
  printf -v command '%q ' env \
    "AIVUDA_APP_ID=${AIVUDA_APP_ID:?}" \
    "AIVUDA_APP_VERSION=${AIVUDA_APP_VERSION:?}" \
    "AIVUDA_APP_INSTALL_PATH=$APP_ROOT" \
    "AIVUDA_APP_CONFIG_PATH=${AIVUDA_APP_CONFIG_PATH:?}" \
    "AIVUDA_APP_RUNTIME_DATA_PATH=${AIVUDA_APP_RUNTIME_DATA_PATH:?}" \
    bash "$APP_ROOT/scripts/run_in_target.sh"
  docker_helper_target_exec_bash "$command"
else
  exec bash "$APP_ROOT/scripts/run_in_target.sh"
fi
```

Package `run_in_target.sh`; start its foreground workload with `exec`. Read or
generate config on the host if the container lacks its parser. If target scripts
need the runtime helper, make its entrypoint and supporting files accessible in
the container and pass its path explicitly. Shell functions are not transferred.

Quote each dynamic value with `printf %q` for the command-string API; do not
concatenate unchecked config into shell code. Call managed helper functions
normally, not with `exec docker_helper_target_exec_bash`. Avoid recursive Docker
dispatch; use a target script or an explicit guard for re-entering `start.sh`.

## Paths, environment and dependencies

Choose and document a path strategy:

- Bind-mount the app, config and runtime directories at the paths passed into
  the container. Include helper files if target scripts use them; check paths
  inside the target, not only on the host.
- Copy required files into an app-specific container directory and translate all
  paths. Keep install-time builds available at startup; building in a temporary
  container directory while launching a host workspace is inconsistent. Define
  how config updates and output data cross the container boundary.

Install/check dependencies on the selected target. Host ROS availability does
not prove container ROS availability. `docker exec` does not inherit host
`AIVUDA_*` variables; forward required values explicitly. Declare network,
serial-device, display/GPU requirements when needed. Using an existing container
does not change its mounts or device/network settings.

## Installation and MCP

Interactive selection may list running containers and prompt for a target. In
the managed helper family above, non-TTY installation defaults to host. Inspect
operation events and resulting config rather than assuming Docker was selected.
Provide explicit noninteractive selection if automated deployment requires it.

If a hook persists the selected target in packaged default YAML, provide matching
schema fields. AivudaOS reloads and validates both files after the hook; package
defaults and existing user configuration are distinct. Track operation IDs and
answer exposed interactive prompts instead of starting another install.

## Stop, restart and verification

Stopping the host `docker exec` client alone can leave container children alive.
A managed helper should track the child PID/process group, handle host exit and
signals, terminate only this app's workload, propagate exit codes and release
temporary state/locks. Prefer process-group cleanup (for example with container
`setsid`) for workloads with children; check utilities and weaker fallback behavior.

The managed family above disallows concurrent/nested managed calls within one
start-script process. Run related nodes under one target-side supervisor with
cleanup instead of backgrounding several managed calls. Preserve the helper's
cleanup traps. Do not stop a shared container or kill unrelated processes to stop
one app.

Verify host and Docker modes separately. For Docker mode, test start, normal exit,
failed launch, stop and restart; confirm target-side children disappear and restart
does not duplicate workers. Check logs, config changes and files on the target.
If no Docker target is available, state that lifecycle verification is incomplete.
