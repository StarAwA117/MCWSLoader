import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api.dart';

class MainShell extends StatefulWidget {
  const MainShell({super.key, required this.api});

  final ApiClient api;

  @override
  State<MainShell> createState() => _MainShellState();
}

class _MainShellState extends State<MainShell> {
  int _index = 0;
  Map<String, dynamic>? _status;
  String? _error;
  Timer? _timer;

  static const _items = [
    (Icons.dashboard_rounded, '仪表盘'),
    (Icons.devices_rounded, '客户端'),
    (Icons.terminal_rounded, '命令'),
    (Icons.chat_bubble_rounded, '消息'),
    (Icons.extension_rounded, '模组'),
    (Icons.receipt_long_rounded, '日志'),
    (Icons.settings_rounded, '设置'),
  ];

  @override
  void initState() {
    super.initState();
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 3), (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    try {
      final data = await widget.api.get('/api/status');
      if (!mounted) return;
      setState(() {
        _status = data is Map<String, dynamic> ? data : null;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  Widget _page(int index) {
    switch (index) {
      case 0:
        return DashboardPage(api: widget.api, status: _status, onRefresh: _refresh);
      case 1:
        return ClientsPage(api: widget.api);
      case 2:
        return CommandsPage(api: widget.api);
      case 3:
        return ChatPage(api: widget.api);
      case 4:
        return ModsPage(api: widget.api);
      case 5:
        return LogsPage(api: widget.api);
      default:
        return SettingsPage(api: widget.api);
    }
  }

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 820;
    return Scaffold(
      appBar: AppBar(
        title: const Text('MCWSLoader'),
        actions: [
          IconButton(onPressed: _refresh, tooltip: '刷新', icon: const Icon(Icons.refresh_rounded)),
        ],
      ),
      drawer: wide ? null : Drawer(child: _navigation(context)),
      body: Row(
        children: [
          if (wide) SizedBox(width: 230, child: _navigation(context)),
          Expanded(
            child: Column(
              children: [
                if (_error != null)
                  MaterialBanner(
                    content: Text(_error!, style: const TextStyle(fontSize: 12)),
                    actions: [TextButton(onPressed: _refresh, child: const Text('重试'))],
                  ),
                Expanded(child: _page(_index)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _navigation(BuildContext context) {
    return NavigationRail(
      selectedIndex: _index,
      extended: MediaQuery.sizeOf(context).width >= 1100,
      labelType: MediaQuery.sizeOf(context).width >= 1100 ? NavigationRailLabelType.none : NavigationRailLabelType.all,
      onDestinationSelected: (value) {
        setState(() => _index = value);
        Scaffold.maybeOf(context)?.closeDrawer();
      },
      destinations: [
        for (final item in _items)
          NavigationRailDestination(
            icon: Icon(item.$1),
            selectedIcon: Icon(item.$1, color: const Color(0xFF2563EB)),
            label: Text(item.$2),
          ),
      ],
    );
  }
}

Widget _card({required Widget child}) => Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFE2E8F0)),
        boxShadow: const [BoxShadow(color: Color(0x0A0F172A), blurRadius: 18, offset: Offset(0, 8))],
      ),
      child: child,
    );

class DashboardPage extends StatefulWidget {
  const DashboardPage({super.key, required this.api, required this.status, required this.onRefresh});
  final ApiClient api;
  final Map<String, dynamic>? status;
  final Future<void> Function() onRefresh;

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  bool _busy = false;

  Future<void> _toggle(bool running) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await widget.api.post(running ? '/api/system/stop-websocket' : '/api/system/start-websocket');
      await widget.onRefresh();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final server = widget.status?['server'] as Map<String, dynamic>?;
    final connections = widget.status?['connections'] as Map<String, dynamic>?;
    final mods = widget.status?['mods'] as Map<String, dynamic>?;
    final running = server?['websocketRunning'] != false;
    final uptime = (server?['uptime'] as num?)?.toInt() ?? 0;
    final clients = (connections?['count'] as num?)?.toInt() ?? 0;
    final serverMods = (mods?['server'] as List?)?.length ?? 0;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Container(
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: running ? const [Color(0xFF2563EB), Color(0xFF60A5FA)] : const [Color(0xFFF1F5F9), Color(0xFFE2E8F0)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(24),
          ),
          child: Row(
            children: [
              Icon(Icons.bolt_rounded, size: 46, color: running ? Colors.white : const Color(0xFF64748B)),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('服务状态', style: TextStyle(fontSize: 12, color: running ? Colors.white70 : const Color(0xFF64748B))),
                    Text(running ? '运行中' : '未开启', style: TextStyle(fontSize: 25, fontWeight: FontWeight.w700, color: running ? Colors.white : const Color(0xFF334155))),
                    Text('WebSocket ${server?['wsPort'] ?? '-'}  ·  WebUI ${server?['webPort'] ?? '-'}', style: TextStyle(fontSize: 12, color: running ? Colors.white70 : const Color(0xFF64748B))),
                  ],
                ),
              ),
              FilledButton(
                onPressed: _busy ? null : () => _toggle(running),
                style: FilledButton.styleFrom(
                  backgroundColor: running ? Colors.white : const Color(0xFF2563EB),
                  foregroundColor: running ? const Color(0xFF2563EB) : Colors.white,
                ),
                child: Text(_busy ? '处理中' : running ? '停止' : '启动'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(child: _stat('运行时间', _duration(uptime), Icons.schedule_rounded)),
            const SizedBox(width: 10),
            Expanded(child: _stat('客户端', '$clients', Icons.devices_rounded)),
            const SizedBox(width: 10),
            Expanded(child: _stat('服务端模组', '$serverMods', Icons.extension_rounded)),
          ],
        ),
        const SizedBox(height: 6),
        _card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('连接', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
              const SizedBox(height: 12),
              if (connections?['clients'] is List && (connections!['clients'] as List).isNotEmpty)
                ...(connections['clients'] as List).map((c) => Padding(
                      padding: const EdgeInsets.only(bottom: 9),
                      child: Row(children: [
                        const Icon(Icons.circle, size: 8, color: Color(0xFF22C55E)),
                        const SizedBox(width: 8),
                        Expanded(child: Text((c as Map)['localPlayerName']?.toString() ?? (c['ip']?.toString() ?? '未知客户端'))),
                        Text(c['isMain'] == true ? '主客户端' : '已连接', style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
                      ]),
                    ))
              else
                const Text('暂无客户端连接', style: TextStyle(color: Color(0xFF94A3B8))),
            ],
          ),
        ),
      ],
    );
  }

  Widget _stat(String label, String value, IconData icon) => _card(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 18, color: const Color(0xFF2563EB)),
            const SizedBox(height: 10),
            Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            Text(label, style: const TextStyle(fontSize: 11, color: Color(0xFF64748B))),
          ],
        ),
      );

