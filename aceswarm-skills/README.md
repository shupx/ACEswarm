# aceswarm skills

ACEswarm 操作 skills：覆盖桌面/WebView、AivudaOS 和 AppStore，按运行时工具 schema、页面和服务状态发现能力，不预设应用名单、账号或部署地址。

每个 skill 是一个独立目录，内含 `SKILL.md`（YAML frontmatter 需包含 `name` 与 `description`），可直接被 goose 的 Skills 扩展发现。

| Skill | 说明 |
|-------|------|
| [`aceswarm-overview`](aceswarm-overview/SKILL.md) | 平台与工具分工、Shell/WebView 快照和导航、应用发现、远程设备、窗口布局、录屏及桌面设置 |
| [`aceswarm-appstore-mcp`](aceswarm-appstore-mcp/SKILL.md) | 商店查询下载、认证、发布与版本管理、成员账号、数据导入导出 |
| [`aceswarm-aivudaos-mcp`](aceswarm-aivudaos-mcp/SKILL.md) | 应用安装升级与运行、日志、配置与 magnet、系统管理、异步操作和交互输入 |

## 安装

将需要的 skill 目录复制到 goose 的全局 skills 目录：

```bash
mkdir -p ~/.agents/skills
cp -r aceswarm-overview aceswarm-appstore-mcp aceswarm-aivudaos-mcp ~/.agents/skills/
```

或按项目放到 `<project>/.agents/skills/`。

## 约定

- 凭据（用户名/密码/token）一律运行时提供，不写入文件、不写入 skill。
- 先确认目标实例/设备和操作范围；按用户已有授权执行，不重复请求已授权操作的确认。
- MCP 名称是客户端约定；地址、工具、应用、版本及页面均从当前连接和运行状态发现。
