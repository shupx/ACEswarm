# ACEswarm

ACEswarm 是面向无人机和机器人集群的地面端工作台。

## 下载

从发布地址下载 Linux x86_64 版本：

[下载 ACEswarm AppImage](https://download.example.com/aceswarm/latest/ACEswarm-x86_64.AppImage)

> 实际发布时，请将上面的地址替换为正式下载地址。

## 运行

下载完成后，在终端执行：

```bash
chmod +x ACEswarm-x86_64.AppImage
./ACEswarm-x86_64.AppImage
```

也可以在文件管理器中右键打开文件属性，勾选“允许作为程序执行”，然后双击运行。

ACEswarm 自带运行所需的：

- Python 运行环境；
- AivudaOS；
- AivudaAppStore；
- Caddy 本地应用网关；
- ACEswarm 预置应用包。

用户不需要另外安装 Python、pip、FastAPI、Uvicorn、AivudaOS、AivudaAppStore 或 Caddy。

首次启动时，ACEswarm 会自动：

1. 启动本地 AivudaOS 和 AivudaAppStore；
2. 将预置应用发布到本地应用商店；
3. 根据内置配置导出文件安装应用；
4. 打开 ACEswarm 工作台。

首次初始化可能需要一些时间，请不要重复启动多个 ACEswarm 实例。

## 用户数据目录

默认工作目录为：

```text
~/ACEswarm_ws/
```

主要内容：

```text
~/ACEswarm_ws/
├── services/
│   ├── aivudaos/          # 本地 AivudaOS 工作目录、应用和数据库
│   └── aivudaappstore/    # 本地 AppStore 数据库和应用包
├── projects/              # ACEswarm 项目
├── experiments/           # 实验数据
├── logs/                  # ACEswarm、AivudaOS、AppStore、Gateway 日志
└── state/                 # ACEswarm 初始化状态
```

程序安装包中的运行资源是只读的，用户数据不会写入 AppImage 内部。

如需指定其他工作目录，可以设置：

```bash
ACESWARM_WS_ROOT=/path/to/ACEswarm_ws ./ACEswarm-x86_64.AppImage
```

## 卸载

ACEswarm 使用 AppImage，不需要传统安装程序。卸载时只需要删除下载的 AppImage 文件：

```bash
rm ACEswarm-x86_64.AppImage
```

删除 AppImage **不会删除用户数据**。如需同时清理所有 ACEswarm 数据，请在确认不再需要项目、实验、日志和已安装应用后执行：

```bash
rm -rf ~/ACEswarm_ws
```

这个删除操作不可恢复，请先备份重要数据。

## 常见问题

### 双击没有反应

请先赋予执行权限：

```bash
chmod +x ACEswarm-x86_64.AppImage
```

### 如何查看日志

```text
~/ACEswarm_ws/logs/
```

其中包括：

```text
aceswarm.log
aivudaos.log
aivudaappstore.log
gateway.log
```

具体文件是否生成取决于启动阶段和运行版本。

### 如何恢复首次初始化

关闭 ACEswarm 后，备份并删除：

```text
~/ACEswarm_ws/state/
```

然后重新启动 ACEswarm。不要直接删除整个 workspace，除非确认不再需要其中的项目、实验和应用数据。

## 开发者文档

开发、构建、架构和调试文档位于：

- [`docs_dev/`](docs_dev/)