  String _duration(int ms) {
    final s = ms ~/ 1000;
    final h = s ~/ 3600;
    final m = (s % 3600) ~/ 60;
    if (h > 0) return '${h}h ${m}m';
    return '${m}m';
  }
}

class ClientsPage extends StatefulWidget {
  const ClientsPage({super.key, required this.api});
  final ApiClient api;
  @override
  State<ClientsPage> createState() => _ClientsPageState();
}

class _ClientsPageState extends State<ClientsPage> {
  List<dynamic> _clients = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get('/api/clients');
      if (mounted) setState(() => _clients = data is List ? data : []);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _action(String id, String action, String label) async {
    try {
      await widget.api.post('/api/clients/$id/$action');
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$label失败: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (_clients.isEmpty) const Center(child: Padding(padding: EdgeInsets.all(40), child: Text('暂无客户端连接', style: TextStyle(color: Color(0xFF94A3B8))))),
          for (final c in _clients)
            _card(
              child: Row(
                children: [
                  CircleAvatar(backgroundColor: const Color(0xFFDBEAFE), child: Text((c['localPlayerName'] ?? '?').toString().substring(0, 1), style: const TextStyle(color: Color(0xFF2563EB)))),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(c['localPlayerName']?.toString() ?? '未命名客户端', style: const TextStyle(fontWeight: FontWeight.w600)),
                        Text('${c['ip'] ?? '未知 IP'}  ${c['isMain'] == true ? '· 主客户端' : ''}', style: const TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                      ],
                    ),
                  ),
                  PopupMenuButton<String>(
                    onSelected: (value) {
                      if (value == 'disconnect') _action(c['id'].toString(), 'disconnect', '断开');
                      else if (value == 'main') _action(c['id'].toString(), 'set-main', '切换主客户端');
                      else if (value == 'approve') _action(c['id'].toString(), 'approve', '批准');
                      else if (value == 'revoke') _action(c['id'].toString(), 'revoke', '撤销');
                    },
                    itemBuilder: (_) => [
                      if (c['trusted'] != true) const PopupMenuItem(value: 'approve', child: Text('批准')),
                      if (c['trusted'] == true && c['isMain'] != true) const PopupMenuItem(value: 'main', child: Text('设为主客户端')),
                      if (c['trusted'] == true) const PopupMenuItem(value: 'revoke', child: Text('撤销批准')),
                      const PopupMenuItem(value: 'disconnect', child: Text('断开连接')),
                    ],
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class CommandsPage extends StatefulWidget {
  const CommandsPage({super.key, required this.api});
  final ApiClient api;
  @override
  State<CommandsPage> createState() => _CommandsPageState();
}

class _CommandsPageState extends State<CommandsPage> {
  final _input = TextEditingController();
  final _output = <String>[];
  bool _busy = false;

  Future<void> _run() async {
    final command = _input.text.trim();
    if (command.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _output.add('> $command');
    });
    try {
      final data = await widget.api.post('/api/command', {'command': command});
      setState(() => _output.add(data is Map && data['result'] != null ? jsonEncode(data['result']) : '完成'));
    } catch (e) {
      setState(() => _output.add('错误: $e'));
    } finally {
      _input.clear();
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [for (final line in _output) SelectableText(line, style: const TextStyle(fontFamily: 'monospace', fontSize: 12))],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(children: [
            Expanded(child: TextField(controller: _input, decoration: const InputDecoration(hintText: '输入命令', border: OutlineInputBorder()), onSubmitted: (_) => _run())),
            const SizedBox(width: 8),
            FilledButton(onPressed: _busy ? null : _run, child: const Text('执行')),
          ]),
        ),
      ],
    );
  }
}

class ChatPage extends StatefulWidget {
  const ChatPage({super.key, required this.api});
  final ApiClient api;
  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  List<String> _lines = [];
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 2), (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get('/api/chat');
      if (!mounted) return;
      final lines = data is Map && data['lines'] is List ? List<String>.from(data['lines']) : <String>[];
      final stick = !_scroll.hasClients || _scroll.position.pixels >= _scroll.position.maxScrollExtent - 40;
      setState(() => _lines = lines);
      if (stick) {
        await Future<void>.delayed(const Duration(milliseconds: 30));
        if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
      }
    } catch (_) {}
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    _input.clear();
    try {
      await widget.api.post('/api/chat', {'message': text});
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('发送失败: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(child: ListView.builder(controller: _scroll, padding: const EdgeInsets.all(16), itemCount: _lines.length, itemBuilder: (_, i) => Padding(padding: const EdgeInsets.only(bottom: 6), child: Text(_lines[i], style: const TextStyle(fontSize: 13))))),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(children: [
            Expanded(child: TextField(controller: _input, decoration: const InputDecoration(hintText: '发送消息', border: OutlineInputBorder()), onSubmitted: (_) => _send())),
            const SizedBox(width: 8),
            FilledButton(onPressed: _send, child: const Text('发送')),
          ]),
        ),
      ],
    );
  }
}

