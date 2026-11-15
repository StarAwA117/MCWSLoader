#!/usr/bin/env python3
"""Patch node_flutter after pub get.

The upstream plugin targets a normal Flutter activity. The standalone app needs
three changes:

* Node must run in a separate Android process, so a native crash cannot take
  the Flutter UI with it.
* The UI process must never load the 60+ MB libnode.so.
* A missing POST_NOTIFICATIONS permission must not prevent the foreground
  service from starting; Android 13+ still allows a foreground service without
  a visible notification.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"patch-node-flutter: {label} not found")
    return text.replace(old, new, 1)


plugin_dir = Path(sys.argv[1] if len(sys.argv) > 1 else ".")
plugin = plugin_dir / "android/src/main/kotlin/org/binbard/node_flutter/NodeFlutterPlugin.kt"
service = plugin.parent / "NodeService.kt"
manifest = plugin.parents[4] / "AndroidManifest.xml"

for path in (plugin, service, manifest):
    if not path.exists():
        raise SystemExit(f"patch-node-flutter: missing {path}")

s = plugin.read_text()

# Keep the standalone server's V8 heap bounded on phones.
s = s.replace(
    'arrayOf("node", "$nodeJsProjectPath/$mainFileName")',
    'arrayOf("node", "--max-old-space-size=128", "$nodeJsProjectPath/$mainFileName")',
)

# Wait until the APK assets have been copied before starting the service.
if "waitForInit()\n          val title" not in s:
    s = replace_once(
        s,
        'val title = options?.get("title") as? String ?: "Node Service"',
        'waitForInit()\n          val title = options?.get("title") as? String ?: "Node Service"',
        "startNodeService waitForInit",
    )

# NodeService owns libnode in the :node process. Loading it in the UI process is
# both slow and unsafe; this is the main cause of the old startup crash.
s, removed = re.subn(
    r'    init \{.*?System\.loadLibrary\("node"\)\n    \}\n',
    "",
    s,
    count=1,
    flags=re.S,
)
if removed != 1:
    raise SystemExit("patch-node-flutter: NodeFlutterPlugin init block not found")

# Android 13+ allows a foreground service without POST_NOTIFICATIONS. The
# upstream plugin returns an error before starting the service, which leaves
# the app polling a port that will never open.
start = s.find("          var havePermission = true")
if start < 0:
    raise SystemExit("patch-node-flutter: notification permission block not found")
end_marker = '          if(!havePermission) {\n'
end = s.find(end_marker, start)
if end < 0:
    raise SystemExit("patch-node-flutter: notification error block not found")
end = s.find("          }\n", end + len(end_marker))
if end < 0:
    raise SystemExit("patch-node-flutter: notification error block end not found")
s = s[:start] + s[end + len("          }\n"):]
# Remove the blank line left between the intent setup and the service start.
s = s.replace("          }\n\n\n          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)", "          }\n\n          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)")

# The UI process intentionally does not load libnode, so these JNI helpers
# cannot be called there. Derive the ABI from the platform and leave the native
# data-dir registration to the :node process.
s = s.replace(
    'nativeAssetsPath = "$BUILTIN_NATIVE_ASSETS_PREFIX${getCurrentABIName()}"',
    'nativeAssetsPath = "$BUILTIN_NATIVE_ASSETS_PREFIX${Build.SUPPORTED_ABIS.firstOrNull() ?: "arm64-v8a"}"',
)
s = s.replace(
    '        val abiName = getCurrentABIName()\n        result.success(abiName)',
    '        result.success(Build.SUPPORTED_ABIS.firstOrNull() ?: "arm64-v8a")',
)
s = s.replace(
    '    // Register the filesDir as the Node data dir.\n    registerNodeDataDirPath(filesDirPath)\n',
    '',
)
plugin.write_text(s)

ss = service.read_text()
ss = ss.replace(
    'arrayOf("node", "$nodeJsProjectPath/$mainFileName")',
    'arrayOf("node", "--max-old-space-size=128", "$nodeJsProjectPath/$mainFileName")',
)
service.write_text(ss)
# The upstream asset copier uses a 1 KB buffer. The standalone project contains
# a ~20 MB node_modules tree, so use a larger buffer to keep first launch fast.
s = s.replace("val buffer = ByteArray(1024)", "val buffer = ByteArray(64 * 1024)")
plugin.write_text(s)

ms = manifest.read_text()
if 'android:process=":node"' not in ms:
    ms = replace_once(
        ms,
        '<service android:name=".NodeService"',
        '<service android:name=".NodeService" android:process=":node"',
        "NodeService process",
    )
manifest.write_text(ms)

print("patch-node-flutter: patched plugin, service and manifest")
