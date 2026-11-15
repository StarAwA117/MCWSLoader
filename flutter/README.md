# MCWSLoader Standalone App

独立版 Flutter GUI，内置 Node 服务端，默认只启动 WebUI，不自动启动 WebSocket。

Standalone Flutter GUI with an embedded Node server. It starts the WebUI only; WebSocket must be started from the dashboard.

## 平台 / Platforms

- Android APK
- Windows x64
- Linux x64

Android 通过 `node_flutter` 和 nodejs-mobile 运行 Node 18；Windows/Linux 使用随包附带的 Node 二进制文件。
Android uses `node_flutter` and nodejs-mobile for Node 18. Windows and Linux use a bundled Node binary.

## 默认行为 / Default behavior

- 本地服务监听 `127.0.0.1:50100`
- 默认模式为 `webui`
- 打开 App 不会自动启动 WebSocket
- WebSocket 由仪表盘上的服务状态卡手动启动
- 独立版隐藏服务重启、结束进程和应用内更新入口

- The local service listens on `127.0.0.1:50100`.
- The default mode is `webui`.
- Opening the app does not start WebSocket.
- WebSocket is started manually from the service status card.
- Standalone builds hide restart, kill and in-app update controls.

## 首次登录 / First login

独立版生成一个本地配置，默认密码为：

```text
mcwsloader
```

App 会尝试自动登录。修改密码后需要手动登录。

The standalone build creates a local config with this default password:

```text
mcwsloader
```

The app tries to sign in automatically. After changing the password, sign in manually.

## 构建 / Build

GitHub Actions workflow:

```text
.github/workflows/app-build.yml
```

手动运行 workflow 或推送 `v*` tag 后生成：

- `MCWSLoader-<tag>-arm64.apk`
- `MCWSLoader-<tag>-windows-x64.zip`
- `MCWSLoader-<tag>-linux-x64.tar.gz`

The workflow builds:

- `MCWSLoader-<tag>-arm64.apk`
- `MCWSLoader-<tag>-windows-x64.zip`
- `MCWSLoader-<tag>-linux-x64.tar.gz`

本地构建步骤 / Local build：

```bash
npm ci
cd web/frontend && npm ci && npm run build && cd ../..

# Android
node scripts/build-standalone.mjs --target android
bash scripts/prepare-flutter-app.sh android

# Windows / Linux desktop
node scripts/build-standalone.mjs --target desktop --node "$(command -v node)"
bash scripts/prepare-flutter-app.sh windows
# or: bash scripts/prepare-flutter-app.sh linux
```

## 运行依赖 / Runtime requirements

- Android 7 以上
- Windows 10 1809 以上，需要 WebView2 Runtime
- Linux 需要 WebKitGTK 4.1，例如 Debian/Ubuntu 的 `libwebkit2gtk-4.1-0`

Windows 10 1809 or newer with WebView2 Runtime. Linux requires WebKitGTK 4.1.

## 数据目录 / Data

- Android: App 私有目录 `files/nodejs-project`
- Windows/Linux: 用户应用支持目录下的 `server/`

Android uses the private app directory. Desktop uses the application support directory.

升级 APK 时 node_flutter 可能重新复制项目文件。测试版升级前请备份配置、Mod 和权限文件。
On APK upgrades, node_flutter may replace the project files. Back up config, Mods and permissions before upgrading a test build.

## 限制 / Limitations

- 独立版默认只监听本机，不提供远程访问。
- Android 的 Mod 导入、运行外部命令和 npm 依赖安装受 Android 环境限制。
- 内置 Node 脚本使用 VM 沙箱，但不是操作系统级隔离。
- 默认密码仅用于本地首次启动，建议登录后立即修改。

- Standalone builds listen locally and do not expose remote access.
- Mod imports, shell commands and npm dependency installs are limited on Android.
- The embedded Node sandbox is not OS-level isolation.
- Change the default password after the first login.
