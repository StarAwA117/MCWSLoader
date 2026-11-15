import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';

import 'api.dart';
import 'local_server.dart';
import 'main_shell.dart';

class StandaloneApp extends StatefulWidget {
  const StandaloneApp({super.key});

  @override
  State<StandaloneApp> createState() => _StandaloneAppState();
}

class _StandaloneAppState extends State<StandaloneApp> with WidgetsBindingObserver {
  final LocalServer _server = LocalServer();
  String? _error;
  ApiClient? _api;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Render the native splash before starting Node so the first frame is not
    // blocked by the native runtime and foreground-service setup.
    WidgetsBinding.instance.addPostFrameCallback((_) => _boot());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _server.stop();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.detached && !Platform.isAndroid) {
      _server.stop();
    }
  }

  Future<void> _boot() async {
    setState(() {
      _error = null;
      _api = null;
    });
    try {
      await _server.start();
      if (!mounted) return;
      setState(() => _api = ApiClient(standaloneBaseUrl));
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final api = _api;
    if (api != null) return MainShell(api: api);
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 66,
                  height: 66,
                  decoration: BoxDecoration(
                    color: const Color(0xFFDBEAFE),
                    borderRadius: BorderRadius.circular(22),
                  ),
                  child: const Icon(Icons.dns_rounded, color: Color(0xFF2563EB), size: 34),
                ),
                const SizedBox(height: 20),
                const Text('MCWSLoader', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
                const SizedBox(height: 8),
                Text(
                  _error == null ? '正在启动本地服务...' : '本地服务启动失败',
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Color(0xFF64748B), fontSize: 14),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFFDC2626), fontSize: 12)),
                  const SizedBox(height: 20),
                  FilledButton(onPressed: _boot, child: const Text('重试')),
                ] else ...[
                  const SizedBox(height: 28),
                  const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4)),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
