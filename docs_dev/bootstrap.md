# Config Export and Bundled Application Bootstrap

## Canonical bootstrap file

The canonical file is:

```text
resources/seed-apps/aceswarm-config-export.json
```

It preserves the AivudaOS configuration export format and adds a top-level `aceswarm.packages` extension:

```json
{
  "format_version": 1,
  "aceswarm": {
    "packages": [
      {
        "artifact": "packages/app-example.zip",
        "sha256": "..."
      }
    ]
  },
  "payload": {
    "system_parameters": {},
    "apps": [
      {
        "app_id": "app-example",
        "version": "1.0.0",
        "parameters": {},
        "autostart": false,
        "running": false
      }
    ]
  }
}
```

AivudaOS ignores the unknown `aceswarm` field. ACEswarm uses it to locate and verify package archives.

## Bootstrap sequence

Bootstrap runs once per workspace. State is stored in
`<workspace>/state/seed-bootstrap.json`: `pending` before provisioning and
`completed` only after the configuration import succeeds. Failed or interrupted
first initialization is retried on the next launch. Later launches skip the
entire bootstrap, including publication and configuration import.

Existing workspaces without a marker are detected by the AivudaOS
`config/os.yaml` file before services start and marked as already initialized.
Upgrading ACEswarm therefore preserves user-managed apps. Removing, updating,
switching versions, or changing autostart on a seed app will not be undone at
startup. New bundled seed versions also do not automatically update an initialized
workspace; use Applications/Online Store or an explicit configuration import.
A fresh workspace receives the currently bundled seeds. A corrupt state marker
reports an error rather than silently reinstalling applications.

```text
Read aceswarm-config-export.json
    ↓
Validate the export format
    ↓
Validate package paths and SHA-256 digests
    ↓
Parse every package manifest through the AppStore API
    ↓
Match app IDs and versions with payload.apps
    ↓
Publish missing versions to the local AppStore
    ↓
Call AivudaOS /aivuda_os/api/config/import
    ↓
AivudaOS downloads and installs applications from the local AppStore
    ↓
AivudaOS restores parameters and autostart
```

## Design rules

- ACEswarm does not interpret application parameters;
- ACEswarm does not install applications directly into AivudaOS;
- ACEswarm does not access either database;
- AivudaOS owns import, installation, parameter merging, and autostart semantics;
- running state is not restored by default;
- the embedded ground-station hostname is not changed by an export;
- packages must be published to AppStore before AivudaOS can install them.

## Updating bundled applications

The current prepkg set contains Comm Status Viewer 0.2.3, Swarm Controlpad
0.2.2, Swarm Dashboard 0.2.2, Panel Hub 0.1.0 and Hello World 1.1.0.
Zenoh is not bundled. Refresh the approved Store archives and their hashes with:

```sh
python3 scripts/refresh-seed-apps.py --store-url http://127.0.0.1:28791
```

This command downloads packages during development. First-workspace bootstrap
publishes the bundled archives to the local Store and installs from that local
service; these five installation hooks do not fetch external dependencies.
They use the host shell and AivudaOS app helpers. The three swarm app startup
scripts require host `python3` and `PyYAML`; ACEswarm's private service runtime
does not automatically expose its Python modules to app scripts.
The three swarm panels still require a reachable Zenoh remote API for live data
and commands; installing their static UI does not supply a Zenoh service.

1. Place approved archives in `resources/seed-apps/packages/`;
2. read each archive's `manifest.yaml`;
3. update `payload.apps`;
4. update `aceswarm.packages`;
5. recompute SHA-256 values with `sha256sum`;
6. run the test, bundle verification, and smoke commands;
7. rebuild the AppImage.
