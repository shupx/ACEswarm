# Workflows and verification

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
