/// 把用户输入规范化为 WebUI 地址。
/// - 缺少协议时补 http://
/// - 缺少端口时补 50005（MCWSLoader WebUI 默认端口）
Uri? parseServerUrl(String input) {
  var raw = input.trim();
  if (raw.isEmpty) return null;
  if (!raw.contains('://')) raw = 'http://$raw';

  final parsed = Uri.tryParse(raw);
  if (parsed == null || parsed.host.isEmpty) return null;
  if (parsed.scheme != 'http' && parsed.scheme != 'https') return null;

  return parsed.hasPort ? parsed : parsed.replace(port: 50005);
}

/// 用于展示的地址（去掉末尾斜杠）。
String displayServerUrl(Uri uri) {
  final text = uri.toString();
  return text.endsWith('/') ? text.substring(0, text.length - 1) : text;
}
