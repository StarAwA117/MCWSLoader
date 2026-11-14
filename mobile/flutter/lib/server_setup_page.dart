import 'package:flutter/material.dart';

import 'server_store.dart';
import 'server_url.dart';
import 'webui_page.dart';

class ServerSetupPage extends StatefulWidget {
  const ServerSetupPage({super.key, this.initialUrl});

  final String? initialUrl;

  @override
  State<ServerSetupPage> createState() => _ServerSetupPageState();
}

class _ServerSetupPageState extends State<ServerSetupPage> {
  late final TextEditingController _controller;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(
      text: widget.initialUrl ?? 'http://127.0.0.1:50005',
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _open() async {
    final uri = parseServerUrl(_controller.text);
    if (uri == null) {
      setState(() => _error = '请输入有效的 http:// 或 https:// 地址');
      return;
    }

    setState(() => _error = null);
    final url = displayServerUrl(uri);
    await ServerStore.save(url);
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => WebUiPage(startUri: Uri.parse(url))),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('MCWSLoader')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Icon(Icons.dns_rounded, size: 64, color: theme.colorScheme.primary),
            const SizedBox(height: 12),
            Text(
              '连接 WebUI',
              textAlign: TextAlign.center,
              style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            Text(
              '输入运行 MCWSLoader 的服务器地址',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 20),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    TextField(
                      controller: _controller,
                      keyboardType: TextInputType.url,
                      textInputAction: TextInputAction.go,
                      autocorrect: false,
                      enableSuggestions: false,
                      decoration: InputDecoration(
                        labelText: '服务器地址',
                        hintText: 'http://192.168.1.10:50005',
                        errorText: _error,
                        prefixIcon: const Icon(Icons.link_rounded),
                        border: const OutlineInputBorder(),
                      ),
                      onSubmitted: (_) => _open(),
                    ),
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed: _open,
                      icon: const Icon(Icons.login_rounded),
                      label: const Text('打开 WebUI'),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              '提示：同一台手机上运行的 MCWSLoader 使用 127.0.0.1；'
              '局域网内的服务器填写电脑/手机的局域网 IP。',
              style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 12),
            Card(
              color: theme.colorScheme.errorContainer,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(Icons.shield_outlined, color: theme.colorScheme.onErrorContainer),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'HTTP 会以明文传输登录密码和会话 token，'
                        '请仅在可信局域网使用，或通过 HTTPS / VPN 访问。',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onErrorContainer,
                        ),
                      ),
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
