import 'package:shared_preferences/shared_preferences.dart';

/// 只持久化服务器地址，不保存密码或 token。
class ServerStore {
  static const _key = 'mcws.server_url';

  static Future<String?> load() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_key);
  }

  static Future<void> save(String url) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, url);
  }

  static Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }
}
