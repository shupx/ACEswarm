# 项目组成与架构

## 总体关系

```text
ACEswarm Electron Workbench
├── ACEswarm 自有工作台页面
├── 本地 AivudaOS 页面
├── 本地 AivudaAppStore 页面
├── 远程机器人 AivudaOS 页面
└── 本地服务生命周期管理
    ├── AivudaOS Uvicorn
    ├── AivudaAppStore Uvicorn
    └── Caddy App Gateway
```

AivudaOS 和 AivudaAppStore 仍然是独立包。ACEswarm 负责启动和承载页面，不把它们变成 ACEswarm 的内部业务库。

## ACEswarm 目录

```text
ACEswarm/
├── electron/
│   ├── main.js                 # Electron 主进程和 IPC
│   ├── preload.js              # 安全桥接
│   ├── shell.html/js/css       # 工作台外壳
│   └── services/
│       ├── local-services.js   # Uvicorn/Caddy 启停、端口、健康检查
│       ├── runtime.js          # Python/Caddy/源码或打包资源定位
│       ├── workspace.js        # 用户工作目录
│       ├── gateway.js          # 动态 Caddyfile 和应用路由
│       ├── seed.js             # config-export bootstrap
│       ├── pages.js            # 页面注册与路由
│       └── integrity.js        # 发布资源完整性校验
├── resources/
│   └── seed-apps/
│       ├── aceswarm-config-export.json
│       └── packages/
├── scripts/
│   ├── build-python-runtime.sh
│   ├── verify-bundle.js
│   └── smoke-services.js
├── tests/
├── docs_dev/
└── package.json
```

## 页面路由

页面由 `electron/services/pages.js` 解析：

```text
settings       → 本地 AivudaOS
store          → 本地 AivudaAppStore
app:<app_id>   → ACEswarm Gateway 下的已安装应用 UI
robot:<url>    → 远程机器人 AivudaOS
home/projects/simulation/... → ACEswarm 自有页面
```

## 安全边界

- WebView 默认禁止任意导航；
- 本地页面只允许 ACEswarm 管理的 loopback origin；
- 远程机器人页面需要显式添加；
- Python 和 Caddy 路径使用绝对路径；
- seed 包必须位于 `resources/seed-apps/packages/`；
- seed 包必须通过 SHA-256 校验；
- 不直接读写 AivudaOS/AppStore SQLite 数据库。
