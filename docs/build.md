# Linux x86_64 build

The lock in `resources/runtime-lock.json` fixes CPython standalone (`install_only`), Caddy versions, URLs and SHA-256 digests. The build verifies archive hashes before extraction. A predownloaded archive can be placed in `${ACESWARM_DOWNLOAD_CACHE:-/tmp/aceswarm-download}` as `python.tar.gz` and `caddy.tar.gz`. Archive downloads use TLS verification by default; if the build host has a custom interception certificate, configure its trust store. `ACESWARM_CURL_INSECURE=1` is an explicit emergency-only override; SHA-256 verification still applies. A missing digest aborts before downloading.

Build each independent frontend first (`npm ci --include=dev && npm run build` from each sibling package's `resources/ui` folder). From ACEswarm run `npm ci --include=dev`, `npm run bundle:runtime`, `npm run bundle:verify`, then `npm run dist`. Packaging uses electron-builder's Linux AppImage target. The build host needs Node.js/npm, tar, curl, rsync, compiler tools for any native Python wheels, enough disk space (several GB), internet access at **build** time, and both sibling package source trees. Runtime extraction, installed packages and wheels are staged under `resources/python-runtime`, `resources/python-packages` and `resources/python-wheels` (ignored by Git). Only staged snapshots are modified during wheel generation, not the independent checkouts. The package includes both installed Python packages (with their UI distributions) as a separate `extraResources` entry, not just the standalone Python standard library. The generated `resources/release-manifest.json` contains architecture, package versions and executable/package hashes, verified again on packaged launch. Set `ACESWARM_OFFLINE=1` to use cached Python/Caddy archives and prebuilt UIs without network requests; dependency wheels must already be present in the wheelhouse.

Run `ACESWARM_RESOURCES=$PWD/dist/linux-unpacked/resources npm run smoke` after packaging, then launch the AppImage on the intended target distribution. The canonical seed export and four approved app archives are staged from `/home/spx/spx_ws/ACE/prepkg`. Only Linux x86_64 is supported in this release. Cross-distribution glibc compatibility, graphical AppImage startup, clean-container/offline smoke and app-install/reload tests remain release gates; do not claim a successful release without those tests. Workspace migration and rollback are reserved by `workspaceSchema` in the release manifest; delta updates and arm64 are deferred. User workspace content is never overwritten by the package build.

## Offline seed bootstrap

Export the desired system/app settings with the AivudaOS Config Center. Save it as
`resources/seed-apps/aceswarm-config-export.json` and add an `aceswarm.packages`
extension; place approved archives in `resources/seed-apps/packages/`:

```json
{
  "format_version": 1,
  "payload": {"system_parameters": {}, "apps": [{"app_id": "my-app", "name": "My App", "version": "1.0.0", "parameters": {}, "autostart": false}]},
  "aceswarm": {"packages": [{"artifact": "packages/my-app.zip", "sha256": "<64 lowercase hex characters>"}]}
}
```

Compute each digest with `sha256sum` after finalizing the artifact. Every
archive must appear exactly once in the extension, and its `manifest.yaml`
must identify the same app/version as one entry in `payload.apps`.
The AppStore public parse-package and upload-package/version endpoints validate
and publish archives; the separate loopback Caddy store gateway serves published
file URLs. Set `ACESWARM_SEED_ADMIN_PASSWORD` and
`ACESWARM_SEED_STORE_PASSWORD` to the local OS and AppStore admin passwords.
On startup the desktop publishes missing seed versions, posts the export to
`/aivuda_os/api/config/import`, and polls its operation until completion.
Any verification, parsing or publication failure aborts the import. The OS
ignores exported hostname and running state; it ignores the `aceswarm` extension.
No ACEswarm database writes or custom parameter interpretation are involved.
