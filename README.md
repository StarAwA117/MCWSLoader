[English](./README_EN.md) | 简体中文

# MCWSLoader

Minecraft 基岩版 WebSocket 桥接服务器。通过游戏内置 WebSocket API 连接客户端，以 Mod 方式注入命令与自动化能力，并提供 Web 管理界面。

## 功能

- 游戏内命令执行与自动化（Litematic、图片转像素画、.mcfunction 等）
- AI 对话与 AI 执行命令（OpenAI 兼容接口）
- MIDI 音乐、区域填充复制、权限管理
- 客户端/服务端分层 Mod 加载，支持 `.wsmod` / `.zip` 导入、依赖安装与失败回滚
- Web 管理界面（默认 50005）与 Android / Windows 客户端壳

## 快速开始

要求 **Node.js 22+**。

```bash
npm install
npm start
```

- WebUI：`http://127.0.0.1:50005`
- 游戏内连接：`/connect 127.0.0.1:8080`
- 首次启动会从 `config.example.json` 生成 `config.json`

默认只监听 `127.0.0.1`；局域网访问与安全设置请先阅读
[Security](https://github.com/StarAwA117/MCWSLoader/wiki/Security)。

## 文档

完整文档已迁移到 Wiki：

- [配置](https://github.com/StarAwA117/MCWSLoader/wiki/Configuration)
- [安全](https://github.com/StarAwA117/MCWSLoader/wiki/Security)
- [命令](https://github.com/StarAwA117/MCWSLoader/wiki/Commands)
- [Mods](https://github.com/StarAwA117/MCWSLoader/wiki/Mods)
- [API](https://github.com/StarAwA117/MCWSLoader/wiki/API)
- [Android / Windows App](https://github.com/StarAwA117/MCWSLoader/wiki/App)
- [开发](https://github.com/StarAwA117/MCWSLoader/wiki/Development)

## 许可

[GPL-3.0](./LICENSE)

---

Also try [EnderBridge](https://github.com/Hydrooxzgen/EnderBridge)
