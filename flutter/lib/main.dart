import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'standalone_app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const McwsApp());
}

class McwsApp extends StatelessWidget {
  const McwsApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'MCWSLoader',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.light,
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF60A5FA)),
        scaffoldBackgroundColor: const Color(0xFFF4F8FF),
        fontFamily: 'sans-serif',
      ),
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      supportedLocales: const [Locale('zh', 'CN'), Locale('zh', 'TW'), Locale('en')],
      home: const StandaloneApp(),
    );
  }
}
