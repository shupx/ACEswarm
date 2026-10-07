---
name: aceswarm-appstore-mcp
description: Use AppStore MCP to discover and download packages, publish and manage app versions, administer members and accounts, and import or export store data.
---

# AppStore MCP

Use live schemas for tools, arguments and permissions. Discover app IDs, versions
and package metadata from the catalog or manageable-app list.

## Capabilities

Catalog/manifests/downloads, sample packages and CA downloads, package inspection,
app/version upload and editing, publication/withdrawal/deletion, members/admin
transfer, accounts/passwords/users and data import/export.

## Essential rules

- Public reads generally need no login. Try protected tools without authorization:
  MCP logs in automatically. Request current credentials only after login is rejected.
- Upload does not imply publication, and publication does not install/start an app
  on a device. Verify the requested result in developer details and public catalog.
- Distinguish unpublishing, deleting versions and deleting entire apps. Check roles
  rather than assuming administrator access or transferring ownership unnecessarily.
- Keep operations within existing user authorization and credentials out of files/logs.

## Read when needed

- For login failures, explicit credentials, uploads/downloads or request formats,
  read [authentication-and-files.md](references/authentication-and-files.md).
- Before publishing, version/member/account management, deletion or data import/export,
  read [workflows.md](references/workflows.md).
