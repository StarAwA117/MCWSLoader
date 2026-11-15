English | [简体中文](./README.md)

# MCWSLoader

<div align="center">

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D22-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20Windows-lightgrey?style=flat-square)]()
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square)](https://www.gnu.org/licenses/gpl-3.0)

Minecraft Bedrock Edition WebSocket bridge server. Connects clients through the game's built-in WebSocket API, injects commands and automation through a Mod system, and ships with a web management UI.

</div>

## Features

- In-game command execution and automation (Litematic, image to pixel art, .mcfunction, etc.)
- AI chat and AI command execution (OpenAI-compatible API)
- MIDI music, region fill/copy, permission management
- Client/server layered Mod loading with `.wsmod` / `.zip` import, dependency install and rollback
- Web management UI (default 50005) and Android / Windows client shell

## Quick Start

Requires **Node.js 22+**.

```bash
npm install
npm start
```

- WebUI: `http://127.0.0.1:50005`
- In game: `/connect 127.0.0.1:8080`
- On first run, `config.json` is created from `config.example.json`

The server binds to `127.0.0.1` by default. Read
[Security](https://github.com/StarAwA117/MCWSLoader/wiki/Security) before exposing it to a LAN.

## Documentation

Full documentation lives in the Wiki:

- [Configuration](https://github.com/StarAwA117/MCWSLoader/wiki/Configuration)
- [Security](https://github.com/StarAwA117/MCWSLoader/wiki/Security)
- [Commands](https://github.com/StarAwA117/MCWSLoader/wiki/Commands)
- [Mods](https://github.com/StarAwA117/MCWSLoader/wiki/Mods)
- [API](https://github.com/StarAwA117/MCWSLoader/wiki/API)
- [Android / Windows App](https://github.com/StarAwA117/MCWSLoader/wiki/App)
- [Development](https://github.com/StarAwA117/MCWSLoader/wiki/Development)

## License

[GPL-3.0](./LICENSE)

---

Also try [EnderBridge](https://github.com/Hydrooxzgen/EnderBridge)