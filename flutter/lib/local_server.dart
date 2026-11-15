import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:node_flutter/node_flutter.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

const String standaloneBaseUrl = 'http://127.0.0.1:50100';

class LocalServer {
  Process? _process;
  bool _started = false;

  bool get isAndroid => Platform.isAndroid;

  Future<void> start() async {
    // A previous readiness poll may have failed while Node was still copying
    // assets. Keep the service running, but allow retry to poll the API again.
    if (!_started) {
      if (isAndroid) {
        // The future resolves when Node exits, so do not await it here; poll the API instead.
        unawaited(Nodejs.startService(
          'main.js',
          title: 'MCWSLoader',
          content: '本地服务运行中',
          redirectOutputToLogcat: true,
        ).catchError((Object e) {
          debugPrint('Node service start failed: $e');
        }));
      } else {
        await _startDesktop();
      }
      _started = true;
    }
    await waitUntilReady();
  }

  Future<void> _startDesktop() async {
    final support = await getApplicationSupportDirectory();
    final serverDir = Directory(p.join(support.path, 'server'));
    final nodeName = Platform.isWindows ? 'node.exe' : 'node';
    final nodeFile = File(p.join(support.path, 'node', nodeName));

    if (!await serverDir.exists() || !File(p.join(serverDir.path, 'main.js')).existsSync()) {
      await _extractServer(serverDir);
    }
    if (!await nodeFile.exists()) {
      await nodeFile.parent.create(recursive: true);
      final data = await rootBundle.load('assets/node/$nodeName');
      await nodeFile.writeAsBytes(data.buffer.asUint8List(), flush: true);
    }
    if (!Platform.isWindows) {
      await Process.run('chmod', ['+x', nodeFile.path]);
    }

    _process = await Process.start(
      nodeFile.path,
      ['main.js'],
      workingDirectory: serverDir.path,
      environment: {
        ...Platform.environment,
        'MCWS_MODE': 'gui',
        'MCWS_WEB_PORT': '50100',
      },
      runInShell: false,
    );
    _process!.stdout.transform(utf8.decoder).listen((line) => debugPrint('[node] $line'));
    _process!.stderr.transform(utf8.decoder).listen((line) => debugPrint('[node:err] $line'));
    unawaited(_process!.exitCode.then((code) => debugPrint('[node] exited: $code')));
  }

  Future<void> _extractServer(Directory serverDir) async {
    await serverDir.create(recursive: true);
    final data = await rootBundle.load('assets/server.tar.gz');
    final tar = TarDecoder().decodeBytes(GZipDecoder().decodeBytes(data.buffer.asUint8List()));
    final root = serverDir.absolute.path;
    for (final file in tar.files) {
      if (!file.isFile) continue;
      var name = file.name.replaceAll('\\', '/');
      if (name.startsWith('server/')) name = name.substring('server/'.length);
      if (name.isEmpty) continue;
      final target = p.normalize(p.join(root, name));
      if (!p.isWithin(root, target)) continue;
      final out = File(target);
      await out.parent.create(recursive: true);
      await out.writeAsBytes(file.content as List<int>, flush: true);
    }
  }

  Future<void> waitUntilReady() async {
    final deadline = DateTime.now().add(const Duration(seconds: 60));
    final client = HttpClient();
    try {
      while (DateTime.now().isBefore(deadline)) {
        try {
          final req = await client.getUrl(Uri.parse('$standaloneBaseUrl/api/status'));
          final res = await req.close().timeout(const Duration(seconds: 2));
          await res.drain<void>();
          if (res.statusCode >= 200 && res.statusCode < 500) return;
        } catch (_) {
          // Node is still starting.
        }
        await Future<void>.delayed(const Duration(milliseconds: 500));
      }
    } finally {
      client.close(force: true);
    }
    throw Exception('Local service did not start. Port 50100 may be occupied.');
  }


  Future<void> stop() async {
    if (isAndroid) return;
    final process = _process;
    _process = null;
    if (process != null) {
      process.kill(ProcessSignal.sigterm);
      await process.exitCode.timeout(const Duration(seconds: 3), onTimeout: () {
        process.kill(ProcessSignal.sigkill);
        return -1;
      });
    }
    _started = false;
  }
}
