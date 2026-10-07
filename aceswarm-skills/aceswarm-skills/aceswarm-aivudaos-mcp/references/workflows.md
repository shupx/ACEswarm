# Workflows and verification

| Task | Workflow |
|---|---|
| Inspect apps | List apps/versions; read status, logs, icons and active/app configuration |
| Install/upgrade | Inspect manifest and target app/version; upload, track any operation ID, then verify installed version and runtime status |
| Run apps | Start/stop/restart, set autostart or use scoped bulk actions; verify final status and logs |
| Switch/update/remove versions | Read versions; apply requested change/restart policy; distinguish removing one version from purging app/data |
| Edit config | Read global/OS/app config and revision; modify requested fields; write with expected revision and re-read; reconcile conflicts rather than blindly retry |
| Shared parameters | Discover magnets and affected apps; update the requested key/group using its schema and revision |
| Export/import config | Export config/metadata; import needs a document and actual AppStore base URL and may queue installs or other work |
| System administration | Discover service status/autostart/actions, system-user relogin, sudo settings, APT sources/backups/restore, Avahi and CA download tools; use those relevant to the task |

Store publication differs from device installation. Discover published packages
through AppStore MCP, then use the device install workflow; neither upload nor
install alone proves an app is running successfully.

## Asynchronous operations

Capture any returned `operation_id`. Poll `get_operation` or read bounded
`stream_operation_events` batches until a terminal state. Batches can time out
and repeat events: deduplicate by `seq` and check status, not just end-of-batch.

When input is requested, inspect the prompt and use `operation_interactive_ws`
with the operation ID, token and requested `data`. It performs one input exchange;
continue observing status/events afterward. Do not cancel solely because a job
is waiting for a documented input choice. On terminal failure, report errors/logs
and avoid blind resubmission.

A successful start job does not prove the process stayed alive: verify status and
logs. Keep tokens out of files/logs and changes within the user's target and scope,
including the effects of bulk actions and config import.
