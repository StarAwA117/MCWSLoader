# FastBuilder — Minecraft Bedrock 结构生成器

将 FastBuilder 的几何脚本能力移植到 MCWSLoader Mod 体系，通过 `$fb:run` 在游戏内直接执行 JavaScript 结构生成脚本。

## 命令

| 命令 | 说明 |
|------|------|
| `$fb:run <script>` | 执行脚本，`<script>` 可以是内联代码，也可以是 `scripts/` 下的文件名 |
| `$fb:runthis <script>` | 以玩家当前位置为中心执行脚本，用法与 `$fb:run` 相同 |
| `$fb:list` | 列出 `scripts/` 目录下所有可用的脚本文件 |

## 安装

1. 确保当前工作目录下已安装依赖：
   ```bash
   npm install @pureeval/voxel-geometry
   ```
2. 在 `mod/` 目录中创建 `fastbuilder/`，并放入 `main.js` 与 `manifest.json`。
3. 重启服务端或在 WebUI 的 Mods 页面启用 FastBuilder。

## 配置

FastBuilder 支持独立配置文件，统一放在：

```
mod/fastbuilder/config.json
```

示例配置参考 `mod/fastbuilder/config.example.json`：

```json
{
  "defaultBlock": "iron_block",
  "origin": { "x": 0, "y": 0, "z": 0 },
  "particle": "minecraft:explosion"
}
```

- `defaultBlock`：默认放置方块
- `origin`：参考原点，`$fb:run` 会以此为中心
- `particle`：粒子效果

## 脚本目录

所有落盘脚本统一放在：

```
mod/fastbuilder/scripts/
```

建议文件名以 `.js` 结尾，例如：

```
mod/fastbuilder/scripts/
├── ball.js
├── tower.js
└── house.js
```

## 快速示例

### 内联执行

在游戏内聊天发送：

```
$fb:run "const ball = sphere(5, 0); setBlocks(ball);"
```

### 以玩家位置为中心执行

在游戏内聊天发送：

```
$fb:runthis "const ball = circle(5, 0); setBlocks(ball);"
```

### 从文件执行

先创建脚本 `mod/fastbuilder/scripts/ball.js`：

```js
const ball = sphere(5, 0);
setBlocks(ball);
```

然后在游戏内发送：

```
$fb:run ball.js
```

## 可用 API

在 `$fb:run` / `$fb:runthis` 的脚本中，默认可直接使用以下变量与函数：

| 名称 | 说明 |
|------|------|
| `vec3(x, y, z)` | 创建一个三维向量 |
| `sphere(radius, innerRadius)` | 生成球体 |
| `circle(radius, innerRadius)` | 生成圆盘 |
| `torus(radius, ringRadius)` | 生成圆环 |
| `line(p1, p2, resolution)` | 生成两点连线 |
| `box(min, max)` | 生成长方体 |
| `cylinder(radius, height)` | 生成圆柱 |
| `setBlocks(space)` | 使用默认方块批量放置 |
| `setBlocks(block)(space)` | 指定方块后批量放置 |
| `tell_raw(...msg)` | 向自己发送 tellraw 消息 |
| `broadcast(...msg)` | 向所有人发送 tellraw 消息 |
| `pos()` | 异步获取当前位置 |
| `setting` | 当前设置对象 |

### setting 对象

```js
setting = {
  block: "minecraft:iron_block", // 默认方块
  origin: { x: 0, y: 0, z: 0 }, // 参考原点
  particle: "minecraft:explosion" // 粒子效果
}
```

## 示例脚本

### 球体

```js
const ball = sphere(5, 0);
setBlocks(ball);
```

### 圆柱

```js
const pillar = cylinder(2, 10);
setBlocks(pillar);
```

### 圆环

```js
const ring = torus(8, 3);
setBlocks(ring);
```

### 带位移的结构

```js
const shape = sphere(4, 0);
setBlocks(move(shape, vec3(10, 0, 0)));
```

### 以玩家位置为中心生成圆

```js
const c = circle(5, 0);
setBlocks(c);
```

## 注意事项

- 复杂几何会生成大量 `setblock` / `fill` 指令，建议先在空地测试。
- 超大结构可能触发客户端或服务端指令限流，请适当拆分脚本。
- 脚本执行错误会通过 tellraw 返回具体信息，方便调试。
- `$fb:runthis` 以玩家当前位置为中心生成，不需要额外偏移脚本坐标。
- `setBlocks` 会按 Y 层分组并尽量合并为 `/fill`，减少命令数量和方块吞失概率。
