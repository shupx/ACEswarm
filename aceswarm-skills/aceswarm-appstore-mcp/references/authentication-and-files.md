# Authentication and request formats

- Public catalog/manifest/download tools generally allow anonymous access.
  Developer operations enforce authentication and roles; login and registration
  are exceptions to authenticated developer operations.
- First try protected tools without authorization: MCP automatically logs in with
  the default account, caches the temporary token and refreshes it on expiry.
  Do not ask for credentials unless automatic login rejects the account.
- After a rejected login, request the current username/password. `dev_login`
  takes top-level `username` and `password` form fields. Pass its token
  as `authorization: "Bearer <token>"` and verify with `dev_me`. Optional schema
  fields do not imply the backend permits anonymous access.
- `AIVUDAAPPSTORE_MCP_USERNAME`/`AIVUDAAPPSTORE_MCP_PASSWORD` configure the account.
  `AIVUDAAPPSTORE_MCP_TOKEN` supplies an explicit backend token (token text only);
  per-call authorization overrides it. Login does not change the server default,
  and browser login is separate.
  Network/service errors and permission failures do not imply changed credentials.
- `AIVUDAAPPSTORE_MCP_ACCESS_TOKEN` protects the MCP endpoint separately through
  the client's HTTP Bearer header. Do not substitute it for the backend token.
- JSON bodies use `body`; forms use named fields. `manifest_json` is serialized
  JSON text. Uploads contain `filename`, `content_base64` and optional
  `content_type`; get the file field name from the schema (package versus data
  import). Local paths are not uploaded automatically. Downloads return base64
  with metadata; respect the size limit, including encoding overhead.
