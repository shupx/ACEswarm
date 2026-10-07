# ACEswarm Skills

Skills for developing ACEswarm apps and operating the desktop, WebViews, AivudaOS and AppStore. Capabilities are discovered from live tool schemas, pages and service state, without assuming specific apps, accounts or deployment addresses.

Each skill has its own directory containing a `SKILL.md` with `name` and `description` in its YAML frontmatter. Goose's Skills extension can discover these directories directly.

`SKILL.md` contains the capability overview and essential rules. Detailed workflows
live in each skill's `references/` directory; read only the references needed for
the current task. Copy the entire skill directory when installing.

`aceswarm-app-development` works without an ACEswarm/AivudaOS/AppStore source
checkout. Its bundled references describe the package and runtime contract;
examples and live compatibility information are discovered through MCP when
available.

| Skill | Description |
|-------|------|
| [`aceswarm-app-development`](aceswarm-skills/aceswarm-app-development/SKILL.md) | App package development, manifest and runtime configuration, Docker helpers, built-in UI and Panel Hub integration, packaging and MCP verification |
| [`aceswarm-overview`](aceswarm-skills/aceswarm-overview/SKILL.md) | Platform and tool roles, Shell/WebView snapshots and navigation, app discovery, remote devices, window layouts, recording and desktop settings |
| [`aceswarm-appstore-mcp`](aceswarm-skills/aceswarm-appstore-mcp/SKILL.md) | Store queries and downloads, authentication, publishing and versions, members and accounts, data import/export |
| [`aceswarm-aivudaos-mcp`](aceswarm-skills/aceswarm-aivudaos-mcp/SKILL.md) | App installation, upgrades and lifecycle, logs, configuration and magnets, system management, asynchronous operations and interactive input |

## Installation

From this directory, copy the desired skills into Goose's global skills directory:

```bash
mkdir -p ~/.agents/skills
cp -r aceswarm-skills/aceswarm-app-development aceswarm-skills/aceswarm-overview aceswarm-skills/aceswarm-appstore-mcp aceswarm-skills/aceswarm-aivudaos-mcp ~/.agents/skills/
```

Alternatively, place them in `<project>/.agents/skills/` for project-specific use.

## Conventions

- Supply credentials (usernames, passwords and tokens) at runtime; do not store them in files or skills.
- Identify the target instance/device and scope. Follow existing user authorization without requesting repeated confirmation for authorized actions.
- MCP names are client conventions. Discover addresses, tools, apps, versions and pages from the current connections and live state.
