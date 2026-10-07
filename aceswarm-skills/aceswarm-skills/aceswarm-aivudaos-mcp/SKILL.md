---
name: aceswarm-aivudaos-mcp
description: Operate AivudaOS through MCP to install and manage apps, inspect logs, edit configuration, manage system settings, and follow asynchronous operations.
---

# AivudaOS MCP

Use live tool schemas and confirm the device. Discover apps, IDs, versions and
running state; UI interaction belongs to Playwright MCP.

## Capabilities

App installation/upgrades, lifecycle/autostart/bulk control, version management,
status/logs/icons, global/OS/app configuration, magnets, config import/export,
system services/users, sudo, APT sources/backups, Avahi and CA downloads.

## Essential rules

- Try protected tools without a token first: MCP logs in automatically and refreshes
  temporary tokens. Ask for current username/password only after login is rejected.
- Store publication, device installation and a healthy running process are separate results.
- Follow returned operation IDs to a terminal state. A completed start job still
  requires checking status/logs; event batch completion does not mean job completion.
- Read config revisions before writing; reconcile conflicts. Keep changes within
  the user's target/scope, and keep credentials out of files/logs.

## Read when needed

- For login failures, explicit credentials, uploads/downloads or request formats,
  read [authentication-and-files.md](references/authentication-and-files.md).
- Before installation, lifecycle/version changes, config/system changes or handling
  queued/interactive jobs, read [workflows.md](references/workflows.md).
