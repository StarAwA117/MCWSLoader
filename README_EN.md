English | [简体中文](./README.md)

# MCWSLoader

Minecraft Bedrock Edition WebSocket bridge server. Connects clients via the built-in WebSocket API and injects commands and automation through a Mod system.

## Features

- In-game command execution and automation (Litematic building import, image to pixel art, .mcfunction, etc.)
- AI chat and AI command execution (OpenAI-compatible API)
- MIDI music playback, region fill/copy, permission management, QQ group bridge
- Client/Server layered Mod loading, with `.wsmod` / `.zip` import, automatic dependency download, overwrite install and rollback on failure
- Web management interface (default port 50005), with online config, Mod management, log viewer, and version updates

## Quick Start

```bash
npm start
```

On first run, `config.json` is automatically initialized from `config.example.json`. After startup, visit the WebUI at `http://127.0.0.1:50005` to configure settings online.

In-game, connect with `/connect 127.0.0.1:8080`.

## Configuration

Main keys in `config.json` (see [`config.example.json`](./config.example.json) for the full file):

| Key | Description |
|-----|-------------|
| `ws.name` / `ws.port` | Server name and WebSocket port (default 8080) |
| `ws.connection.*` | Max connections, connection rate limit, `perMessageDeflate`, `maxPayload` |
| `ws.checkDependenciesOnLoad` | Check and auto-install the npm dependencies declared by Mods on startup (default on) |
| `command.maxLength` | Maximum length of a single command |
| `command.rateLimit.*` | Command forwarding rate limit (default 1024 per 50ms; excess is deferred to the next window) |
| `commandPrefix` | In-game command prefix (default `$`) |
| `web.port` | WebUI port (default 50005) |
| `web.auth.*` | Login attempt limit and lockout window |

Legacy configs (`safety.*`, top-level `rateLimit`) are migrated automatically on read — no manual edit needed.

## WebUI Features

After startup, visit `http://127.0.0.1:50005` to open the management panel:

- **Dashboard**: server status, uptime, connected clients, process info
- **Mods**: enable/disable/reload, import `.wsmod` / `.zip`, delete, view manifest and readme (reload and delete ask for confirmation first)
- **Commands**: execute Bedrock commands and view results
- **Clients**: view connected clients, switch main client
- **Logs**: view runtime logs and chat history
- **Config**: edit server, connection, command rate limit, dependency check and WebUI settings online
- **Update**: check GitHub latest release, select version to update or rollback

## Mods

Import a `.wsmod` / `.zip` archive with the import button in the WebUI:

- The archive must contain a `manifest.json` (at the root or inside a single top-level folder)
- If a Mod with the same name exists, you are asked whether to overwrite; files not present in the archive are kept
- A failed overwrite rolls back to the previous version; a failed fresh install is cleaned up
- The optional `dependencies` field declares npm dependencies (a list of package names); missing ones are installed with `npm install`

See the [Mods documentation](./docs/mods.md).

## Self-Update

The WebUI has a built-in updater that detects the latest GitHub Release version, with support for:
- One-click update to the latest version
- Rollback to any selected Release version from the version list
- Automatic restart prompt after update

## Commands

Type `$t:help` in game chat for command help (`$` is `commandPrefix`, configurable). Full command reference in [docs](./docs/).

## Documentation

- [Mods](./docs/mods.md): Mod layout, `manifest.json`, dependencies, import/delete
- [Commands](./docs/command.md): in-game and terminal command reference
- [API](./docs/API.md): REST API and Mod development API

## License

[GPL-3.0](./LICENSE)

---

Also try [EnderBridge](https://github.com/Hydrooxzgen/EnderBridge)
