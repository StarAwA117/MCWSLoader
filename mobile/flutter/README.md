# MCWSLoader Android App (Flutter WebView)

一个极薄的 Flutter 原生壳：**直接加载现有 WebUI（Vue）**，不重写页面。

这样做的好处：

- 不需要把 10 个 Vue 页面 / 2.8k 行 UI 重写成 Dart
- WebUI 更新后 App 自动获得新功能，无需重新发版
- 保留现有的登录、Mod 管理、日志、命令、设置等全部功能
- Flutter 只负责：服务器地址、WebView、进度、错误重试、返回键

## 目录说明

```
mobile/flutter/
├── pubspec.yaml
├── analysis_options.yaml
└── lib/
    ├── main.dart              # App 入口
    ├── server_setup_page.dart # 服务器地址输入
    ├── server_store.dart      # 只保存服务器 URL（不保存密码）
    ├── server_url.dart        # URL 规范化（补 http:// 和 50005 端口）
    └── webui_page.dart        # WebView + 进度 + 错误重试 + 返回键
```

## 构建 APK

需要 Flutter 3.22+ 与 Android SDK。当前仓库只包含 Dart 源码，没有提交
`android/` 平台目录（避免 Flutter 版本差异导致构建失败），首次构建时生成：

```bash
# 1. 生成 Android 平台目录（推荐生成到新目录，避免覆盖已写好的 lib/）
cd mobile
flutter create --platforms=android --org com.mcwsloader --project-name mcws_webui app

# 2. 把本目录的源码复制进去
cp -r flutter/lib app/lib
cp flutter/pubspec.yaml app/pubspec.yaml
cp flutter/analysis_options.yaml app/analysis_options.yaml

cd app
flutter pub get
```

然后编辑 `android/app/src/main/AndroidManifest.xml`：

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

安装到手机：

```bash
adb install -r build/app/outputs/flutter-apk/app-release.apk
```

## 连接方式

| 场景 | 地址 |
|---|---|
| MCWSLoader 与手机在同一台设备（Termux） | `http://127.0.0.1:50005` |
| MCWSLoader 在电脑上，手机同一局域网 | `http://<电脑局域网IP>:50005` |

WebUI 端需要监听局域网（默认 `web.port` 已监听 `0.0.0.0`）：

```json
{
	"web": { "port": 50005 }
}
```

登录密码仍然由 WebUI 页面处理；App 只保存服务器地址，不保存密码或 token。

## 安全说明

- **HTTP 是明文传输**：登录密码和会话 token 会经过局域网。请只在可信网络使用，
  或通过 HTTPS 反向代理 / WireGuard / Tailscale 访问。
- 不建议把 WebSocket 端口 8080 暴露到公网；App 只使用 WebUI 的 HTTP 端口。
- WebUI 已启用 CSP、登录限流、同源 CORS、常量时间密码比较等防护。

## 已知限制

- **Mod 导入的文件选择器**：`webview_flutter` 对 `<input type="file">` 的 Android
  file chooser 支持有限，App 内可能无法选择 `.wsmod` / `.zip`。需要导入 Mod 时
  请先用手机浏览器打开 WebUI，或改用 `flutter_inappwebview`（它提供文件选择器）。
- 会话 token 存在 WebView 的 `sessionStorage` 中，App 进程被杀后可能需要重新登录。
- 目前只针对 Android；如需 iOS，`flutter create --platforms=android,ios` 后
  在 `Info.plist` 为局域网 HTTP 增加 ATS 例外。

## 后续可选

- 用 `flutter_inappwebview` 替换 `webview_flutter`，补齐文件上传/下载
- 增加服务器地址历史记录 / 局域网自动发现
- 增加生物识别解锁（本地锁，不替代 WebUI 密码）
