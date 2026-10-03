# 配置导出与预置应用初始化

## 唯一初始化描述文件

当前使用：

```text
resources/seed-apps/aceswarm-config-export.json
```

它保留 AivudaOS 原生配置导出格式，并增加顶层 `aceswarm.packages` 扩展：

```json
{
  "format_version": 1,
  "aceswarm": {
    "packages": [
      {
        "artifact": "packages/app-example.zip",
        "sha256": "..."
      }
    ]
  },
  "payload": {
    "system_parameters": {},
    "apps": [
      {
        "app_id": "app-example",
        "version": "1.0.0",
        "parameters": {},
        "autostart": false,
        "running": false
      }
    ]
  }
}
```

AivudaOS 忽略未知的 `aceswarm` 顶层字段；ACEswarm 使用它定位和校验包。

## 初始化流程

```text
读取 aceswarm-config-export.json
    ↓
校验配置格式
    ↓
校验 packages 路径和 SHA-256
    ↓
通过 AppStore API 解析每个 manifest.yaml
    ↓
校验 app_id/version 与 payload.apps
    ↓
发布缺失应用版本到本地 AppStore
    ↓
调用 AivudaOS /aivuda_os/api/config/import
    ↓
AivudaOS 从本地 AppStore 下载并安装应用
    ↓
AivudaOS 恢复参数和 autostart
```

## 设计原则

- ACEswarm 不解释应用参数；
- ACEswarm 不直接安装应用到 AivudaOS；
- ACEswarm 不直接访问任何数据库；
- AivudaOS 负责导入、安装、参数合并和 autostart；
- `running` 默认不恢复；
- `avahi_hostname` 不影响地面端 embedded mode；
- 预置包必须在 AppStore 发布后，AivudaOS 才能自动安装。

## 预置包来源

当前预置包来自：

```text
/home/spx/spx_ws/ACE/prepkg/
```

新增或替换包时：

1. 将包放入 `resources/seed-apps/packages/`；
2. 读取包内 `manifest.yaml`；
3. 更新 `payload.apps`；
4. 更新 `aceswarm.packages`；
5. 使用 `sha256sum` 更新 SHA-256；
6. 执行 `npm test`、`npm run bundle:verify` 和 smoke test；
7. 重新构建 AppImage。
