[English](./README_EN.md) | 简体中文

# MCWSLoader

Minecraft 基岩版 WebSocket 桥接服务器。通过游戏内置 WebSocket API 连接客户端，以 Mod 方式注入命令与自动化能力。

## 功能

- 游戏内命令执行与自动化（Litematic 建筑导入、图片转像素画、.mcfunction 等）
- AI 对话与 AI 执行命令（OpenAI 兼容接口）
- MIDI 音乐播放、区域填充复制、权限管理、QQ 群互通
- 客户端/服务端分层 Mod 加载机制，支持导入 `.wsmod` / `.zip`、依赖自动下载、覆盖安装与失败回滚
- Web 管理界面（默认端口 50005），支持在线配置、Mod 管理、日志查看、版本更新

## 快速开始

```bash
npm start
```

首次运行会自动从 `config.example.json` 初始化 `config.json`。启动后访问 WebUI（`http://127.0.0.1:50005`）即可在线配置。

游戏内输入 `/connect 127.0.0.1:8080` 连接。

## 配置

`config.json` 的主要配置项（完整示例见 [`config.example.json`](./config.example.json)）：

| 配置项 | 说明 |
|--------|------|
| `ws.name` / `ws.port` | 服务器名称与 WebSocket 端口（默认 8080） |
| `ws.connection.*` | 最大连接数、连接频率限制、`perMessageDeflate`、`maxPayload` |
| `ws.checkDependenciesOnLoad` | 启动时是否检查并自动安装 Mod 声明的 npm 依赖（默认开启） |
| `command.maxLength` | 单条命令最大长度 |
| `command.rateLimit.*` | 命令转发限流（默认 50ms 内 1024 条，超限自动延后到下一窗口） |
| `commandPrefix` | 游戏内命令前缀（默认 `$`） |
| `web.port` | WebUI 端口（默认 50005） |
| `web.auth.*` | 登录失败尝试次数、锁定时间 |

旧版配置（`safety.*`、顶层 `rateLimit`）会在读取时自动迁移到新结构，无需手动修改。

## WebUI 功能

启动后访问 `http://127.0.0.1:50005` 即可打开管理面板：

- **仪表盘**：服务器状态、运行时间、连接客户端数、进程信息
- **模组管理**：启用/禁用/重载 Mod，导入 `.wsmod` / `.zip`，删除 Mod，查看清单与文档（重载与删除都会先确认）
- **命令**：执行基岩版命令并查看结果
- **客户端**：查看已连接客户端，切换主客户端
- **日志**：查看运行日志与聊天记录
- **配置**：在线修改服务器、连接、命令限流、依赖检查、WebUI 等配置
- **更新**：检查 GitHub 最新版本，支持版本列表选择更新或回退

## Mod

把 `.wsmod` / `.zip` 压缩包拖进 WebUI 的导入按钮即可安装：

- 压缩包内必须包含 `manifest.json`（在根目录或单层文件夹内均可）
- 同名 Mod 已存在时会先询问是否覆盖；覆盖保留压缩包中未出现的文件
- 覆盖过程中失败会自动回滚到旧版本；全新安装失败会清理半成品
- 清单可通过可选的 `dependencies` 字段声明 npm 依赖（包名列表），缺失时自动 `npm install`

详见 [Mods 文档](./docs/mods.md)。

## 自更新

WebUI 内置更新功能，可自动检测 GitHub 最新 Release 版本，支持：
- 一键更新到最新版本
- 从版本列表选择任意 Release 版本回退
- 更新完成后自动提示重启

## 命令

游戏聊天栏输入 `$t:help` 获取命令帮助（`$` 为 `commandPrefix`，可在配置中修改）。完整命令列表见 [文档](./docs/)。

## 文档

- [Mods](./docs/mods.md)：Mod 结构、`manifest.json`、依赖、导入/删除
- [命令](./docs/command.md)：游戏内与终端命令参考
- [API](./docs/API.md)：REST API 与 Mod 开发 API

## 许可

[GPL-3.0](./LICENSE)

---

Also try [EnderBridge](https://github.com/Hydrooxzgen/EnderBridge)
