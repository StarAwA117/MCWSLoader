import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_all/webview_all.dart';

/// Displays the shared Vue WebUI from Flutter assets.
///
/// The page is loaded from file:// assets; it is not served by an HTTP static
/// server. The Node API still listens on loopback and allows the file origin.
class WebUiPage extends StatefulWidget {
  const WebUiPage({super.key});

  @override
  State<WebUiPage> createState() => _WebUiPageState();
}

class _WebUiPageState extends State<WebUiPage> {
  late final WebViewController _controller;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFFF0F7FF))
      ..addJavaScriptChannel(
        'MCWSStandalone',
        onMessageReceived: (JavaScriptMessage message) {
          if (message.message == 'requestBackgroundPermissions' && Platform.isAndroid) {
            const MethodChannel('mcws/standalone').invokeMethod<void>('requestBackgroundPermissions');
            return;
          }
          if (message.message.startsWith('{')) {
            try {
              final data = jsonDecode(message.message) as Map<String, dynamic>;
              if (data['type'] == 'theme') {
                _applyNativeTheme(data['color'] as String?, data['dark'] == true);
              }
            } catch (_) {
              // Ignore malformed bridge messages.
            }
          }
        },
      )
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (progress) {
            if (!mounted) return;
            if (progress >= 100 && _loading) setState(() => _loading = false);
          },
          onPageFinished: (_) {
            if (mounted) setState(() => _loading = false);
          },
          onWebResourceError: (error) {
            if (error.isForMainFrame != true || !mounted) return;
            setState(() {
              _loading = false;
              _error = error.description;
            });
          },
        ),
      );
    unawaited(_load());
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      // Give the inline document an HTTP loopback origin so API requests are
      // same-origin. No static page server is involved: the HTML comes from
      // the Flutter asset bundle and the Node server only handles /api/*.
      final html = await rootBundle.loadString('assets/webui/index.html');
      await _controller.loadHtmlString(html, baseUrl: 'http://127.0.0.1:50100/');
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  void _applyNativeTheme(String? colorText, bool dark) {
    final color = _parseColor(colorText) ?? const Color(0xFFF0F7FF);
    final brightness = dark ? Brightness.light : Brightness.dark;
    SystemChrome.setSystemUIOverlayStyle(
      SystemUiOverlayStyle(
        statusBarColor: color,
        statusBarIconBrightness: brightness,
        statusBarBrightness: dark ? Brightness.dark : Brightness.light,
        systemNavigationBarColor: color,
        systemNavigationBarIconBrightness: brightness,
      ),
    );
  }

  Color? _parseColor(String? value) {
    final text = value?.trim();
    if (text == null || !text.startsWith('#') || text.length != 7) return null;
    final parsed = int.tryParse(text.substring(1), radix: 16);
    return parsed == null ? null : Color(0xFF000000 | parsed);
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
        if (await _controller.canGoBack()) {
          await _controller.goBack();
          return;
        }
        await SystemNavigator.pop();
      },
      child: Scaffold(
        body: SafeArea(
          child: Stack(
            children: [
              if (_error == null)
                WebViewWidget(controller: _controller)
              else
                _ErrorView(message: _error!, onRetry: _load),
              if (_loading)
                const Positioned(
                  top: 0,
                  left: 0,
                  right: 0,
                  child: LinearProgressIndicator(minHeight: 2),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.message, required this.onRetry});

  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.web_asset_off_rounded, size: 42, color: Color(0xFF64748B)),
            const SizedBox(height: 14),
            const Text('WebUI 加载失败', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            SelectableText(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12, color: Color(0xFF64748B)),
            ),
            const SizedBox(height: 18),
            FilledButton(onPressed: onRetry, child: const Text('重试')),
          ],
        ),
      ),
    );
  }
}
