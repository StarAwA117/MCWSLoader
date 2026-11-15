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

  # node_flutter otherwise recursively calls AssetManager.list for every
  # directory. Precompute the list so first launch copies 1000+ files without
  # hundreds of slow directory listings.
  python3 - "$APP/android/app/src/main/assets" <<'PY'
import sys
from pathlib import Path

assets = Path(sys.argv[1])
project = assets / "nodejs-project"
dirs = ["nodejs-project"]
files = []
for path in project.rglob("*"):
    relative = path.relative_to(project)
    # Android's AAPT does not package hidden files/directories. They are not
    # needed by the runtime and would make the precomputed lists fail.
    if any(part.startswith(".") for part in relative.parts):
        continue
    rel = path.relative_to(assets).as_posix()
    if path.is_dir():
        dirs.append(rel)
    elif path.is_file():
        files.append(rel)
(assets / "dir.list").write_text("\n".join(dirs) + "\n")
(assets / "file.list").write_text("\n".join(files) + "\n")
print(f"nodejs assets: {len(dirs)} dirs, {len(files)} files")
PY

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

import re
app = Path(sys.argv[1])

# webview_all_wkwebview requires macOS 11+.
podfile = app / "macos" / "Podfile"
if podfile.exists():
    text = podfile.read_text()
    text = re.sub(r"platform :osx, '[^']+'", "platform :osx, '11.0'", text)
    podfile.write_text(text)

for project in app.glob("macos/Runner.xcodeproj/project.pbxproj"):
    text = project.read_text()
    text = text.replace("MACOSX_DEPLOYMENT_TARGET = 10.14;", "MACOSX_DEPLOYMENT_TARGET = 11.0;")
    text = text.replace("MACOSX_DEPLOYMENT_TARGET = 10.15;", "MACOSX_DEPLOYMENT_TARGET = 11.0;")
    project.write_text(text)

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

# The WebView loads a file:// page and fetches the loopback API over HTTP.
# Allow local networking without enabling arbitrary remote HTTP.
info = app / "macos" / "Runner" / "Info.plist"
if info.exists():
    text = info.read_text()
    if "NSAppTransportSecurity" not in text:
        text = text.replace(
            "</dict>\n</plist>",
            "\t<key>NSAppTransportSecurity</key>\n"
            "\t<dict>\n"
            "\t\t<key>NSAllowsLocalNetworking</key>\n"
            "\t\t<true/>\n"
            "\t</dict>\n"
            "</dict>\n</plist>",
            1,
        )
    info.write_text(text)
PY
fi

cd "$APP"
flutter pub get

if [[ "$TARGET" == "macos" ]]; then
  # flutter build creates its Podfile lazily; pin the platform before the
  # first CocoaPods run so webview_all_wkwebview can resolve.
  cat > macos/Podfile <<'PODFILE'
platform :osx, '11.0'
ENV['COCOAPODS_DISABLE_STATS'] = 'true'

project 'Runner', {
  'Debug' => :debug,
  'Profile' => :release,
  'Release' => :release,
}

def flutter_root
  generated_xcode_build_settings_path = File.expand_path(File.join('..', 'Flutter', 'ephemeral', 'Flutter-Generated.xcconfig'), __FILE__)
  unless File.exist?(generated_xcode_build_settings_path)
    raise "#{generated_xcode_build_settings_path} must exist. If you're running pod install manually, make sure \"flutter pub get\" is executed first"
  end

  File.foreach(generated_xcode_build_settings_path) do |line|
    matches = line.match(/FLUTTER_ROOT\=(.*)/)
    return matches[1].strip if matches
  end
  raise "FLUTTER_ROOT not found in #{generated_xcode_build_settings_path}. Try deleting Flutter-Generated.xcconfig, then run flutter pub get"
end

require File.expand_path(File.join('packages', 'flutter_tools', 'bin', 'podhelper'), flutter_root)

flutter_macos_podfile_setup

target 'Runner' do
  use_frameworks!
  flutter_install_all_macos_pods File.dirname(File.realpath(__FILE__))
end

post_install do |installer|
  installer.pods_project.targets.each do |target|
    flutter_additional_macos_build_settings(target)
  end
end
PODFILE
fi

dart run flutter_launcher_icons