class ModsPage extends StatefulWidget {
  const ModsPage({super.key, required this.api});
  final ApiClient api;
  @override
  State<ModsPage> createState() => _ModsPageState();
}

class _ModsPageState extends State<ModsPage> {
  List<Map<String, dynamic>> _mods = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get('/api/mods');
      if (!mounted) return;
      final result = <String, Map<String, dynamic>>{};
      for (final side in ['server', 'client']) {
        if (data is Map && data[side] is List) {
          for (final raw in data[side] as List) {
            final mod = Map<String, dynamic>.from(raw as Map);
            final name = mod['name']?.toString() ?? '';
            if (!result.containsKey(name)) result[name] = mod;
          }
        }
      }
      setState(() => _mods = result.values.toList());
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _toggle(Map<String, dynamic> mod, bool enabled) async {
    try {
      await widget.api.post('/api/mods/${Uri.encodeComponent(mod['name'].toString())}/${enabled ? 'enable' : 'disable'}');
      await _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Row(children: [
          const Expanded(child: Text('已安装模组', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700))),
          TextButton(onPressed: () async { await widget.api.post('/api/mods/reload-all'); await _load(); }, child: const Text('全部重载')),
        ]),
        for (final mod in _mods)
          _card(
            child: SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(mod['displayName']?.toString() ?? mod['name'].toString(), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
              subtitle: Text(mod['displayDescription']?.toString() ?? mod['description']?.toString() ?? '', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12)),
              value: mod['enabled'] == true,
              onChanged: (v) => _toggle(mod, v),
            ),
          ),
      ],
    );
  }
}

