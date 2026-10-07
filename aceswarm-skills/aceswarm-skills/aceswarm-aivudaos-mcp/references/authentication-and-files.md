# Authentication and request formats

- First call the requested tool without a token: MCP automatically logs in with
  the default account, caches the temporary token and refreshes it on expiry.
  Do not ask the user for a token or credentials before trying this flow.
- Only if automatic login rejects the account, ask for the current username and
  password. `login` takes `body: {"username": "...", "password": "..."}`;
  use the returned token and verify with `me`. Login does not change the MCP
  server's default account; browser login does not authenticate tools.
- `AIVUDAOS_MCP_USERNAME`/`AIVUDAOS_MCP_PASSWORD` configure the login account.
  `AIVUDAOS_MCP_TOKEN` or per-call `token` explicitly override automatic login.
  Network/service errors and permission failures are not evidence of changed credentials.
- `AIVUDAOS_MCP_ACCESS_TOKEN` protects the MCP endpoint separately via the client's
  HTTP `Authorization: Bearer ...` header. It is not the backend token.
- JSON payloads use `body`; path/query/form fields use their schema names. Upload
  fields contain `filename`, `content_base64` and optional `content_type`, not a
  server-local file path. Downloads return base64 with metadata; respect the
  configured size limit, including encoding overhead.
