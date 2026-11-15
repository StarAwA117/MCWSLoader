# Android / Windows / Linux / macOS App

The standalone app uses a Flutter shell to host the same Vue WebUI used by the
normal WebUI. The Vue production build is bundled in Flutter assets and loaded
through a WebView with `file://`; **no static WebUI server is started**. The
embedded Node server still exposes the local API on `127.0.0.1:50100`.

Source: [`flutter/`](https://github.com/StarAwA117/MCWSLoader/tree/main/flutter)

## Defaults

- WebSocket is off; start it from the dashboard.
- Mode is `gui`.
- The WebUI does not show a login page and does not require a password.
- Only the local API is exposed, not a remote WebUI.
- Updates and process-control entries are hidden in standalone builds.

## Platforms

| Platform | Build | Runtime |
|---|---|---|
| Android | arm64 APK | Android 7+, Node 24 LTS lite in `:node` process |
| Windows | x64 zip | Windows 10 1809+, WebView2 Runtime |
| Linux | x64 tarball | GTK 3 + WebKitGTK 4.1 |
| macOS | arm64 zip | macOS 11+ |

Android keeps Node in a separate foreground service process and supports boot
autostart. The Flutter UI process does not load `libnode.so`.

## Build

```bash
npm ci
cd web/frontend
npm ci
VITE_API_BASE=http://127.0.0.1:50100 npm run build -- --mode standalone
cd ../..

node scripts/build-standalone.mjs --target android
bash scripts/prepare-flutter-app.sh android
```

For desktop:

```bash
node scripts/build-standalone.mjs --target desktop
bash scripts/prepare-flutter-app.sh windows   # or linux / macos
```

`build-standalone.mjs` copies `web/frontend/dist-standalone` to
`flutter/assets/webui`. The standalone entry is emitted as a classic script
because ES modules do not load reliably from `file://` in a WebView.

## Connecting to a game

The app manages the embedded server locally. To let Minecraft connect, enable
the WebSocket server in the dashboard and use the phone/PC address shown by the
normal server setup. LAN access still requires the normal WebSocket host and
firewall configuration.

## Data

- Android: private app directory `files/nodejs-project`
- Windows/Linux/macOS: application support directory `server/`

Back up `config.json`, `permission.json`, `mods/` and custom Mods before
reinstalling.

## Notes

- Android Mod imports, external commands and npm dependency installs are
  limited by the mobile runtime.
- Only run trusted Mods and scripts.
- macOS may require Gatekeeper approval on first launch.
