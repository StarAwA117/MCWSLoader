import 'package:flutter/material.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';

import 'server_url.dart';

/// Flutter 原生壳：直接加载现有 WebUI（Vue）。
///
/// 使用 flutter_inappwebview 而不是 webview_flutter，原因：
/// - Android 支持 <input type="file">（Mod 导入）
/// - Windows 通过 WebView2 实现，与 Android 共用同一套 Dart 代码
class WebUiPage extends StatefulWidget {
  const WebUiPage({super.key, required this.startUri});

  final Uri startUri;

  @override
  State<WebUiPage> createState() => _WebUiPageState();
}

class _WebUiPageState extends State<WebUiPage> {
  InAppWebViewController? _controller;
  double _progress = 0;
  bool _loading = true;
  String? _error;

  WebUri get _startUrl => WebUri(widget.startUri.toString());

  Future<void> _reload() async {
    setState(() {
      _error = null;
      _loading = true;
    });
    await _controller?.loadUrl(urlRequest: URLRequest(url: _startUrl));
  }

  Future<void> _handleBack() async {
    final controller = _controller;
    if (controller != null && await controller.canGoBack()) {
      await controller.goBack();
      return;
    }
    if (mounted) Navigator.of(context).pop();
  }

  void _markLoaded() {
    if (!mounted) return;
    setState(() {
      _loading = false;
      _progress = 1;
    });
  }

  void _markStarted() {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
  }

  void _markFailed(String message) {
    if (!mounted) return;
    setState(() {
      _loading = false;
      _error = message;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        await _handleBack();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(displayServerUrl(widget.startUri), overflow: TextOverflow.ellipsis),
          actions: [
            IconButton(
              tooltip: '刷新',
              onPressed: _reload,
              icon: const Icon(Icons.refresh_rounded),
            ),
            IconButton(
              tooltip: '更换服务器',
              onPressed: () => Navigator.of(context).pop(),
              icon: const Icon(Icons.dns_rounded),
            ),
          ],
        ),
        body: Stack(
          children: [
            InAppWebView(
              initialUrlRequest: URLRequest(url: _startUrl),
              initialSettings: InAppWebViewSettings(
                javaScriptEnabled: true,
                domStorageEnabled: true,
                supportZoom: false,
                mediaPlaybackRequiresUserGesture: false,
                disableDefaultErrorPage: true,
              ),
              onWebViewCreated: (controller) {
                _controller = controller;
              },
              onLoadStart: (_, __) => _markStarted(),
              onLoadStop: (_, __) => _markLoaded(),
              onProgressChanged: (_, progress) {
                if (!mounted) return;
                setState(() => _progress = (progress / 100).clamp(0, 1).toDouble());
              },
              onReceivedError: (_, request, error) {
                // 子资源失败不覆盖整页
                if (request.isForMainFrame == false) return;
                _markFailed(error.description);
              },
            ),
            if (_loading)
              const Align(
                alignment: Alignment.topCenter,
                child: LinearProgressIndicator(minHeight: 2),
              ),
            if (_error != null)
              Positioned.fill(
                child: ColoredBox(
                  color: theme.colorScheme.surface,
                  child: Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.cloud_off_rounded, size: 56, color: theme.colorScheme.error),
                          const SizedBox(height: 12),
                          Text(
                            '无法连接 WebUI',
                            style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            _error!,
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                          const SizedBox(height: 20),
                          FilledButton.icon(
                            onPressed: _reload,
                            icon: const Icon(Icons.refresh_rounded),
                            label: const Text('重试'),
                          ),
                          TextButton(
                            onPressed: () => Navigator.of(context).pop(),
                            child: const Text('更换服务器地址'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            if (_loading && _progress > 0 && _progress < 1)
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: LinearProgressIndicator(value: _progress, minHeight: 2),
              ),
          ],
        ),
      ),
    );
  }
}
