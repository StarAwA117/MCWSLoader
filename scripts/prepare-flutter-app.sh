#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-android}"
APP="$ROOT/build/flutter_app"

rm -rf "$APP"
mkdir -p "$ROOT/build"
cd "$ROOT"

flutter create --platforms=android,windows,linux,macos --org com.mcwsloader --project-name mcwsloader "$APP"
cp -R "$ROOT/flutter/lib/." "$APP/lib/"
cp "$ROOT/flutter/pubspec.yaml" "$APP/pubspec.yaml"
cp "$ROOT/flutter/analysis_options.yaml" "$APP/analysis_options.yaml"
rm -rf "$APP/assets"
mkdir -p "$APP/assets"
cp -R "$ROOT/flutter/assets/." "$APP/assets/"
cp "$ROOT/flutter/icon.png" "$APP/assets/icon.png"

if [[ "$TARGET" == "android" ]]; then
  mkdir -p "$APP/android/app/src/main/assets"
  cp -R "$ROOT/build/standalone/android/nodejs-project" "$APP/android/app/src/main/assets/nodejs-project"

  MANIFEST="$APP/android/app/src/main/AndroidManifest.xml"
  python3 - "$MANIFEST" "$APP/android/app/src/main/kotlin" <<'PY'
import re
import sys
from pathlib import Path

manifest = Path(sys.argv[1])
s = manifest.read_text()
if "android.permission.INTERNET" not in s:
    s = s.replace(
        "<application",
        '<uses-permission android:name="android.permission.INTERNET" />\n    <application',
        1,
    )
permissions = [
    "android.permission.RECEIVE_BOOT_COMPLETED",
    "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
]
for permission in permissions:
    if permission not in s:
        s = s.replace(
            "</manifest>",
            f'    <uses-permission android:name="{permission}" />\n</manifest>',
            1,
        )
s = s.replace('android:label="mcwsloader"', 'android:label="MCWSLoader"')
if "usesCleartextTraffic" not in s:
    s = s.replace(
        'android:label="MCWSLoader"',
        'android:label="MCWSLoader"\n        android:usesCleartextTraffic="true"',
        1,
    )
if "BootReceiver" not in s:
    s = s.replace(
        "</application>",
        '        <receiver android:name=".BootReceiver" android:enabled="true" android:exported="true">\n'
        '            <intent-filter><action android:name="android.intent.action.BOOT_COMPLETED" /></intent-filter>\n'
        '        </receiver>\n'
        '    </application>',
        1,
    )
manifest.write_text(s)

gradle = manifest.parent / "build.gradle.kts"
namespace = "com.mcwsloader.mcwsloader"
if gradle.exists():
    match = re.search(r'namespace\s*=\s*"([^"]+)"', gradle.read_text())
    if match:
        namespace = match.group(1)
kotlin_dir = Path(sys.argv[2]) / namespace.replace(".", "/")
kotlin_dir.mkdir(parents=True, exist_ok=True)
template = Path("scripts/templates/BootReceiver.kt").read_text()
(kotlin_dir / "BootReceiver.kt").write_text(template.replace("__PACKAGE__", namespace))
activity = Path("scripts/templates/MainActivity.kt").read_text()
(kotlin_dir / "MainActivity.kt").write_text(activity.replace("__PACKAGE__", namespace))
PY

  if [[ -f "$APP/android/app/build.gradle.kts" ]]; then
    sed -i 's/minSdk = flutter.minSdkVersion/minSdk = 24/' "$APP/android/app/build.gradle.kts"
  elif [[ -f "$APP/android/app/build.gradle" ]]; then
    sed -i 's/minSdkVersion flutter.minSdkVersion/minSdkVersion 24/' "$APP/android/app/build.gradle"
  fi
fi

if [[ "$TARGET" == "macos" ]]; then
  python3 - "$APP" <<'PY'
import sys
from pathlib import Path

app = Path(sys.argv[1])
for name in ("DebugProfile.entitlements", "Release.entitlements"):
    path = app / "macos" / "Runner" / name
    if not path.exists():
        continue
    s = path.read_text()
    s = s.replace(
        "<key>com.apple.security.app-sandbox</key>\n\t<true/>",
        "<key>com.apple.security.app-sandbox</key>\n\t<false/>",
    )
    if "com.apple.security.network.client" not in s:
        s = s.replace(
            "</dict>",
            "\t<key>com.apple.security.network.client</key>\n\t<true/>\n"
            "\t<key>com.apple.security.network.server</key>\n\t<true/>\n"
            "\t<key>com.apple.security.cs.allow-jit</key>\n\t<true/>\n"
            "\t<key>com.apple.security.cs.disable-library-validation</key>\n\t<true/>\n"
            "</dict>",
        )
    path.write_text(s)
PY
fi

cd "$APP"
flutter pub get
dart run flutter_launcher_icons
