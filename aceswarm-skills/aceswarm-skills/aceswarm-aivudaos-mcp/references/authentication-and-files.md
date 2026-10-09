# Authentication and request formats

- Built-in MCP is `/aivuda_os/mcp` on the same HTTP/HTTPS entry as OS APIs.
  It has no separate MCP listener.
- Try tools without a token first: MCP automatically logs in as `admin / admin123`,
  caches the managed token and refreshes it on expiry before retrying once.
  Ask for current username/password only when that login is rejected; network
  and service failures are not evidence of changed credentials.
- Through the forwarding gateway, keep `device_id` on login and later calls.
  HTTP Bearer credentials apply only to `local`; remote API tokens must be tool
  arguments for that device. Never reuse another device's token.
- On rejected login, call `login` with `body: {"username": "...", "password": "..."}`;
  pass its `access_token` as tool `token` or MCP HTTP Bearer header and verify `me`.
  Browser login does not authenticate tools. Manual login does not change the
  shared automatic account; explicit tool token overrides HTTP Bearer credentials.
  Explicit tokens are never silently replaced with default-account credentials.
- `AIVUDAOS_MCP_USERNAME` / `PASSWORD` configure automatic login;
  `AIVUDAOS_MCP_TOKEN` overrides it with an explicit API token. `MCP_MAX_BYTES`
  remains. Old HOST/PORT/BASE_URL/ACCESS_TOKEN settings do not configure the
  built-in endpoint.
- JSON payloads use `body`; path/query/form fields use their schema names. Upload
  fields contain `filename`, `content_base64` and optional `content_type`, not a
  server-local file path. Downloads return base64 with metadata; respect the
  configured size limit, including encoding overhead.
