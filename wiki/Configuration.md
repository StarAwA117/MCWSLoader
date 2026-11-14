# Configuration

MCWSLoader reads `config.json` from the repository root. On first start it is
created from `config.example.json`; the WebUI **Settings** page can edit it.

Most values are reloaded when saved from the WebUI. Listener settings
(`ws.port`, `ws.host`, `web.port`) require a restart.

## Full example

```json
{
	"ws": {
		"name": "MCWSLoader",
		"port": 8080,
		"host": "127.0.0.1",
		"connection": {
			"maxConnections": 100,
			"enableMaxConnections": false,
			"enableConnectionRateLimit": true,
			"rateLimitWindow": 60000,
			"rateLimitMax": 10,
			"perMessageDeflate": false,
			"maxPayload": 8388608,
			"requireApproval": true,
			"allowedIPs": []
		},
		"checkDependenciesOnLoad": true
	},
	"command": {
		"maxLength": 461,
		"rateLimit": { "enabled": true, "windowMs": 50, "maxPerWindow": 1024 },
		"playerRateLimit": { "enabled": true, "windowMs": 5000, "maxPerWindow": 10 },
		"allowShellExec": false
	},
	"commandPrefix": "$",
	"web": {
		"port": 50005,
		"auth": { "maxAttempts": 3, "windowMs": 60000, "lockoutMs": 60000 },
		"ui": { "allowedOrigins": [] }
	},
	"sapi": { "gmsg": "gmsg", "smsg": "smsg" },
	"utils": { "tellAllToTell": false, "enablePolling": true },
	"logLevel": "info",
	"language": "zh-CN",
	"update": {
		"autoCheck": false,
		"allowPrerelease": false
	}
}
```

## WebSocket

| Key | Default | Description |
|-----|---------|-------------|
| `ws.name` | `MCWSLoader` | Server display name |
| `ws.port` | `8080` | WebSocket port |
| `ws.host` | `127.0.0.1` | Bind address. Set `0.0.0.0` for LAN clients |
| `ws.connection.maxConnections` | `100` | Limit used when `enableMaxConnections` is on |
| `ws.connection.enableMaxConnections` | `false` | Enforce the connection limit |
| `ws.connection.enableConnectionRateLimit` | `true` | Per-IP connection rate limit |
| `ws.connection.rateLimitWindow` | `60000` | Rate-limit window in ms |
| `ws.connection.rateLimitMax` | `10` | Connections allowed per window and IP |
| `ws.connection.perMessageDeflate` | `false` | Enable per-message compression |
| `ws.connection.maxPayload` | `8388608` | Max message size in bytes (`0` also means 8MB) |
| `ws.connection.requireApproval` | `true` | Remote clients start pending and cannot send packets until approved in the WebUI. Loopback is auto-trusted |
| `ws.connection.allowedIPs` | `[]` | IP / CIDR allowlist. Empty means no restriction. Examples: `127.0.0.1`, `192.168.1.0/24` |
| `ws.checkDependenciesOnLoad` | `true` | Install npm dependencies declared by enabled Mods at startup |

See [Security](Security) for the reasoning behind `requireApproval` and
`allowedIPs`.

## Commands

| Key | Default | Description |
|-----|---------|-------------|
| `commandPrefix` | `$` | In-game command prefix |
| `command.maxLength` | `461` | Maximum length of one Bedrock command |
| `command.rateLimit.enabled` | `true` | Outgoing command rate limit |
| `command.rateLimit.windowMs` | `50` | Window in ms |
| `command.rateLimit.maxPerWindow` | `1024` | Commands per window; excess waits for the next window |
| `command.playerRateLimit.enabled` | `true` | Per-player chat command limit |
| `command.playerRateLimit.windowMs` | `5000` | Window in ms |
| `command.playerRateLimit.maxPerWindow` | `10` | Commands per player per window |
| `command.allowShellExec` | `false` | Allow the owner to use `t:exec` (server shell). Enable only when the owner is fully trusted |

## WebUI

| Key | Default | Description |
|-----|---------|-------------|
| `web.port` | `50005` | HTTP port |
| `web.auth.maxAttempts` | `3` | Failed logins before lockout |
| `web.auth.windowMs` | `60000` | Attempt window in ms |
| `web.auth.lockoutMs` | `60000` | Lockout duration in ms |
| `web.ui.allowedOrigins` | `[]` | Cross-origin API/WebSocket origins. Empty means same-origin/native clients only |

Passwords are stored as a scrypt hash plus salt. Change the password in
**Settings → WebUI → Reset Password**; this invalidates all sessions.

## Updates

Update settings live at the top of **Settings → System**.

| Key | Default | Description |
|-----|---------|-------------|
| `update.autoCheck` | `false` | Check GitHub for a newer release once when the script starts. It only logs an available update; it does not download or overwrite code. |
| `update.allowPrerelease` | `false` | Include GitHub Pre-releases (e.g. `2.0.0-beta.1`) in update checks and the version picker |

The WebUI **Check Update** button and version picker use the same settings.
The current version is read from `package.json`.

## Logging and language

| Key | Default | Description |
|-----|---------|-------------|
| `logLevel` | `info` | `debug`, `info`, `warning`, `error` |
| `language` | `zh-CN` | `zh-CN`, `zh-TW`, `en` |

Logs rotate at 10MB with 3 backups (`app.log.1` … `.3`). Override the size with
the `MCWS_LOG_MAX_BYTES` environment variable.

## SAPI / Utils

| Key | Default | Description |
|-----|---------|-------------|
| `sapi.gmsg` | `gmsg` | Command polled for incoming SAPI messages |
| `sapi.smsg` | `smsg` | Command used to send SAPI messages |
| `utils.tellAllToTell` | `false` | Forward `tellAll` as `tellraw` |
| `utils.enablePolling` | `true` | Poll `/list` and permission state |

## Legacy configs

Old `safety.*` and top-level `rateLimit.command` keys are migrated on read and
removed from the in-memory config. Saving from the WebUI writes the new shape.
