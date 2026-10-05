# Agent browser connection

ACEswarm automatically exposes its running Electron browser through a loopback
Chrome DevTools Protocol (CDP) listener. Agents attach with Playwright's
`chromium.connectOverCDP` (Python: `chromium.connect_over_cdp`). The agent's
Playwright installation supplies the client; ACEswarm does not launch another
browser or require Playwright in the packaged runtime.

An MCP server starts inside Electron at `http://127.0.0.1:28792/mcp` and uses
Streamable HTTP. Configure this URL in an MCP client, then call
`get_browser_connection` with `{}`. The tool returns:

- `cdpEndpoint`: HTTP endpoint accepted by Playwright.
- `browserWSEndpoint`: browser-level CDP WebSocket URL.
- `mcpUrl`, `pid`, and `transport`: discovery metadata.
- `targets`: current Chromium targets with IDs, types, titles, and URLs.
- `javascript`, `python`, and `notes`: connection examples and attachment guidance.

A client configuration that supports remote Streamable HTTP servers can use:

```json
{
  "mcpServers": {
    "aceswarm-browser": {
      "url": "http://127.0.0.1:28792/mcp"
    }
  }
}
```

Client configuration formats vary. Set the transport to Streamable HTTP when
the client asks for it. The MCP endpoint supports POST requests and requires the
usual MCP `Accept: application/json, text/event-stream` header; use an MCP client
to handle initialization and protocol negotiation.

The CDP port is allocated by Chromium on each launch. ACEswarm logs both
endpoints and writes discovery metadata to:

```text
~/ACEswarm_ws/state/agent-connection.json
```

For a custom workspace, use `$ACESWARM_WS_ROOT/state/agent-connection.json`.
The file is removed on normal shutdown. After a forced kill it may be stale;
connect to the live MCP server to obtain the current connection.

Override the MCP port when it is occupied (startup otherwise fails):

```bash
ACESWARM_MCP_PORT=29792 ./ACEswarm-x86_64.AppImage
```

Use `ACESWARM_MCP_PORT=0` to allocate a random port and discover it from the file.
Ports must be integers between 0 and 65535.

## Attach to the existing desktop

Use the `cdpEndpoint` returned by the tool:

```javascript
const { chromium } = require('playwright');
const browser = await chromium.connectOverCDP(connection.cdpEndpoint);
try {
  const pages = browser.contexts().flatMap(context => context.pages());
  const desktop = pages.find(page => page.url().endsWith('/shell.html'));
  await desktop.locator('#applications-button').click();
} finally {
  await browser.close();
}
```

`browser.close()` on this attached Playwright browser disconnects the client.
Reuse the existing pages and contexts. Closing user pages or sending CDP
`Browser.close` would close the user's UI or browser. CDP provides renderer
automation, not Electron main-process APIs. Webviews may be separate targets;
enumerate pages and frames to locate the desired application.

The CDP and MCP listeners bind to loopback and provide local desktop control
without authentication. Any process on the same machine able to reach them can
control the UI and access its session data. The MCP server rejects browser
Origin headers and unexpected Host headers. Keep these endpoints local.

## Verification

```bash
npm test
npm run test:agent
```

The live test requires the development Python environment, built frontends,
Caddy, and a graphical display (or `xvfb-run`). It launches an isolated Electron
profile and workspace, obtains discovery through a real MCP SDK client,
interacts with the existing desktop through CDP, reconnects, and checks shutdown.
