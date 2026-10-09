# Device selection and MCP gateway

ACEswarm starts a forwarding MCP gateway at `http://127.0.0.1:28794/mcp`
(default; configurable by `ACESWARM_AIVUDAOS_MCP_PORT`). Discover the actual
connection rather than assuming that port. The local target points to the built-in
OS MCP at the main web gateway's `/aivuda_os/mcp`, normally port 28790.
Independent remote OS instances expose the same path on their HTTP/HTTPS entry.

The forwarding gateway discovers local OS tool names/schemas and adds optional
`device_id`, default `local`. It does not duplicate business logic. Its additional
tools are `list_devices`, `add_device`, `update_device`, `remove_device`,
`get_device_status` and `reconnect_device`; inspect live schemas for parameters.
Direct OS MCP connections expose only business tools, without `device_id`.

Before remote work, list registered devices and match the user's requested target.
If registration is needed and within the task scope, call `add_device` with
`device_id` and the actual `mcp_url`, such as
`https://robot-a.local/aivuda_os/mcp`. The handshake/tool discovery must succeed
before registration is saved. `update_device` updates a registered remote's URL,
timeout or CA; `local` cannot be changed or removed. Registrations survive restart
in `state/aivudaos-mcp-devices.json`; removing one does not stop remote apps or OS.

Use `ca_file` for an absolute PEM CA path on the ACEswarm host when a remote
uses a private/self-signed CA. HTTPS certificate and hostname checks remain enabled;
do not disable TLS verification. Default `timeout_seconds` is 90, range 1–120.
URLs accept HTTP(S) without embedded credentials, queries or fragments.

For example, after registration, call
`list_installed_apps(device_id="robot-a")`. Keep that `device_id` on status,
configuration, lifecycle, logs, login, operation status/events/input/cancellation.
Operation IDs and API tokens belong to their target device. Gateway HTTP Bearer
credentials apply only to `local`; for remote calls provide that device's API
`token` explicitly if needed. Each target OS first tries its own default/configured
automatic login. Ask for current credentials only if that login is rejected.

The published business catalog follows the local OS version. A remote may not
support a tool or its parameters; report that mismatch instead of assuming parity.
`reconnect_device` refreshes capabilities, `get_device_status` checks reachability.
Remote registry entries load lazily, so an offline remote does not prevent startup.
The gateway forwards stateless JSON MCP calls; it is not a universal proxy for
session/SSE MCP servers. Business calls are not automatically retried. After a
connection failure during a write, inspect the target's operation/app state before
resubmitting, because it may already have executed.
