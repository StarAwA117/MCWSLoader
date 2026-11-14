import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'server_setup_page.dart';
import 'server_store.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final savedUrl = await ServerStore.load();
  runApp(McwsApp(initialUrl: savedUrl));
}

class McwsApp extends StatelessWidget {
  const McwsApp({super.key, this.initialUrl});

  final String? initialUrl;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MCWSLoader',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF60A5FA)),
      ),
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [Locale('zh', 'CN'), Locale('en')],
      home: ServerSetupPage(initialUrl: initialUrl),
    );
  }
}
