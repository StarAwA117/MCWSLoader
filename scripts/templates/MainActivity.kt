package __PACKAGE__

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "mcws/standalone")
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "ensureDataDirectory" -> result.success(ensureDataDirectory())
                    "requestBackgroundPermissions" -> {
                        requestBackgroundPermissions()
                        result.success(true)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    /**
     * The Mod path fields use "./" for this directory. Prefer the public
     * /sdcard/games/mcwsloader path; if the user has not granted all-files
     * access, ask for it and return null so the UI can show a retry screen.
     */
    private fun ensureDataDirectory(): String? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !Environment.isExternalStorageManager()) {
            val intent = Intent(
                Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                Uri.parse("package:$packageName"),
            )
            val opened = runCatching { startActivity(intent); true }.getOrDefault(false)
            if (!opened) {
                runCatching { startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) }
            }
            return null
        }
        val root = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && Environment.isExternalStorageManager()) {
            File(Environment.getExternalStorageDirectory(), "games/mcwsloader")
        } else {
            File(getExternalFilesDir(null) ?: filesDir, "mcwsloader")
        }
        return if (root.exists() || root.mkdirs()) root.absolutePath else null
    }

    private fun requestBackgroundPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            runCatching {
                startActivity(
                    Intent(
                        Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                        Uri.parse("package:$packageName"),
                    )
                )
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
        }
    }
}
