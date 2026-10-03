# 本地运行时与工作目录

## 用户数据

当前实现默认使用：

```text
~/ACEswarm_ws/
```

可通过 `ACESWARM_WS_ROOT` 覆盖。

```text
ACEswarm_ws/
├── services/
│   ├── aivudaos/
│   │   ├── apps/
│   │   ├── config/
│   │   ├── data/
│   │   └── .tools/caddy/
│   └── aivudaappstore/
│       ├── data/repo.db
│       ├── data/files/
│       ├── data/tmp/
│       └── config/
├── projects/
├── experiments/
├── logs/
└── state/
```

## 本地端口

每次启动动态分配：

```text
AivudaOS Uvicorn       127.0.0.1:<dynamic>
AivudaAppStore Uvicorn 127.0.0.1:<dynamic>
Caddy Gateway          127.0.0.1:<dynamic>
Caddy admin            127.0.0.1:<dynamic>
```

不占用 80/443，不依赖 Avahi。

## AivudaOS embedded mode

ACEswarm 为本地 AivudaOS 注入：

```text
AIVUDAOS_EMBEDDED_MODE=1
AIVUDAOS_WS_ROOT=~/ACEswarm_ws/services/aivudaos
```

该模式跳过本地 Avahi/HTTPS hostname 联动，但保留应用 UI 和 Caddy 路由管理。

## Caddy Gateway

ACEswarm 生成：

```text
~/ACEswarm_ws/services/aivudaos/config/Caddyfile
```

Caddy 的作用是：

- 代理 AivudaOS API；
- 提供 AivudaOS 主 UI；
- 提供已安装应用 UI；
- 加载 AivudaOS 生成的应用路由；
- 支持应用 Caddy route/WebSocket 场景。

Caddy 二进制由 ACEswarm 管理，独立部署脚本不会被调用。
