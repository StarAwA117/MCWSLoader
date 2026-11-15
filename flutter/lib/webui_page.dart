import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_all/webview_all.dart';

class WebUiPage extends StatefulWidget {
  const WebUiPage({super.key, required this.baseUrl, this.token});

  final String baseUrl;
  final String? token;

  @override
  State<WebUiPage> createState() => _WebUiPageState();
}

class _WebUiPageState extends State<WebUiPage> {
  late final WebViewController _controller;
  bool _tokenInjected = false;
  bool _pageReady = false;
  String? _loadError;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onPageFinished: _onPageFinished,
          onWebResourceError: (error) {
            if (!_pageReady && mounted) {
              setState(() => _loadError = error.description);
            }
          },
        ),
      )
      ..loadRequest(Uri.parse(widget.baseUrl));
  }

  Future<void> _onPageFinished(String url) async {
    final token = widget.token;
    if (token != null && !_tokenInjected && Uri.tryParse(url)?.path == '/login') {
      _tokenInjected = true;
      await _controller.runJavaScript(
        "sessionStorage.setItem('auth_token', ${_jsonString(token)}); location.replace('/');",
      );
      return;
    }
    if (!_pageReady && mounted) {
      setState(() {
        _pageReady = true;
        _loadError = null;
      });
    }
  }

  String _jsonString(String value) => '"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"';

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        if (!Platform.isAndroid) return;
        if (await _controller.canGoBack()) {
          await _controller.goBack();
        } else {
          await SystemNavigator.pop();
        }
      },
      child: Scaffold(
        body: Stack(
          children: [
            WebViewWidget(controller: _controller),
            if (!_pageReady)
              Container(
                color: const Color(0xFFF4F8FF),
                alignment: Alignment.center,
                child: _loadError == null
                    ? const CircularProgressIndicator(strokeWidth: 2.4)
                    : Padding(
                        padding: const EdgeInsets.all(24),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              _loadError!,
                              textAlign: TextAlign.center,
                              style: const TextStyle(color: Color(0xFFDC2626), fontSize: 13),
                            ),
                            const SizedBox(height: 16),
                            FilledButton(
                              onPressed: () {
                                setState(() {
                                  _loadError = null;
                                  _pageReady = false;
                                });
                                _controller.loadRequest(Uri.parse(widget.baseUrl));
                              },
                              child: const Text('重试'),
                            ),
                          ],
                        ),
                      ),
              ),
          ],
        ),
      ),
    );
  }
}
