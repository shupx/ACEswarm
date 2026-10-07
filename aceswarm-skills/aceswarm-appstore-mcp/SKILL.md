---
name: aceswarm-appstore-mcp
description: Use AppStore MCP to discover and download packages, publish and manage app versions, administer members and accounts, and import or export store data.
---

# AppStore MCP

Use live tool schemas for names, required fields and permissions. Discover app IDs,
versions and package metadata from the catalog or manageable-app list; never
assume a particular store, account or installed app set.

## Authentication and requests

- Public catalog/manifest/download tools generally allow anonymous access.
  Developer operations enforce authentication and roles; login and registration
  are exceptions to authenticated developer operations.
- `dev_login` takes top-level `username` and `password` form fields. Pass its token
  as `authorization: "Bearer <token>"` and verify with `dev_me`. Optional schema
  fields do not imply the backend permits anonymous access.
- `AIVUDAAPPSTORE_MCP_TOKEN` supplies the default backend token (token text only);
  per-call authorization overrides it. Login does not change the server default,
  and browser login is separate.
- `AIVUDAAPPSTORE_MCP_ACCESS_TOKEN` protects the MCP endpoint separately through
  the client's HTTP Bearer header. Do not substitute it for the backend token.
- JSON bodies use `body`; forms use named fields. `manifest_json` is serialized
  JSON text. Uploads contain `filename`, `content_base64` and optional
  `content_type`; get the file field name from the schema (package versus data
  import). Local paths are not uploaded automatically. Downloads return base64
  with metadata; respect the size limit, including encoding overhead.

## Workflows and capabilities

| Task | Workflow |
|---|---|
| Browse/download | Query catalog, details, versions, manifests and download metadata/content; distinguish published entries from developer drafts; sample packages and CA downloads may also be available |
| Publish a new app | Parse/inspect manifest; upload package and metadata, then publish the intended version; upload alone does not publish |
| Add/change a version | Inspect permissions and existing versions; upload/modify the selected version, then publish if requested |
| Withdraw/remove | Distinguish unpublishing from deleting a version or entire app; verify requested visibility/data changes |
| Manage access | Read members/roles; add/remove or batch-edit memberships; transfer administration only when requested, since developer membership may already grant version-writing permission |
| Manage accounts | Use identity, registration, password and user-management tools according to account permissions |
| Export/import data | Discover exportable apps; export requested scope; inspect archive and effects before applying an authorized import |

After changes, re-read developer details and, for publication changes, the public
catalog. Verify app ID, version, publication state and available size/hash metadata.
Store upload/publication does not install or start an app on AivudaOS; use the OS
workflow when deployment is requested.

Keep credentials out of files/logs. Permission failures call for checking account,
role and target, not assuming administrator access or repeatedly uploading.
Existing user authorization covers changes within its stated scope.
