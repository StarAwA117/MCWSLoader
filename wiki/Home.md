# MCWSLoader Wiki

Minecraft Bedrock Edition WebSocket bridge server.

MCWSLoader connects Bedrock clients through the game's built-in WebSocket API
and injects commands and automation through a Mod system. It ships with a web
management UI and a thin Flutter shell for Android / Windows.

## Quick start

Requires **Node.js 22+**.

```bash
npm install
npm start
```

- WebUI: `http://127.0.0.1:50005`
- In game: `/connect 127.0.0.1:8080`
- On first run, `config.json` is created from `config.example.json`

## Documentation

| Page | Contents |
|------|----------|
| [Configuration](Configuration) | All `config.json` keys, rate limits, network settings |
| [Security](Security) | Login, CORS/CSP, WebSocket approval and IP allowlist |
| [Commands](Commands) | In-game and terminal command reference |
| [Mods](Mods) | Mod layout, `manifest.json`, dependencies, import/delete |
| [API](API) | REST API and Mod development API |
| [App](App) | Android APK / Windows exe (Flutter WebView shell) |
| [Development](Development) | TypeScript, tests, CI and repository layout |

## Links

- Repository: <https://github.com/StarAwA117/MCWSLoader>
- Releases: <https://github.com/StarAwA117/MCWSLoader/releases>
- Issues: <https://github.com/StarAwA117/MCWSLoader/issues>
