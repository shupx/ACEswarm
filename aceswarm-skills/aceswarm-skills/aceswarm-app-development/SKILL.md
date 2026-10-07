---
name: aceswarm-app-development
description: Develop, package, and debug ACEswarm/AivudaOS apps, including built-in web UI, runtime configuration, Panel Hub integration, and MCP installation and verification. Use for creating or modifying app packages, not for changing the Electron desktop itself.
---

# ACEswarm app development

Build an AivudaOS-compatible app package that ACEswarm can install and open.
ACEswarm is the Electron host; AivudaOS owns installation, configuration and
process lifecycle; Caddy serves app UI and optional proxy routes; AppStore owns
distribution. An ordinary app does not require editing Electron or its database.

## Discover the environment and choose the app shape

This skill and its bundled references contain the development contract. The
agent does not need an ACEswarm, AivudaOS or AppStore source checkout. Do not ask
the user to obtain platform sources as a prerequisite for app development.

- Work in the user's app project, or create an app project in the authorized
  workspace. Read applicable `AGENTS.md` files there if present.
- When MCP is available, discover the target device, installed versions and
  available tools. Retrieve a basic example with AppStore `store_sample_package`.
  For more specific examples, discover app IDs/versions with `store_index` and
  `store_app_detail`, then use `store_download_file`. Do not assume particular
  example apps are installed or published. See the
  [MCP development loop](references/mcp-development-loop.md) for download handling.
- Inspect downloaded manifests, entrypoints, configuration and UI files in a
  scratch directory. Built UI assets may not include editable frontend sources.
  Examples help with compatibility but are not prerequisites: build from this
  skill's contract when examples or MCP are unavailable.
- Choose a backend service, static UI, or combined app based on the requested
  functionality. Add qiankun integration only when Panel Hub embedding is needed.
  Preserve existing app IDs and version conventions when modifying an app.

## Build the package

Read [package and runtime contract](references/package-and-runtime.md) before
creating or modifying manifests, configuration or entrypoints. Both
`default_config_path` and `config_schema_path` are required by the current
AivudaOS installer. Include both even if a downloaded example describes them as
optional. Use live tool schemas, package inspection and target validation results
to resolve version-specific differences; do not rely on access to platform code.

Read [web UI integration](references/web-ui.md) when adding a built-in UI,
backend proxy, startup-generated UI configuration, or Panel Hub support.
Keep the application source and build procedure reviewable; package the build
output rather than relying on an agent's local development server.

Use environment-provided installation/configuration/runtime paths. Declare and
prepare actual app dependencies; the desktop's private Python runtime does not
guarantee an app can import arbitrary packages with the host `python3`.

## Verify and deliver

Read [MCP development loop](references/mcp-development-loop.md) for installation,
logs, operation tracking, UI verification and optional publication. Discover the
current tool schemas and target instance rather than fixing ports or server names.

Validate manifest paths, default configuration against its schema, executable
scripts, and the built UI's asset paths before uploading. Run the relevant app
build/checks and exercise its requested behavior. A successful upload or a
`running` flag alone does not prove the app works.

Deliver the source location, package path, app ID/version, build commands and
observed validation result. Distinguish a locally built package, an installed
app, a healthy process, a working UI and a published store version. If a service
or device is unavailable, finish local work and state what remains unverified.
Use the user's existing authorization; developing an app does not itself imply
publishing it, changing shared system configuration, or sending robot commands.

## Optional companion skills

Related skills, when installed: `aceswarm-aivudaos-mcp` for device operations,
`aceswarm-appstore-mcp` for store operations, and `aceswarm-overview` for desktop
interaction. The references here also describe the essential development loop.
