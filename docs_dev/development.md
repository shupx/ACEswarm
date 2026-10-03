# 开发环境与启动

## 目录关系

当前工作区：

```text
/home/spx/spx_ws/ACE/
├── ACEswarm/
├── aivudaOS/
├── aivudaAppStore/
├── aivuda-shell/
└── prepkg/
```

ACEswarm 不直接导入 AivudaOS 或 AivudaAppStore 的私有 Python 模块，也不读写它们的数据库。开发模式通过 HTTP/ASGI 服务访问两个独立包。

## 前置条件

开发阶段需要：

- Node.js/npm；
- 一个包含 AivudaOS 和 AppStore 依赖的 Python 环境；
- 可执行的 Caddy；
- AivudaOS 和 AivudaAppStore 前端已构建。

构建两个独立前端：

```bash
cd ../aivudaOS/aivudaos/resources/ui
npm ci --include=dev
npm run build

cd ../../../../aivudaAppStore/aivudaappstore/resources/ui
npm ci --include=dev
npm run build
```

## 启动 ACEswarm 开发模式

回到 ACEswarm：

```bash
cd /home/spx/spx_ws/ACE/ACEswarm
npm ci --include=dev
```

显式指定 Python、Caddy 和两个源码目录：

```bash
ACESWARM_PYTHON=/absolute/path/to/python3 \
ACESWARM_CADDY=/absolute/path/to/caddy \
ACESWARM_OS_ROOT=/home/spx/spx_ws/ACE/aivudaOS \
ACESWARM_STORE_ROOT=/home/spx/spx_ws/ACE/aivudaAppStore \
npm start
```

如果已经运行过 `npm run bundle:runtime`，开发启动默认会优先使用：

```text
resources/python-runtime/bin/python3
resources/app-gateway/caddy
```

仍然可以通过 `ACESWARM_PYTHON` 和 `ACESWARM_CADDY` 覆盖。

## 本地服务

开发启动时 ACEswarm 直接运行：

```text
AivudaOS FastAPI/Uvicorn
AivudaAppStore FastAPI/Uvicorn
ACEswarm Caddy App Gateway
```

三个服务均使用 `127.0.0.1` 动态端口，不调用：

```text
AivudaOS install
AivudaAppStore install
systemd
Avahi
80/443
```

## 测试

```bash
npm test
npm run check
npm run bundle:verify
npm run smoke
```

AivudaOS 测试：

```bash
cd ../aivudaOS
python3 -m unittest discover -s tests -p 'test*.py' -v
```

如果需要测试打包资源：

```bash
cd /home/spx/spx_ws/ACE/ACEswarm
ACESWARM_RESOURCES=$PWD/dist/linux-unpacked/resources npm run smoke
```
