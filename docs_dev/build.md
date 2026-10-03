# Linux x86_64 Build and Release

## Runtime bundle

`resources/runtime-lock.json` pins the standalone CPython runtime and Caddy versions, URLs, and SHA-256 digests. The build verifies archive hashes before extraction.

A pre-downloaded archive may be placed in `${ACESWARM_DOWNLOAD_CACHE:-/tmp/aceswarm-download}`:

```text
python.tar.gz
caddy.tar.gz
```

TLS verification is enabled by default. `ACESWARM_CURL_INSECURE=1` is an explicit emergency override; SHA-256 verification still applies.

## Build

Build the independent frontends first:

```bash
cd /path/to/aivudaOS/aivudaos/resources/ui
npm ci --include=dev
npm run build

cd /path/to/aivudaAppStore/aivudaappstore/resources/ui
npm ci --include=dev
npm run build
```

Then build ACEswarm:

```bash
cd /path/to/ACEswarm
npm ci --include=dev
npm run bundle:runtime
npm run bundle:verify
npm run dist
```

The release artifact is:

```text
dist/ACEswarm-<version>-x86_64.AppImage
```

## Build requirements

The build host needs:

- Node.js and npm;
- Python build tooling;
- tar, curl, and rsync;
- compiler tools for native Python wheels;
- several GB of free disk space;
- access to the sibling AivudaOS and AivudaAppStore source trees.

The runtime, Python packages, wheels, Caddy, and release manifest are build outputs. They are excluded from the source repository where appropriate and are included in the AppImage.

## Offline build

Set:

```bash
ACESWARM_OFFLINE=1
```

to use cached runtime archives, existing frontend builds, and a pre-populated wheelhouse. The required archives and wheels must already exist locally.

## Seed package preparation

The canonical bootstrap file is:

```text
resources/seed-apps/aceswarm-config-export.json
```

Place application archives in:

```text
resources/seed-apps/packages/
```

Each archive must contain a valid `manifest.yaml`. The `aceswarm.packages` extension must list every archive exactly once with its SHA-256 digest, and each archive's app ID/version must match one entry in `payload.apps`.

## Validation

```bash
npm test
npm run check
npm run bundle:verify
npm run smoke
ACESWARM_RESOURCES=$PWD/dist/linux-unpacked/resources npm run smoke
```

For a graphical smoke test:

```bash
ACESWARM_SMOKE_EXIT_MS=3000 ./dist/ACEswarm-<version>-x86_64.AppImage --no-sandbox
```

The test should log:

```text
ACEswarm workbench ready
```

and exit cleanly after the requested delay.
