import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'server_url.dart';

/// Flutter 原生壳：直接加载现有 WebUI（Vue）。
/// 这样不需要重写页面，Android 端只负责 WebView、进度、错误和返回键。
class WebUiPage extends StatefulWidget {
  const WebUiPage({super.key, required this.startUri});

  final Uri startUri;

  @override
  State<WebUiPage> createState() => _WebUiPageState();
}

class _WebUiPageState extends State<WebUiPage> {
  late final WebViewController _controller;
  double _progress = 0;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.white)
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (value) {
            if (!mounted) return;
            setState(() => _progress = (value / 100).clamp(0, 1).toDouble());
          },
          onPageStarted: (_) {
            if (!mounted) return;
            setState(() {
              _loading = true;
              _error = null;
            });
          },
          onPageFinished: (_) {
            if (!mounted) return;
            setState(() {
              _loading = false;
              _progress = 1;
            });
          },
          onWebResourceError: (error) {
            // 子资源失败不覆盖整页
            if (error.isForMainFrame == false) return;
            if (!mounted) return;
            setState(() {
              _loading = false;
              _error = error.description;
            });
          },
        ),
      )
      ..loadRequest(widget.startUri);
  }

  Future<void> _reload() async {
    setState(() {
      _error = null;
      _loading = true;
    });
    await _controller.loadRequest(widget.startUri);
  }

  void _backToSetup() {
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _controller.canGoBack()) {
          await _controller.goBack();
          return;
        }
        if (mounted) Navigator.of(context).pop();
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
              onPressed: _backToSetup,
              icon: const Icon(Icons.dns_rounded),
            ),
          ],
        ),
        body: Stack(
          children: [
            WebViewWidget(controller: _controller),
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
                            onPressed: _backToSetup,
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
