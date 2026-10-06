# Package MCP Services

ACEswarm starts both independent Python MCP services after the local APIs and
Gateway are ready. Each exposes stateless Streamable HTTP at `/mcp`; there is
no stdio transport. Startup fails if either MCP process cannot become ready.
The process guardian stops them and releases their ports on desktop exit.

| Service | Default client URL | Port override |
|---|---|---|
| AivudaOS | `http://127.0.0.1:28794/mcp` | `AIVUDAOS_MCP_PORT` |
| AppStore | `http://127.0.0.1:28795/mcp` | `AIVUDAAPPSTORE_MCP_PORT` |

Configure an HTTP-capable MCP client using these URLs, for example:

```json
{
  "mcpServers": {
    "aivudaos": {"url": "http://127.0.0.1:28794/mcp"},
    "aivudaappstore": {"url": "http://127.0.0.1:28795/mcp"}
  }
}
```

Client configuration syntax varies. When a package's `*_MCP_ACCESS_TOKEN` is
set, add `Authorization: Bearer <access-token>` to that client's HTTP headers.
This credential protects MCP itself. Backend credentials are separate:
`AIVUDAOS_MCP_TOKEN` and `AIVUDAAPPSTORE_MCP_TOKEN`, or per-call `token` and
`authorization` arguments. Login tools return credentials without saving them
globally, allowing different clients to use different backend accounts.

Tools are generated from the checked-out backend route definitions, so every
HTTP method/path has a tool, including file endpoints and HEAD. OS also exposes
the interactive WebSocket endpoint as an input/acknowledgement tool. AppStore
includes authenticated write operations; backend roles and ownership checks
still apply. JSON bodies use a `body` argument, forms use named fields, uploads
use base64 file objects, and binary downloads return base64 content. OS events
are read in bounded batches. See the package documentation:

- [AivudaOS MCP](../aivudaOS/docs/mcp.md)
- [AppStore MCP](../aivudaAppStore/docs/mcp.md)

ACEswarm forces loopback binding and supplies each MCP process with the correct
Caddy Gateway URL including its service prefix, so AppStore package redirects
reach Caddy's static file server. Logs remain in the workspace
logs directory as `aivudaos-mcp.log` and `aivudaappstore-mcp.log`.

Validation: package `tests/test_mcp_server.py` checks route coverage, forwarding,
HTTP protocol handling, authentication, file encoding, and limits. Run
`npm run smoke` for real SDK connections to both servers and backend login/API
calls over two startup/shutdown cycles. `npm run test:cleanup` also checks MCP
listeners are released across desktop exit modes.