class LogsPage extends StatefulWidget {
  const LogsPage({super.key, required this.api});
  final ApiClient api;
  @override
  State<LogsPage> createState() => _LogsPageState();
}

class _LogsPageState extends State<LogsPage> {
  List<String> _lines = [];
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _load();
    _timer = Timer.periodic(const Duration(seconds: 2), (_) => _load());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get('/api/logs?name=app&lines=300');
      if (mounted) setState(() => _lines = data is Map && data['lines'] is List ? List<String>.from(data['lines']) : []);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _lines.length,
      itemBuilder: (_, i) => Text(_lines[i], style: const TextStyle(fontFamily: 'monospace', fontSize: 11, color: Color(0xFF334155))),
    );
  }
}

class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key, required this.api});
  final ApiClient api;
  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  Map<String, dynamic>? _config;
  final _name = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final data = await widget.api.get('/api/config');
      if (!mounted || data is! Map<String, dynamic>) return;
      setState(() {
        _config = data;
        _name.text = data['ws']?['name']?.toString() ?? 'MCWSLoader';
      });
    } catch (_) {}
  }

  Future<void> _save() async {
    final config = _config;
    if (config == null) return;
    config['ws']['name'] = _name.text.trim();
    try {
      await widget.api.put('/api/config', config);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('设置已保存')));
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('保存失败: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_config == null) return const Center(child: CircularProgressIndicator());
    final lang = _config!['language']?.toString() ?? 'zh-CN';
    final theme = _config!['web']?['ui']?['theme']?.toString() ?? 'star';
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        _card(child: TextField(controller: _name, decoration: const InputDecoration(labelText: '服务器名称', border: OutlineInputBorder()))),
        _card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('语言', style: TextStyle(fontWeight: FontWeight.w600)),
              DropdownButton<String>(
                value: lang,
                isExpanded: true,
                items: const [
                  DropdownMenuItem(value: 'zh-CN', child: Text('简体中文')),
                  DropdownMenuItem(value: 'zh-TW', child: Text('繁體中文')),
                  DropdownMenuItem(value: 'en', child: Text('English')),
                ],
                onChanged: (v) { if (v != null) setState(() => _config!['language'] = v); },
              ),
              const Divider(),
              const Text('主题', style: TextStyle(fontWeight: FontWeight.w600)),
              DropdownButton<String>(
                value: theme,
                isExpanded: true,
                items: const [
                  DropdownMenuItem(value: 'star', child: Text('Star')),
                  DropdownMenuItem(value: 'catppuccin-mocha', child: Text('Catppuccin Mocha')),
                ],
                onChanged: (v) { if (v != null) setState(() => _config!['web']['ui']['theme'] = v); },
              ),
            ],
          ),
        ),
        FilledButton(onPressed: _save, child: const Text('保存设置')),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          onPressed: () async {
            try {
              await MethodChannel('mcws/standalone').invokeMethod('requestBackgroundPermissions');
            } catch (e) {
              if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('无法打开后台权限设置: $e')));
            }
          },
          icon: const Icon(Icons.battery_saver_rounded),
          label: const Text('后台运行与电池优化'),
        ),
        const SizedBox(height: 20),
        const Text('独立版默认不启动 WebSocket，请在仪表盘手动启动。', style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
      ],
    );
  }
}
