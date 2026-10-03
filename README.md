# ACEswarm

ACEswarm is a ground-station workbench for distributed drone and robot swarms.

## Download

Download the Linux x86_64 AppImage from the release server (tested on Ubuntu 22.04, higher versions should work). 

[Download ACEswarm AppImage](https://download.example.com/aceswarm/latest/ACEswarm-x86_64.AppImage)

## Run

```bash
chmod +x ACEswarm-x86_64.AppImage
./ACEswarm-x86_64.AppImage
```

You can also enable “Allow executing file as a program” in the file manager and double-click the AppImage.

The AppImage includes the Python runtime, AivudaOS, AivudaAppStore, the local application gateway, and the bundled applications. No separate Python, pip, FastAPI, Uvicorn, AivudaOS, AivudaAppStore, or Caddy installation is required.

On first launch, ACEswarm starts its local services, publishes the bundled applications to the local AppStore, imports the bundled AivudaOS configuration, and opens the workbench. First launch can take longer than subsequent launches.

## User data

The default user workspace is:

```text
~/ACEswarm_ws/
```

It contains local service data, installed applications, projects, experiments, logs, and bootstrap state. The AppImage itself remains read-only.

Electron also keeps browser data separately from the workspace. On Linux the default location is:

```text
~/.config/ACEswarm/
```

This directory contains the Electron browser cache, cookies, local storage, IndexedDB, and the persistent `persist:aceswarm` WebView session. The browser cache is separate from `~/ACEswarm_ws` and is reused across launches while the Gateway ports remain unchanged.

To clear Electron browser cache and WebView login/session data, first close ACEswarm, then remove the cache/session directories:

```bash
rm -rf ~/.config/ACEswarm/Cache \
       ~/.config/ACEswarm/Code\ Cache \
       ~/.config/ACEswarm/GPUCache \
       ~/.config/ACEswarm/Partitions/persist%3Aaceswarm
```

If your system uses a custom `XDG_CONFIG_HOME`, replace `~/.config` with `$XDG_CONFIG_HOME`. Clearing these directories removes browser cache, cookies, local storage, and WebView login state; it does not remove installed apps, projects, experiments, or service data in `~/ACEswarm_ws`.

To use another workspace:

```bash
ACESWARM_WS_ROOT=/path/to/ACEswarm_ws ./ACEswarm-x86_64.AppImage
```

## Uninstall

ACEswarm is distributed as an AppImage and does not require a system installer. Remove the downloaded AppImage:

```bash
rm ACEswarm-x86_64.AppImage
```

Removing the AppImage does not remove user data. To remove the workspace as well, after backing up anything you need:

```bash
rm -rf ~/ACEswarm_ws
```

This permanently removes projects, experiments, installed applications, logs, and local service data.

## Troubleshooting

If double-clicking does nothing, make the file executable:

```bash
chmod +x ACEswarm-x86_64.AppImage
```

Service logs are stored in:

```text
~/ACEswarm_ws/logs/
```

To repeat first-launch provisioning, close ACEswarm, back up the workspace, and remove only:

```text
~/ACEswarm_ws/state/
```

## Developer documentation

Development, architecture, runtime, bootstrap, build, and release documentation is in [`docs_dev/`](docs_dev/).
