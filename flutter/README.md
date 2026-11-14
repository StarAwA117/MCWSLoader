# MCWSLoader Desktop / Android App (Flutter)

一个极薄的 Flutter 原生壳：**直接加载现有 WebUI（Vue）**，不重写页面。

使用 `flutter_inappwebview`，一套 Dart 代码覆盖：

- Android（系统 WebView，支持 `<input type="file">`，可用于 Mod 导入）
- Windows（WebView2）
- 可选 iOS / macOS

Flutter 只负责：服务器地址、WebView、进度、错误重试、返回键。WebUI 更新后 App 自动获得新功能，无需重新发版。

## 目录说明

```
flutter/
├── pubspec.yaml
├── analysis_options.yaml
└── lib/
    ├── main.dart              # App 入口
    ├── server_setup_page.dart # 服务器地址输入
    ├── server_store.dart      # 只保存服务器 URL（不保存密码）
    ├── server_url.dart        # URL 规范化（补 http:// 和 50005 端口）
    └── webui_page.dart        # InAppWebView + 进度 + 错误重试 + 返回键
```

## 环境要求

- Flutter **3.32+** / Dart **3.8+**（`flutter_inappwebview` 6.x 要求）
- Android 构建：Android SDK
- Windows 构建：Windows 10/11 + Visual Studio 2022（Desktop development with C++）+ WebView2 Runtime
- 仓库只提交 Dart 源码与 `pubspec.yaml`，**不提交各平台生成目录**，避免 Flutter 版本差异导致构建失败

## 生成平台目录

推荐生成到新目录，避免覆盖已写好的 `lib/`：

```bash
cd flutter
flutter create --platforms=android,windows --org com.mcwsloader --project-name mcws_webui app
cp -r lib app/lib
cp pubspec.yaml app/pubspec.yaml
cp analysis_options.yaml app/analysis_options.yaml
cd app
flutter pub get
```

如果只需要 Android：

```bash
flutter create --platforms=android --org com.mcwsloader --project-name mcws_webui app
```

## Android

编辑 `android/app/src/main/AndroidManifest.xml`：

```xml
<manifest ...>
    <uses-permission android:name="android.permission.INTERNET" />

    <application
        android:label="MCWSLoader"
        android:usesCleartextTraffic="true"
        ...>
```

`usesCleartextTraffic="true"` 是为了允许 `http://局域网IP:50005`。
如果服务器配置了 HTTPS，建议删掉这一行。

构建：

```bash
flutter build apk --release
# 产物：build/app/outputs/flutter-apk/app-release.apk
```

安装：

```bash
adb install -r build/app/outputs/flutter-apk/app-release.apk
```

## Windows

Windows 不需要改 AndroidManifest；需要安装 **WebView2 Runtime**
（Windows 11 通常自带，Windows 10 可能需要手动安装）。

```bash
flutter build windows --release
# 产物目录：build/windows/x64/runner/Release/
#   mcws_webui.exe
#   flutter_windows.dll
#   data/
#   flutter_inappwebview_windows_plugin.dll
```

把整个 `Release/` 目录分发即可；也可以再用 Inno Setup / MSIX 打成安装包。
Flutter 默认不是单文件 exe，需要连同 DLL 和 `data/` 一起分发。

## 连接方式

| 场景 | 地址 |
|---|---|
| MCWSLoader 与手机在同一台设备（Termux） | `http://127.0.0.1:50005` |
| MCWSLoader 在电脑上，手机同一局域网 | `http://<电脑局域网IP>:50005` |
| Windows 与 MCWSLoader 同一台电脑 | `http://127.0.0.1:50005` |
| Windows 连接另一台机器 | `http://<服务器IP>:50005` |

App 只保存服务器地址，不保存密码或 token；登录仍由 WebUI 页面处理。

## 安全说明

- **HTTP 是明文传输**：登录密码和会话 token 会经过局域网。请只在可信网络使用，
  或通过 HTTPS 反向代理 / WireGuard / Tailscale 访问。
- 不建议把 WebSocket 端口 8080 暴露到公网；App 只使用 WebUI 的 HTTP 端口。
- WebUI 已启用 CSP、登录限流、同源 CORS、常量时间密码比较、客户端批准等防护。
- 原版 MCBE `/connect` 无法携带 token/header，因此 WebSocket 侧使用
  “IP 白名单 + 非本机连接人工批准”作为替代（见根目录 README）。

## 已知限制

- 会话 token 存在 WebView 的 `sessionStorage` 中，App 进程被杀后可能需要重新登录。
- Windows 端依赖 WebView2 Runtime；未安装时 WebView 无法初始化。
- 目前只针对 Android / Windows；如需 iOS，`flutter create --platforms=android,ios`
  后在 `Info.plist` 为局域网 HTTP 增加 ATS 例外。

## 后续可选

- 服务器地址历史记录 / 局域网自动发现
- 生物识别解锁（本地锁，不替代 WebUI 密码）
- 系统托盘（Windows）与后台保活
