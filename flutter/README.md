# MCWSLoader App

独立版使用 Flutter 原生外壳承载 Vue WebUI，并内置 Node 24 LTS 服务端。WebUI 从 Flutter assets 以 `file://` 加载，不启动静态页面服务器；本地 API 仍监听 `127.0.0.1:50100`。

The standalone app hosts the shared Vue WebUI in a Flutter WebView shell with an embedded Node 24 LTS server. The WebUI is loaded from Flutter assets via `file://`; no static page server is started. The local API still listens on `127.0.0.1:50100`.

## 平台 / Platforms

- Android arm64
- Windows x64
- Linux x64
- macOS arm64

## 默认行为 / Default behavior

- WebUI 由 Flutter WebView 从本地 assets 渲染
- 不启动 WebUI 静态服务器
- 默认不启动 WebSocket
- 默认模式为 `gui`
- 不需要登录密码
- 本地 API 只监听 `127.0.0.1:50100`
- 仪表盘手动启动 WebSocket

- The WebUI is rendered from local Flutter assets in a WebView.
- No static WebUI server is started.
- WebSocket is off by default.
- Default mode is `gui`.
- No login password is required.
- The local API listens only on `127.0.0.1:50100`.
- Start WebSocket manually from the dashboard.

## 页面 / Pages

WebUI 与普通 WebUI 共用同一套页面：

- 仪表盘
- 客户端
- 命令
- 消息
- 模组
- 日志
- 设置
- 关于

The standalone build uses the same pages as the normal WebUI: dashboard, clients, commands, chat, Mods, logs, settings and about.

## Android 后台 / Android background

- Node 运行在独立的 `:node` 进程
- 前台服务保持 Node 运行
- 支持开机自启动
- 设置页可打开电池优化豁免
- Node 堆上限为 128 MB
- 默认不加载 libnode 到 Flutter UI 进程

- Node runs in a separate `:node` process.
- A foreground service keeps it alive.
- Boot autostart is supported.
- Battery optimization settings are available from Settings.
- The Node heap is capped at 128 MB.
- libnode is not loaded into the Flutter UI process.

## 构建 / Build

```bash
npm ci
cd web/frontend
npm ci
VITE_API_BASE=http://127.0.0.1:50100 npm run build -- --mode standalone
cd ../..

node scripts/build-standalone.mjs --target android
bash scripts/prepare-flutter-app.sh android
```

桌面端 / Desktop:

```bash
node scripts/build-standalone.mjs --target desktop
bash scripts/prepare-flutter-app.sh windows   # 或 linux / macos
```

`build-standalone.mjs` 会把 `web/frontend/dist-standalone` 复制到 `flutter/assets/webui`。

`build-standalone.mjs` copies `web/frontend/dist-standalone` into `flutter/assets/webui`.

## 运行依赖 / Runtime requirements

- Android 7 以上
- Windows 10 1809 以上，需要 WebView2 Runtime
- Linux 需要 GTK 3 和 WebKitGTK 4.1
- macOS 11 以上
- macOS 首次运行如被 Gatekeeper 阻止，请在系统设置中允许

Android 7 or newer. Windows 10 1809 or newer with WebView2 Runtime. Linux needs GTK 3 and WebKitGTK 4.1. macOS 11 or newer.

## 数据目录 / Data

- Android: 应用私有目录 `files/nodejs-project`
- Windows/Linux/macOS: 应用支持目录下的 `server/`

Android uses the private app directory. Desktop and macOS use `server/` under application support.

## 限制 / Limitations

- 独立版只监听本机 API，不支持远程 WebUI。
- Android Mod 导入、外部命令和 npm 依赖安装受系统限制。
- 仅运行可信来源的 Mod 和脚本。

- Standalone builds expose only a local API, not a remote WebUI.
- Android Mod imports, shell commands and npm dependency installs are limited by the system.
- Only run trusted Mods and scripts.
