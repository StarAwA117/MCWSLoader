#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-android}"
APP="$ROOT/build/flutter_app"

rm -rf "$APP"
mkdir -p "$ROOT/build"
cd "$ROOT"

flutter create --platforms=android,windows,linux --org com.mcwsloader --project-name mcwsloader "$APP"
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
  python3 - "$MANIFEST" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
s = p.read_text()
s = s.replace('<manifest ', '<manifest xmlns:android="http://schemas.android.com/apk/res/android" ', 1) if 'xmlns:android=' not in s else s
if 'android.permission.INTERNET' not in s:
    s = s.replace('<application', '<uses-permission android:name="android.permission.INTERNET" />\n    <application', 1)
s = s.replace('android:label="mcwsloader"', 'android:label="MCWSLoader"')
s = s.replace('android:label="MCWSLoader"', 'android:label="MCWSLoader"\n        android:usesCleartextTraffic="true"', 1) if 'usesCleartextTraffic' not in s else s
p.write_text(s)
PY

  if [[ -f "$APP/android/app/build.gradle.kts" ]]; then
    python3 - "$APP/android/app/build.gradle.kts" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
s = p.read_text()
s = s.replace('minSdk = flutter.minSdkVersion', 'minSdk = 24', 1)
p.write_text(s)
PY
  elif [[ -f "$APP/android/app/build.gradle" ]]; then
    python3 - "$APP/android/app/build.gradle" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
s = p.read_text()
s = s.replace('minSdkVersion flutter.minSdkVersion', 'minSdkVersion 24', 1)
p.write_text(s)
PY
  fi
fi

cd "$APP"
flutter pub get
dart run flutter_launcher_icons
