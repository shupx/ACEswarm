# MCP development and verification

## Discover the target and tools

Use configured MCP connections and inspect live schemas. Names such as
`aceswarm-aivudaos`, `aceswarm-aivudaappstore` and `aceswarm-playwright` are client
conventions. Discover installed apps, active versions, status and URLs. Confirm
that the connected device is the user's intended installation target.

Try protected OS/Store tools without tokens first: these MCP servers support
automatic backend login. Ask for current credentials only if login is rejected;
network failures are not credential failures. Keep credentials out of packages,
skill files and logs. Browser login and MCP/backend authentication are separate.

## Obtain examples without platform sources

- Use AppStore `store_sample_package` to download a basic app package. Inspect
  the returned file metadata/content; download tools may return base64 bytes
  rather than writing a local file. Decode the returned bytes into a scratch
  archive using its filename/content type. Do not assume tool-server paths are
  accessible from the agent's filesystem.
- For Docker development, the updated standard sample includes
  `scripts/docker_helpers.sh`. Copy it into the new app package and follow
  [Docker helper guidance](docker-helpers.md). Check archive contents because
  an older running AppStore may still serve a sample without that file.
- For a specialized example, call `store_index`, select a relevant app from the
  actual catalog, and use `store_app_detail` to discover versions. Read metadata
  with `store_manifest` and obtain the archive with `store_download_file` for
  that app ID/version. Catalog manifests may describe distribution rather than
  contain every development field; inspect the archive's `manifest.yaml` too.
- If a download response supplies a URL instead of bytes, use the accessible
  download mechanism and returned URL, resolving relative URLs against the actual
  AppStore endpoint. Do not substitute fixed ports or require the user to clone
  the platform repository.
- List archive contents before extracting into scratch space. Reject paths that
  escape that directory. Read the manifest, scripts, default configuration/schema
  and UI entrypoint. A compiled frontend bundle is not a source project; create
  editable app source locally instead of claiming to rebuild absent sources.
- Downloading and inspecting examples does not require installing them. If the
  catalog or sample download is unavailable, use this skill's package contract
  and UI examples, complete local development, and report unavailable verification.

## Package inspection and installation

1. Finish local source/build checks and inspect the archive's manifest and files.
   AppStore's `dev_parse_package_manifest` can inspect package metadata when the
   tool is available; it does not replace AivudaOS's installation validation.
2. For a new app, use OS `upload_app`; for an existing app's new version, use
   `upgrade_app` when appropriate. Read installed versions first. Do not overwrite
   an unrelated app or enable overwrite merely to suppress a conflict. A same
   version development reinstall needs an intentional overwrite choice.
3. Upload the bytes using the live schema, usually a file object containing
   `filename`, `content_base64` and optional `content_type`. A local filesystem
   path is not an upload. OS tools generally call this field `file`; Store tools
   generally use `package_zip` even for tar archives. Respect size limits and
   base64 overhead. Do not dump large encoded packages into conversational output.
4. Follow any returned `operation_id` through `get_operation` or bounded
   `stream_operation_events` until terminal success/failure. Event batches ending
   or timing out do not mean the operation completed. Inspect interactive prompts
   and use the exposed input tool when needed; do not blindly resubmit failures.
5. Verify the installed and active version. Start/restart if needed and authorized,
   then inspect `get_app_status` and the available app log tool. Check that the
   process stays alive and that its functional endpoint or output works.

Configuration tools use revisions. Read the current app configuration/schema and
revision before writing, preserve unrelated values, reconcile revision conflicts,
and re-read. Restart only when the app's configuration mechanism requires it.

## Desktop and UI verification

1. Call `browser_tabs` with `action: list`; identify the Shell (`shell.html`).
2. Select the Shell and take `browser_snapshot`. Open the app through Applications,
   shortcuts or the desktop Open page/address controls using the discovered URL.
3. Re-list pages, select the app's separate WebView/CDP Page and snapshot it. The
   Shell accessibility snapshot normally does not include WebView content.
4. Exercise the requested UI behavior. Inspect console errors and failed network
   requests, including assets, configuration, API calls and WebSocket connections.
   Use screenshots for visual details that snapshots cannot establish.
5. For qiankun apps, also open Panel Hub and verify embedded mounting and cleanup.

Never navigate, change history or close the Shell through guest navigation tools;
the guard protects desktop controls. Select a guest first. Closing an app tab does
not stop its backend process, and a selected MCP Page is not necessarily the
currently visible desktop window.

## Store delivery, when requested

Use `dev_upload_package` for a new store app or `dev_upload_version` for an
existing app, following the live schemas and manageable-app permissions.
The package app ID/version must match metadata. If passing `manifest_json`, send
serialized JSON text and ensure it describes the actual packaged files. Store
editing may rewrite the packaged manifest, so inspect the resulting version.

Upload and publication are separate actions. Publish only within the user's
requested scope using `dev_publish_version`; verify developer details and the
public catalog/manifest. Store publication does not install or run the app on a
device. Do not use deletion, ownership transfer or bulk administration to work
around routine development problems.

If MCP is unavailable, deliver the validated local package and the unverified
installation/UI/publication steps. Do not claim remote success from local checks.
