# MCWSLoader Native App

独立版 Flutter 原生 GUI，内置 Node 24 LTS 服务端。界面不再使用 WebView，也不启动 WebUI 页面服务器。

Standalone native Flutter GUI with an embedded Node 24 LTS server. It no longer uses WebView or starts a WebUI page server.

## 平台 / Platforms

- Android APK arm64
- Windows x64
- Linux x64
- macOS arm64

## 默认行为 / Default behavior

- 本机 API 监听 `127.0.0.1:50100`
- 默认模式为 `gui`
- 默认不启动 WebSocket
- 不显示登录页，不使用密码
- 不启动 Vue WebUI 静态服务
- WebSocket 在仪表盘手动启动
- 更新和进程控制入口在独立版中隐藏

- Local API listens on `127.0.0.1:50100`.
- Default mode is `gui`.
- WebSocket is off by default.
- There is no login screen or password.
- The Vue WebUI static server is not started.
- WebSocket is started manually from the dashboard.
- Update and process-control entries are hidden in standalone builds.

## 原生界面 / Native UI

- 仪表盘
- 客户端管理
- 命令执行
- 消息
- 模组
- 应用日志
- 设置

The native UI includes dashboard, clients, commands, chat, Mods, logs and settings.

## Android 后台 / Android background

- Node 运行在独立的 `:node` 进程
- 使用前台服务保持运行
- 支持启动时自启动
- 设置页可打开电池优化豁免
- Node 堆上限为 128 MB

- Node runs in a separate `:node` process.
- A foreground service keeps it alive.
- Boot autostart is supported.
- Battery optimization settings are available from Settings.
- The Node heap is capped at 128 MB.

## 构建 / Build

GitHub Actions:

```text
.github/workflows/app-build.yml
```

产物 / Artifacts：

- `MCWSLoader-<tag>-arm64.apk`
- `MCWSLoader-<tag>-windows-x64.zip`
- `MCWSLoader-<tag>-linux-x64.tar.gz`
- `MCWSLoader-<tag>-macos.zip`

本地构建 / Local build：

```bash
npm ci
cd web/frontend && npm ci && npm run build && cd ../..

node scripts/build-standalone.mjs --target android
bash scripts/prepare-flutter-app.sh android

# desktop / macOS
node scripts/build-standalone.mjs --target desktop
bash scripts/prepare-flutter-app.sh windows
bash scripts/prepare-flutter-app.sh linux
bash scripts/prepare-flutter-app.sh macos
```

## 运行依赖 / Runtime requirements

- Android 7 以上
- Windows 10 1809 以上
- Linux 需要 GTK 3
- macOS 11 以上
- macOS 首次运行如被 Gatekeeper 阻止，请在系统设置中允许

Android 7 or newer. Windows 10 1809 or newer. Linux needs GTK 3. macOS 11 or newer.

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
