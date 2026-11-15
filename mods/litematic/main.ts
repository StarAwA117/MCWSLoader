import ModBase from "../../lib/modbase.js";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

// 路径解析辅助（原配置曾提供的 resolvePath，按 cwd 解析相对路径）
const resolvePath = (p) => path.resolve(p);

// NBT 标签类型常量
const TAG_END = 0, TAG_BYTE = 1, TAG_SHORT = 2, TAG_INT = 3, TAG_LONG = 4;
const TAG_FLOAT = 5, TAG_DOUBLE = 6, TAG_BYTE_ARRAY = 7, TAG_STRING = 8;
const TAG_LIST = 9, TAG_COMPOUND = 10, TAG_INT_ARRAY = 11, TAG_LONG_ARRAY = 12;

// INT_MASKS 用于位操作
const INT_MASKS = new Uint32Array(33);
for (let i = 0; i <= 32; i++) {
	INT_MASKS[i] = i === 32 ? 0xFFFFFFFF : (1 << i) - 1;
}

// NBT 解析
function parseNbt(buf) {
	let offset = 0;

	function readString() {
		const len = buf.readUInt16BE(offset);
		offset += 2;
		const str = buf.toString("utf8", offset, offset + len);
		offset += len;
		return str;
	}

	function readTag(type) {
		switch (type) {
			case TAG_BYTE:
				offset += 1;
				return buf.readInt8(offset - 1);
			case TAG_SHORT:
				offset += 2;
				return buf.readInt16BE(offset - 2);
			case TAG_INT:
				offset += 4;
				return buf.readInt32BE(offset - 4);
			case TAG_LONG: {
				const hi = buf.readInt32BE(offset);
				const lo = buf.readUInt32BE(offset + 4);
				offset += 8;
				return hi * 4294967296 + lo;
			}
			case TAG_FLOAT:
				offset += 4;
				return buf.readFloatBE(offset - 4);
			case TAG_DOUBLE:
				offset += 8;
				return buf.readDoubleBE(offset - 8);
			case TAG_BYTE_ARRAY: {
				const len = buf.readInt32BE(offset);
				offset += 4 + len;
				return [];
			}
			case TAG_STRING:
				return readString();
			case TAG_LIST: {
				const listType = buf.readInt8(offset++);
				const len = buf.readInt32BE(offset);
				offset += 4;
				const list = [];
				for (let i = 0; i < len; i++) list.push(readTag(listType));
				return list;
			}
			case TAG_COMPOUND: {
				const comp = {};
				while (offset < buf.length) {
					const type = buf.readInt8(offset++);
					if (type === TAG_END) break;
					comp[readString()] = readTag(type);
				}
				return comp;
			}
			case TAG_INT_ARRAY: {
				const len = buf.readInt32BE(offset);
				offset += 4 + len * 4;
				return [];
			}
			case TAG_LONG_ARRAY: {
				const len = buf.readInt32BE(offset);
				const dataStart = offset + 4;
				offset += 4 + len * 8;
				return { isZeroCopyLongArray: true, buffer: buf, offset: dataStart, length: len };
			}
			default:
				throw new Error(`未知的 NBT 标签类型: ${type}`);
		}
	}

	const rootType = buf.readInt8(offset++);
	if (rootType === TAG_END) return {};
	readString();
	return readTag(rootType);
}

function decompressAndParse(fileBuffer) {
	return new Promise((resolve, reject) => {
		zlib.gunzip(fileBuffer, (err, unzipped) => {
			if (err) reject(err);
			else resolve(parseNbt(unzipped));
		});
	});
}

// 从 BlockStates 提取方块索引
function extractBlockIndices(blockStates, totalBlocks, bitsPerIndex) {
	const indices = new Uint32Array(totalBlocks);
	const len = blockStates.length;
	const words = new Uint32Array(len * 2);
	let ptr = blockStates.offset;
	const buf = blockStates.buffer;
	for (let i = 0; i < len; i++) {
		const idx = i << 1;
		words[idx + 1] = buf.readUInt32BE(ptr);
		words[idx] = buf.readUInt32BE(ptr + 4);
		ptr += 8;
	}
	let bitPos = 0;
	for (let i = 0; i < totalBlocks; i++) {
		const wordIdx = bitPos >> 5;
		const bitOffset = bitPos & 31;
		const bitsFirst = Math.min(bitsPerIndex, 32 - bitOffset);
		let value = (words[wordIdx] >>> bitOffset) & INT_MASKS[bitsFirst];
		const remaining = bitsPerIndex - bitsFirst;
		if (remaining > 0) value |= ((words[wordIdx + 1] || 0) & INT_MASKS[remaining]) << bitsFirst;
		indices[i] = value;
		bitPos += bitsPerIndex;
	}
	return indices;
}

// 加载 Java -> Bedrock 映射
function loadMappings() {
	const dir = path.dirname(fileURLToPath(import.meta.url));
	const mappingFile = path.join(dir, "generator_blocks.json");

	let raw;
	try {
		raw = fs.readFileSync(mappingFile, "utf-8");
	} catch (err) {
		throw new Error(`读取映射表失败: ${err.message}`);
	}

	const data = JSON.parse(raw);
	if (!data.mappings || !Array.isArray(data.mappings)) {
		throw new Error("映射表格式不正确");
	}

	const map = new Map() as Map<string, any> & { fallbackMap: Map<any, any> };
	const fallbackMap = new Map();

	for (const entry of data.mappings) {
		const java = entry.java_state;
		if (!java || !java.Name) continue;
		const sortedProps = java.Properties
			? Object.keys(java.Properties).sort().map(k => `${k}=${java.Properties[k]}`).join(",")
			: "";
		const key = `${java.Name}::${sortedProps}`;
		const bedrock = entry.bedrock_state;
		if (!bedrock) continue;

		const identifier = bedrock.bedrock_identifier || java.Name;
		const state = { ...(bedrock.state || {}) };

		map.set(key, { identifier, state });

		if (!fallbackMap.has(java.Name)) {
			fallbackMap.set(java.Name, { identifier, state: { ...state } });
		}
	}

	const HARDCODED = {
		"minecraft:chain": { identifier: "chain", state: {} },
		"minecraft:grass": { identifier: "grass_block", state: {} }
	};
	for (const [name, info] of Object.entries(HARDCODED)) {
		if (!fallbackMap.has(name)) {
			fallbackMap.set(name, info);
		}
	}

	map.fallbackMap = fallbackMap;
	return map;
}

// 格式化 Bedrock 方块属性
function formatBlockState(state) {
	if (!state || Object.keys(state).length === 0) return "";
	const pairs = Object.entries(state)
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([k, v]) => {
			let val;
			if (k.endsWith("_bit")) {
				val = v ? "true" : "false";
			} else if (typeof v === "string") {
				val = `"${v}"`;
			} else {
				val = v;
			}
			return `"${k}"=${val}`;
		});
	return `[${pairs.join(",")}]`;
}

// 解析 Litematic 文件
// 返回 { sx, sy, sz, totalCoords, blocks, minY, maxY, unmappedBlocks, unmappedSummary }
//   blocks: [{ x, y, z, identifier, state, cmd }] 其中 cmd 为可直接执行的基岩版命令片段
//   minY/maxY: 非空气方块的实际 Y 范围（用于裁剪底部空气层）
//   unmappedBlocks/Summary: 无法映射到基岩版的方块（$verify map / $fix 检查对象）
async function parseLitematic(filePath) {
	const fileBuffer = fs.readFileSync(filePath);
	const nbt = await decompressAndParse(fileBuffer);

	const regions = (nbt as any).Regions;
	if (!regions) throw new Error("找不到 Regions 区域");

	const rName = Object.keys(regions)[0];
	const region = regions[rName];
	const size = region.Size;

	const sx = Math.abs(size.x);
	const sy = Math.abs(size.y);
	const sz = Math.abs(size.z);
	const totalBlocks = sx * sy * sz;

	const paletteRaw = region.BlockStatePalette;
	const palette = Array.isArray(paletteRaw) ? paletteRaw : paletteRaw.value || paletteRaw;
	const blockStates = region.BlockStates;

	if (!palette || !blockStates) {
		throw new Error("无效的 Litematic 文件");
	}

	const mapping = loadMappings();

	// 预处理 palette
	const AIR_NAMES = ["minecraft:air", "minecraft:cave_air", "minecraft:void_air"];
	const processedPalette = palette.map(node => {
		const state = node.value !== undefined ? node.value : node;
		if (!state || !state.Name) return null;

		const bName = typeof state.Name === "string" ? state.Name : state.Name.value;
		if (AIR_NAMES.includes(bName)) return null;

		const props = {};
		if (state.Properties) {
			const p = state.Properties.value || state.Properties;
			for (const k in p) {
				if (p[k] && p[k].value !== undefined) props[k] = p[k].value;
				else if (typeof p[k] === "string") props[k] = p[k];
			}
		}

		const sortedProps = Object.keys(props).sort().map(k => `${k}=${props[k]}`).join(",");
		const javaKey = `${bName}::${sortedProps}`;

		let bedrockInfo = mapping.get(javaKey);
		if (!bedrockInfo && mapping.fallbackMap) {
			bedrockInfo = mapping.fallbackMap.get(bName);
		}

		if (!bedrockInfo) return { unmapped: true, name: bName };

		return {
			identifier: bedrockInfo.identifier,
			state: bedrockInfo.state
		};
	});

	const bitsPerIndex = Math.max(2, Math.ceil(Math.log2(palette.length)));
	const indices = extractBlockIndices(blockStates, totalBlocks, bitsPerIndex);

	const blocks = [];
	const unmappedBlocks = [];
	const unmappedSummary = new Map();
	const sliceSize = sx * sz;
	let idx = 0;
	let minY = Infinity, maxY = -Infinity;

	for (let y = 0; y < sy; y++) {
		const yOffset = y * sliceSize;
		for (let z = 0; z < sz; z++) {
			const zOffset = z * sx;
			for (let x = 0; x < sx; x++) {
				const pIdx = indices[idx++];
				const cached = pIdx < processedPalette.length ? processedPalette[pIdx] : undefined;

				if (cached && cached.unmapped) {
					unmappedBlocks.push({ x, y, z, name: cached.name });
					unmappedSummary.set(cached.name, (unmappedSummary.get(cached.name) || 0) + 1);
					continue;
				}

				if (cached) {
					if (y < minY) minY = y;
					if (y > maxY) maxY = y;
					const state = cached.state || {};
					const stateStr = formatBlockState(state);
					const identifier = cached.identifier;
					const blockId = identifier.replace(/^minecraft:/, "");
					blocks.push({
						x, y, z,
						identifier,
						state,
						cmd: `${blockId}${stateStr ? " " + stateStr : ""}`
					});
				}
				// pIdx === 0 或 cached === null 表示空气
			}
		}
	}

	return {
		sx, sy, sz,
		totalCoords: totalBlocks,
		blocks,
		minY: minY === Infinity ? 0 : minY,
		maxY: maxY === -Infinity ? sy - 1 : maxY,
		unmappedBlocks,
		unmappedSummary: Object.fromEntries(unmappedSummary)
	};
}

// 裁剪底部空气层：将建筑最低的非空气方块对齐到 Y=0（对应放置点地面）
// 效果: 建筑不再悬空，且不会在清除空气阶段挖掉放置点下方地形
function trimAir(data) {
	const off = data.minY;
	data.trimmedAir = off;
	if (off > 0) {
		for (const b of data.blocks) b.y -= off;
		for (const b of data.unmappedBlocks || []) b.y -= off;
		data.sy = data.maxY - off + 1;
		data.totalCoords = data.sx * data.sy * data.sz;
	}
	return data;
}

// ---- .mcstructure 生成 (Little-endian NBT, 未压缩) ----
// .mcstructure 是基岩版结构方块文件格式，可在游戏内用结构方块预览/放置
const T_BYTE = 1, T_INT = 3, T_STRING = 8, T_LIST = 9, T_COMPOUND = 10;
const nt = (t, v) => ({ t, v });
const nByte = v => nt(T_BYTE, v);
const nInt = v => nt(T_INT, v);
const nStr = v => nt(T_STRING, v);
const nList = (elemType, v) => nt(T_LIST, { elemType, v });
const nComp = v => nt(T_COMPOUND, v);

function leString(s) {
	const b = Buffer.from(s, "utf8");
	const h = Buffer.alloc(2);
	h.writeUInt16LE(b.length);
	return Buffer.concat([h, b]);
}

function nbtPayload(n) {
	switch (n.t) {
		case T_BYTE: return Buffer.from([n.v & 0xFF]);
		case T_INT: { const b = Buffer.alloc(4); b.writeInt32LE(n.v); return b; }
		case T_STRING: return leString(n.v);
		case T_LIST: {
			const parts = [];
			for (const item of n.v.v) parts.push(nbtPayload(item));
			const head = Buffer.alloc(5);
			head[0] = n.v.elemType;
			head.writeInt32LE(n.v.v.length, 1);
			return Buffer.concat([head, ...parts]);
		}
		case T_COMPOUND: {
			const parts = [];
			for (const k in n.v) {
				const child = n.v[k];
				parts.push(Buffer.from([child.t]));
				parts.push(leString(k));
				parts.push(nbtPayload(child));
			}
			parts.push(Buffer.from([0]));
			return Buffer.concat(parts);
		}
	}
	throw new Error(`不支持的 NBT 类型: ${n.t}`);
}

function nbtRoot(name, node) {
	return Buffer.concat([Buffer.from([node.t]), leString(name), nbtPayload(node)]);
}

// 构建 .mcstructure 文件内容（block_indices 按 ZYX 顺序，z 变化最快；-1 表示留空）
function buildMcStructure(data) {
	const { sx, sy, sz } = data;
	const palette = [];
	const indexMap = new Map();
	for (const b of data.blocks) {
		if (!indexMap.has(b.cmd)) { indexMap.set(b.cmd, palette.length); palette.push(b); }
	}
	const total = sx * sy * sz;
	const base = new Int32Array(total).fill(-1);
	const overlay = new Int32Array(total).fill(-1);
	for (const b of data.blocks) {
		base[(b.x * sy + b.y) * sz + b.z] = indexMap.get(b.cmd);
	}
	const toState = v => typeof v === "boolean" ? nByte(v ? 1 : 0) : typeof v === "number" ? nInt(v) : nStr(String(v));
	const blockPalette = palette.map(p => nComp({
		name: nStr(p.identifier),
		states: nComp(Object.fromEntries(Object.entries(p.state || {}).map(([k, v]) => [k, toState(v)]))),
		version: nInt(18168865)
	}));
	const root = nComp({
		format_version: nInt(1),
		size: nList(T_INT, [nInt(sx), nInt(sy), nInt(sz)]),
		structure: nComp({
			block_indices: nList(T_LIST, [
				nList(T_INT, Array.from(base, v => nInt(v))),
				nList(T_INT, Array.from(overlay, v => nInt(v)))
			]),
			entities: nList(T_COMPOUND, []),
			palette: nComp({
				default: nComp({
					block_palette: nList(T_COMPOUND, blockPalette),
					block_position_data: nComp({})
				})
			})
		}),
		structure_world_origin: nList(T_INT, [nInt(0), nInt(0), nInt(0)])
	});
	return nbtRoot("", root);
}

// 矩形合并优化
function mergeBlocksToRects(blocks, sx, sz) {
	const layers = {};
	for (const b of blocks) {
		if (!layers[b.y]) layers[b.y] = [];
		layers[b.y].push(b);
	}

	const cmds = [];

	for (const y in layers) {
		const grid = Array.from({ length: sz }, () => Array(sx).fill(null));
		for (const b of layers[y]) grid[b.z][b.x] = b.cmd;

		const used = Array.from({ length: sz }, () => Array(sx).fill(false));

		for (let z = 0; z < sz; z++) {
			for (let x = 0; x < sx; x++) {
				if (used[z][x] || !grid[z][x]) continue;
				const cmd = grid[z][x];

				let maxX = x;
				while (maxX + 1 < sx && grid[z][maxX + 1] === cmd && !used[z][maxX + 1]) maxX++;

				let maxZ = z;
				let canExtend = true;
				while (canExtend && maxZ + 1 < sz) {
					for (let tx = x; tx <= maxX; tx++) {
						if (grid[maxZ + 1][tx] !== cmd || used[maxZ + 1][tx]) { canExtend = false; break; }
					}
					if (canExtend) maxZ++;
				}

				for (let tz = z; tz <= maxZ; tz++) {
					for (let tx = x; tx <= maxX; tx++) used[tz][tx] = true;
				}

				const area = (maxX - x + 1) * (maxZ - z + 1);
				if (area === 1) {
					cmds.push({ type: "setblock", x, y: parseInt(y), z, cmd, count: 1 });
				} else {
					cmds.push({ type: "fill", x1: x, y: parseInt(y), z1: z, x2: maxX, z2: maxZ, cmd, count: area });
				}
			}
		}
	}

	return cmds;
}

// 主类
export default class Litematic extends ModBase {
	// 任务存档为静态共享：连接/实例共用同一份，$create 返回的任务 ID 全局有效（$verify / $fix 使用）
	static taskSeq = 0;
	static tasks = new Map();

	constructor(client) {
		super();
		this.client = client;
		this.pending = null;
		this.job = null;
		this.page = 1;
		this.previewTimer = null;
		this.previewData = null;
		this.verifyJob = null;
		this.fixJob = null;
	}

	onCommand() {
		const c = this.client;
		return {
			op: [
				// l:help [命令名] — 列出所有命令，或查看指定命令的用法
this.Command.create("l:help", this.rawtext("litematic.msg.55d0a93ffa"))
					.addOptionalString(this.rawtext("litematic.param.0a77b99236"))
					.setFunc((sender, name) => {
						const all = this.onCommand().op;
						if (name) {
							const cm = all.find(x => x.name === name);
							if (!cm) {
								this.client.tell(this.rawtext("litematic.msg.2eef424bb4", { p0: name }), sender);
								return;
							}
							const params = cm.parameters.length
								? cm.parameters.map((p, i) => {
									const [type, desc, opt] = p;
									return this.rawtext("litematic.help.param", { p0: i + 1, p1: type, p2: opt ? this.rawtext("litematic.help.optional") : this.rawtext("litematic.help.required"), p3: desc ? ` - ${desc}` : "" });
								}).join("\n")
								: this.rawtext("litematic.help.noParams");
							this.client.tell(
								this.rawtext("litematic.help.details", { p0: cm.name, p1: cm.description, p2: params }), sender
							);
						} else {
							const lines = all.map(cm => `§a$l:${cm.name.replace(/^l:/, "")} §7- §f${cm.description}`).join("\n");
							this.client.tell(
								this.rawtext("litematic.help.list", { p0: lines }), sender
							);
						}
					}),

				// l:create <文件> [X] [Y] [Z] [trim|raw] — 导入建筑投影
this.Command.create("l:create", this.rawtext("litematic.msg.64bdede940"))
					.addString(this.rawtext("litematic.param.1275f6feb7"), false)
					.addOptionalString("X")
					.addOptionalString("Y")
					.addOptionalString("Z")
					.addOptionalString(this.rawtext("litematic.param.ed0eea8f20"))
					.setFunc(async (sender, fileName, x, y, z, mode) => {
						if (this.job) {
							this.client.tell(this.rawtext("litematic.msg.1c6c253c2c"), sender);
							return;
						}
						await this.create(fileName, sender, x, y, z, mode);
					}),

				// l:preview <文件> [X] [Y] [Z] [trim|raw] — 粒子+实体边框预览
this.Command.create("l:preview", this.rawtext("litematic.msg.a4a9f8b1de"))
					.addString(this.rawtext("litematic.param.1275f6feb7"), false)
					.addOptionalString("X")
					.addOptionalString("Y")
					.addOptionalString("Z")
					.addOptionalString(this.rawtext("litematic.param.ed0eea8f20"))
					.setFunc(async (sender, fileName, x, y, z, mode) => {
						await this.preview(fileName, sender, x, y, z, mode);
					}),

				// l:unpreview — 清除预览
this.Command.create("l:unpreview", this.rawtext("litematic.msg.dd9f92e16a"))
					.setFunc((sender) => {
						this.clearPreview(sender);
					}),

				// l:export <文件> [导出名] [trim|raw] — 导出 .mcstructure 结构文件
this.Command.create("l:export", this.rawtext("litematic.msg.afd9598d3e"))
					.addString(this.rawtext("litematic.param.1275f6feb7"), false)
					.addOptionalString(this.rawtext("litematic.param.e2179ba860"))
					.addOptionalString(this.rawtext("litematic.param.ed0eea8f20"))
					.setFunc(async (sender, fileName, exportName, mode) => {
						await this.exportStructure(fileName, sender, exportName, mode);
					}),

				// l:list [页码] — 浏览建筑文件
this.Command.create("l:list", this.rawtext("litematic.msg.4ef4895c37"))
					.addOptionalString(this.rawtext("litematic.param.7b0930e205"))
					.setFunc((sender, page) => {
						this.listFiles(page, sender);
					}),

				// l:id — 查看所有任务 ID（$create 返回，供 $verify / $fix 使用）
this.Command.create("l:id", this.rawtext("litematic.msg.20931c277d"))
					.setFunc((sender) => {
						this.listTasks(sender);
					}),

				// l:search <关键词> [页码] — 搜索建筑文件
this.Command.create("l:search", this.rawtext("litematic.msg.3af148c315"))
					.addString(this.rawtext("litematic.param.cc1b21e800"), false)
					.addOptionalString(this.rawtext("litematic.param.7b0930e205"))
					.setFunc((sender, keyword, page) => {
						this.searchFiles(keyword, page, sender);
					}),

				// l:y — 确认待执行的导入
this.Command.create("l:y", this.rawtext("litematic.msg.345501eb59"))
					.setFunc(async (sender) => {
						if (!this.pending) {
							this.client.tell(this.rawtext("litematic.msg.b85e5af369"), sender);
							return;
						}
						this.client.tell(this.rawtext("litematic.msg.761c183d93"), sender);
						try {
							await this.run();
						} catch (e) {
							this.client.tell(`§cLitematic | §fError > §i${this.rawtext("error.import")}`, sender);
							this.job = null;
						}
					}),

				// l:n — 取消待确认任务或中断正在进行的导入/检查/修复
this.Command.create("l:n", this.rawtext("litematic.msg.e7c0c52559"))
					.setFunc((sender) => {
						if (this.job) {
							this.job.cancelled = true;
							this.client.tell(this.rawtext("litematic.msg.b027d38cdc"), sender);
						} else if (this.verifyJob) {
							this.verifyJob.cancelled = true;
							this.client.tell(this.rawtext("litematic.msg.4ec50ec45c"), sender);
						} else if (this.fixJob) {
							this.fixJob.cancelled = true;
							this.client.tell(this.rawtext("litematic.msg.78071de9e4"), sender);
						} else if (this.pending) {
							this.pending = null;
							this.client.tell(this.rawtext("litematic.msg.c2f550d90a"), sender);
						} else {
							this.client.tell(this.rawtext("litematic.msg.5975493e92"), sender);
						}
					}),

				// l:author — 作者信息
this.Command.create("l:author", this.rawtext("litematic.msg.09df761536"))
					.setFunc((sender) => {
						this.client.tell("§eLitematic | §fAuthor > §iStarAwA117 & Hydrooxygen", sender);
					}),

				// l:status — 查看所有进行中任务进度（导入 / 世界检查 / 修复）
this.Command.create("l:status", this.rawtext("litematic.msg.c4b9fd3506"))
					.setFunc((sender) => {
						const lines = [];
						if (this.job) {
							const j = this.job;
							const elapsed = ((Date.now() - j.startTime) / 1000).toFixed(1);
							const cmdSpeed = j.phasePlaced > 0 ? Math.round(j.phasePlaced / parseFloat(elapsed)) : 0;
							const totalPct = j.total > 0 ? (j.phasePlaced / j.total * 100).toFixed(1) : "0.0";
							const phasePct = j.phaseTotal > 0 ? (j.phasePlaced / j.phaseTotal * 100).toFixed(1) : "0.0";
							lines.push(
								this.rawtext("litematic.status.progress", {
									p0: j.fileName, p1: totalPct,
									p2: cmdSpeed > 0 ? ((j.total - j.phasePlaced) / cmdSpeed).toFixed(1) : "?",
									p3: j.phase, p4: j.areaIndex, p5: j.areaTotal,
									p6: phasePct, p7: j.phasePlaced, p8: j.phaseTotal,
									p9: j.phaseBlocksPlaced, p10: j.phaseBlockTotal,
									p11: cmdSpeed, p12: elapsed
								})
							);
						}
						if (this.verifyJob) {
							const v = this.verifyJob;
							const elapsed = ((Date.now() - v.startTime) / 1000).toFixed(1);
							lines.push(
								`§eLitematic | §fStatus > §i世界检查 §f(任务 #${v.taskId}: ${v.fileName})\n` +
								`§f进度: ${v.total > 0 ? (v.checked / v.total * 100).toFixed(1) : "0.0"}% | ${v.checked} / ${v.total} 方块 | 不匹配: ${v.mismatches} | ${elapsed}s`
							);
						}
						if (this.fixJob) {
							const f = this.fixJob;
							const elapsed = ((Date.now() - f.startTime) / 1000).toFixed(1);
							lines.push(
								`§eLitematic | §fStatus > §i修复 §f(任务 #${f.taskId}: ${f.fileName})\n` +
								`§f进度: ${f.done} / ${f.total} 方块 | ${elapsed}s`
							);
						}
						if (!lines.length) {
							this.client.tell(this.rawtext("litematic.msg.a2ddc2c46e"), sender);
							return;
						}
						this.client.tellAll(lines.join("\n\n"));
					}),

				// l:verify <ID> [map|world] — 默认检查游戏世界一致性；map 检查方块映射错误
this.Command.create("l:verify", this.rawtext("litematic.msg.f19dc8e959"))
					.addString("ID", false)
					.addOptionalString(this.rawtext("litematic.param.ed0eea8f20"))
					.setFunc(async (sender, id, mode) => {
						const tid = Number(id);
						if (!Litematic.tasks.has(tid)) {
							this.client.tell(this.rawtext("litematic.msg.f797f736c0"), sender);
							return;
						}
						if (mode === "map") return this.verify(tid, sender);
						if (mode !== undefined && mode !== "world") {
							this.client.tell(this.rawtext("litematic.msg.41543e2d1b"), sender);
							return;
						}
						this.verifyWorld(tid, sender);
					}),

				// l:fix <ID> [替代方块] — 修复错误方块
this.Command.create("l:fix", this.rawtext("litematic.msg.721476b0d7"))
					.addString("ID", false)
					.addOptionalString(this.rawtext("litematic.param.9f4a6f3a72"))
					.setFunc((sender, id, fb) => {
						const tid = Number(id);
						if (!Litematic.tasks.has(tid)) {
							this.client.tell(this.rawtext("litematic.msg.f797f736c0"), sender);
							return;
						}
						if (this.fixJob) {
							this.client.tell(this.rawtext("litematic.msg.292dfab147"), sender);
							return;
						}
						this.fix(tid, sender, fb);
					})
			]
		};
	}

	// 分页显示文件列表（每页 5 个，附带文件大小）
	pageList(sender, files, header) {
		const dir = this.config.basePath;
		if (!fs.existsSync(dir)) {
			this.client.tell(this.rawtext("litematic.msg.7fcea5727c"), sender);
			return;
		}
		if (!files.length) {
			this.client.tell(this.rawtext("litematic.msg.585561adf8"), sender);
			return;
		}

		const pageSize = 5;
		const totalPages = Math.ceil(files.length / pageSize);
		const page = this.page || 1;
		const pn = Math.max(1, Math.min(page, totalPages));
		this.page = pn;

		const startIndex = (pn - 1) * pageSize;
		const pageFiles = files.slice(startIndex, startIndex + pageSize);

		const items = pageFiles.map((f, i) => {
			const name = f.replace(/\.litematic$/i, "");
			const num = String(startIndex + i + 1).padStart(2, " ");
			const filePath = path.join(dir, f);
			const stats = fs.statSync(filePath);
			const size = this.formatSize(stats.size);
			return `${num}. ${name} §f${size}`;
		}).join("\n");

		this.client.tell(this.rawtext("litematic.msg.e481cdb991", { p0: header, p1: pn, p2: totalPages, p3: files.length, p4: items }), sender);
	}

	listFiles(page, sender) {
		this.page = page !== undefined ? parseInt(page) || 1 : 1;
		const dir = this.config.basePath;
		const files = fs.existsSync(dir)
			? fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".litematic")).sort()
			: [];
		this.pageList(sender, files, "§eLitematic | §fList");
	}

	searchFiles(keyword, page, sender) {
		this.page = page !== undefined ? parseInt(page) || 1 : 1;
		const dir = this.config.basePath;
		const files = fs.existsSync(dir)
			? fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".litematic") && f.toLowerCase().includes(keyword.toLowerCase())).sort()
			: [];
		this.pageList(sender, files, `§eLitematic | §fSearch > §i"${keyword}"`);
	}

	// l:id — 列出所有任务（项目）的 ID，新任务在前
	listTasks(sender) {
		const tasks = [...Litematic.tasks.entries()].sort((a, b) => b[0] - a[0]);
		if (!tasks.length) {
			this.client.tell(this.rawtext("litematic.msg.9ed8daf320"), sender);
			return;
		}
		const now = Date.now();
		const lines = tasks.map(([id, t]) => {
			const blocks = t.data?.blocks?.length ?? 0;
			const age = now - t.time;
			const ago = age < 60000 ? this.rawtext("litematic.time.justNow")
				: age < 3600000 ? this.rawtext("litematic.time.minutes", { p0: Math.floor(age / 60000) })
				: age < 86400000 ? this.rawtext("litematic.time.hours", { p0: Math.floor(age / 3600000) })
				: this.rawtext("litematic.time.days", { p0: Math.floor(age / 86400000) });
			const tags = [];
			if ((t.mismatches || []).length) tags.push(this.rawtext("litematic.tasks.mismatch", { p0: t.mismatches.length }));
			if ((t.data?.unmappedBlocks || []).length) tags.push(this.rawtext("litematic.tasks.unmapped", { p0: t.data.unmappedBlocks.length }));
			return this.rawtext("litematic.tasks.item", {
				p0: String(id).padStart(3, " "), p1: t.file, p2: blocks, p3: ago,
				p4: tags.length ? " §7| " + tags.join(" ") : ""
			});
		}).join("\n");
		this.client.tell(this.rawtext("litematic.tasks.title", { p0: tasks.length, p1: lines }), sender);
	}

	formatSize(bytes) {
		if (bytes < 1024) return `${bytes}B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	}

	// 解析放置参数：支持 $cmd file raw / $cmd file x y z / $cmd file x y z raw
	parsePlacement(x, y, z, mode) {
		let raw = false;
		if (mode === "raw") raw = true;
		else if (mode === "trim") raw = false;
		else if (mode !== undefined) return { raw: null, coords: [] };
		if (mode === undefined && x === "raw") { raw = true; x = undefined; }
		const coords = [x, y, z].filter(v => v !== undefined && v !== null);
		return { raw, coords };
	}

	async create(fileName, sender, x, y, z, mode) {
		const { raw, coords } = this.parsePlacement(x, y, z, mode);
		if (raw === null) {
			this.client.tell(this.rawtext("litematic.msg.8d44701b2a"), sender);
			return;
		}
		if (coords.length > 0 && coords.length < 3) {
			this.client.tell(this.rawtext("litematic.msg.60fce4dc33"), sender);
			return;
		}

		// 路径穿越防护：只允许单层合法文件名
		if (typeof fileName !== "string" || !fileName ||
			fileName !== path.basename(fileName) || /[\\/]/.test(fileName) || fileName.startsWith(".")) {
			this.client.tell(this.rawtext("litematic.msg.6343575e0b", { p0: fileName }), sender);
			return;
		}

		const filePath = path.join(this.config.basePath, fileName.endsWith(".litematic") ? fileName : fileName + ".litematic");
		if (!fs.existsSync(filePath)) {
			this.client.tell(this.rawtext("litematic.msg.4b2a0817b2", { p0: fileName }), sender);
			return;
		}

		this.client.tell(this.rawtext("litematic.msg.4bfbdbb632"), sender);

		let data;
		try {
			data = await parseLitematic(filePath);
		} catch (e) {
			this.client.tell(`§cLitematic | §fError > §i${this.rawtext("error.parse")}`, sender);
			return;
		}
		if (!raw) trimAir(data);

		let origin;
		if (coords.length === 3) {
			origin = { x: Math.floor(Number(coords[0])), y: Math.floor(Number(coords[1])), z: Math.floor(Number(coords[2])) };
		} else {
			try {
				const pos = await this.client.getPosition("@s");
				if (!pos) {
					this.client.tell(this.rawtext("litematic.msg.484ff1f550"), sender);
					return;
				}
				// 玩家脚底的 Y 是其脚下方块的上表面，减 1 使建筑底部对齐到脚下那层方块
				origin = { x: Math.floor(pos.x), y: Math.floor(pos.y) - 1, z: Math.floor(pos.z) };
			} catch {
				this.client.tell(this.rawtext("litematic.msg.484ff1f550"), sender);
				return;
			}
		}

		if (origin.y < -64 || origin.y + data.sy - 1 > 320) {
			this.client.tell(this.rawtext("litematic.msg.6e5483a31a", { p0: origin.y, p1: origin.y + data.sy - 1 }), sender);
			return;
		}

		this.pending = { data, origin, file: fileName, raw };

		// 分配唯一任务 ID 并存档，供 $verify / $fix 使用
		const taskId = ++Litematic.taskSeq;
		Litematic.tasks.set(taskId, { data, file: fileName, origin, raw, time: Date.now() });
		this.pending.taskId = taskId;
		if (this.job && this.job.taskId === undefined) this.job.taskId = taskId;

		const minX = origin.x;
		const minY = origin.y;
		const minZ = origin.z;
		const maxX = minX + data.sx - 1;
		const maxY = minY + data.sy - 1;
		const maxZ = minZ + data.sz - 1;
		const blockCount = data.blocks.length;
		const cmdCount = mergeBlocksToRects(data.blocks, data.sx, data.sz).length;

		const startChunkX = Math.floor(minX / 16);
		const startChunkZ = Math.floor(minZ / 16);
		const endChunkX = Math.floor(maxX / 16);
		const endChunkZ = Math.floor(maxZ / 16);
		const totalChunksX = endChunkX - startChunkX + 1;
		const totalChunksZ = endChunkZ - startChunkZ + 1;
		const totalChunks = totalChunksX * totalChunksZ;

		const MAX_CHUNKS = 100;
		let areaCount;
		if (totalChunks <= MAX_CHUNKS) {
			areaCount = 1;
		} else if (totalChunksZ > MAX_CHUNKS) {
			areaCount = Math.ceil(totalChunksZ / MAX_CHUNKS) * totalChunksX;
		} else {
			areaCount = Math.ceil(totalChunksX / Math.floor(MAX_CHUNKS / totalChunksZ));
		}

		const unmappedCount = (data.unmappedBlocks || []).length;
		const estTime = ((areaCount + cmdCount) * 0.001 + 1).toFixed(1);

		this.client.tellAll(
			this.rawtext("litematic.import.info", {
				p0: fileName, p1: taskId, p2: data.sx, p3: data.sy, p4: data.sz, p5: data.totalCoords,
				p6: blockCount, p7: cmdCount, p8: data.trimmedAir,
				p9: raw ? this.rawtext("litematic.import.raw") : this.rawtext("litematic.import.trim"),
				p10: totalChunks, p11: totalChunksX, p12: totalChunksZ, p13: areaCount,
				p14: minX, p15: minY, p16: minZ, p17: maxX, p18: maxY, p19: maxZ, p20: estTime
			})
		);
		if (unmappedCount) {
			this.client.tellAll(this.rawtext("litematic.msg.4d1afbdd03", { p0: unmappedCount, p1: taskId, p2: taskId }));
		}
		this.client.tellAll(this.rawtext("litematic.msg.ecd8d87d2d"));
	}

	async run() {
		const task = this.pending;
		this.pending = null;

		const { data, origin, file, taskId } = task;
		const blocks = data.blocks;
		const total = blocks.length;
		const sx = data.sx, sy = data.sy, sz = data.sz;

		const rects = mergeBlocksToRects(blocks, sx, sz);
		const totalCmds = rects.length;

		this.job = {
			fileName: file,
			taskId,
			total: totalCmds,
			cancelled: false,
			startTime: Date.now(),
			blockTotal: total,
			phase: "准备",
			areaIndex: 0,
			areaTotal: 0,
			phasePlaced: 0,
			phaseTotal: 0,
			phaseBlocksPlaced: 0,
			phaseBlockTotal: 0
		};

		const MAX_CHUNKS = 100;
		const FILL_LIMIT = 32767;
		const delay = (ms) => new Promise(r => setTimeout(r, ms));

		const startChunkX = Math.floor(origin.x / 16);
		const startChunkZ = Math.floor(origin.z / 16);
		const endChunkX = Math.floor((origin.x + sx - 1) / 16);
		const endChunkZ = Math.floor((origin.z + sz - 1) / 16);

		const totalChunksX = endChunkX - startChunkX + 1;
		const totalChunksZ = endChunkZ - startChunkZ + 1;

		const areas = [];
		if (totalChunksX * totalChunksZ <= MAX_CHUNKS) {
			areas.push({
				cx1: startChunkX, cz1: startChunkZ,
				cx2: endChunkX, cz2: endChunkZ
			});
		} else if (totalChunksZ > MAX_CHUNKS) {
			const maxChunksZ = MAX_CHUNKS;
			for (let cz = startChunkZ; cz <= endChunkZ; cz += maxChunksZ) {
				const cz2 = Math.min(cz + maxChunksZ - 1, endChunkZ);
				areas.push({
					cx1: startChunkX, cz1: cz,
					cx2: endChunkX, cz2
				});
			}
		} else {
			const maxChunksX = Math.floor(MAX_CHUNKS / totalChunksZ);
			for (let cx = startChunkX; cx <= endChunkX; cx += maxChunksX) {
				const cx2 = Math.min(cx + maxChunksX - 1, endChunkX);
				areas.push({
					cx1: cx, cz1: startChunkZ,
					cx2, cz2: endChunkZ
				});
			}
		}

		for (let i = 0; i < areas.length; i++) {
			if (this.job.cancelled) break;

			const { cx1, cz1, cx2, cz2 } = areas[i];
			const absX1 = cx1 * 16;
			const absZ1 = cz1 * 16;
			const absX2 = (cx2 + 1) * 16 - 1;
			const absZ2 = (cz2 + 1) * 16 - 1;

			this.job.areaIndex = i + 1;
			this.job.areaTotal = areas.length;

			this.job.phase = "创建常加载区块";
			this.job.phasePlaced = 0;
			this.job.phaseTotal = 1;
			this.job.phaseBlocksPlaced = 0;
			this.job.phaseBlockTotal = 0;
			try {
				await this.client.runCommand(`/tickingarea add ${absX1} ${origin.y} ${absZ1} ${absX2} ${origin.y + sy - 1} ${absZ2} litematic_${i}`);
			} catch (e) {
				this.client.tellAll(`§cLitematic | §fError > §i[tickingarea add] ${this.rawtext("error.tickingarea")}`);
			}
			const fillX1 = Math.max(absX1, origin.x);
			const fillZ1 = Math.max(absZ1, origin.z);
			const fillX2 = Math.min(absX2, origin.x + sx - 1);
			const fillZ2 = Math.min(absZ2, origin.z + sz - 1);

			const areaPerY = (fillX2 - fillX1 + 1) * (fillZ2 - fillZ1 + 1);
			const maxYLayersPerChunk = Math.floor(FILL_LIMIT / areaPerY);

			this.job.phase = "清除空气";
			const yLayers = maxYLayersPerChunk >= sy ? 1 : Math.ceil(sy / maxYLayersPerChunk);
			this.job.phaseTotal = yLayers;
			this.job.phasePlaced = 0;
			this.job.phaseBlocksPlaced = 0;
			this.job.phaseBlockTotal = 0;

			if (maxYLayersPerChunk >= sy) {
				this.client.sendCommand(`/fill ${fillX1} ${origin.y} ${fillZ1} ${fillX2} ${origin.y + sy - 1} ${fillZ2} air`);
				this.job.phasePlaced = 1;
			} else {
				for (let yStart = 0; yStart < sy; yStart += maxYLayersPerChunk) {
					if (this.job.cancelled) break;
					const yEnd = Math.min(yStart + maxYLayersPerChunk - 1, sy - 1);
					const absY1 = origin.y + yStart;
					const absY2 = origin.y + yEnd;
					this.client.sendCommand(`/fill ${fillX1} ${absY1} ${fillZ1} ${fillX2} ${absY2} ${fillZ2} air`);
					this.job.phasePlaced++;
					await delay(1);
				}
			}
			await delay(1000);

			const chunkRects = [];
			for (const r of rects) {
				const rx1 = r.type === "setblock" ? r.x : r.x1;
				const rx2 = r.type === "setblock" ? r.x : r.x2;
				const rz1 = r.type === "setblock" ? r.z : r.z1;
				const rz2 = r.type === "setblock" ? r.z : r.z2;
				const absRx1 = origin.x + rx1;
				const absRx2 = origin.x + rx2;
				const absRz1 = origin.z + rz1;
				const absRz2 = origin.z + rz2;
				const absRy = origin.y + r.y;

				if (r.type === "setblock") {
					if (absRx1 >= fillX1 && absRx1 <= fillX2 && absRz1 >= fillZ1 && absRz1 <= fillZ2) {
						chunkRects.push({ r, cx1: absRx1, cy1: absRy, cz1: absRz1, cx2: absRx1, cy2: absRy, cz2: absRz1 });
					}
				} else {
					if (absRx2 >= fillX1 && absRx1 <= fillX2 && absRz2 >= fillZ1 && absRz1 <= fillZ2) {
						const cx1 = Math.max(absRx1, fillX1);
						const cz1 = Math.max(absRz1, fillZ1);
						const cx2 = Math.min(absRx2, fillX2);
						const cz2 = Math.min(absRz2, fillZ2);
						const clippedCount = (cx2 - cx1 + 1) * (cz2 - cz1 + 1);
						chunkRects.push({ r, cx1, cy1: absRy, cz1, cx2, cy2: absRy, cz2, clippedCount });
					}
				}
			}

			this.job.phase = "放置方块";
			this.job.phaseTotal = chunkRects.length;
			this.job.phasePlaced = 0;
			this.job.phaseBlocksPlaced = 0;
			this.job.phaseBlockTotal = chunkRects.reduce((sum, cr) => sum + (cr.clippedCount || 1), 0);

			for (const cr of chunkRects) {
				if (this.job.cancelled) break;

				const { r, cx1, cy1, cz1, cx2, cy2, cz2 } = cr;

				if (r.type === "setblock") {
					this.client.sendCommand(`/setblock ${cx1} ${cy1} ${cz1} ${r.cmd}`);
				} else {
					this.client.sendCommand(`/fill ${cx1} ${cy1} ${cz1} ${cx2} ${cy2} ${cz2} ${r.cmd}`);
				}

				this.job.phasePlaced++;
				this.job.phaseBlocksPlaced += cr.clippedCount || 1;

				await delay(1);
			}

			await delay(1000);
			this.job.phase = "删除常加载区块";
			this.job.phasePlaced = 0;
			this.job.phaseTotal = 1;
			this.job.phaseBlocksPlaced = 0;
			this.job.phaseBlockTotal = 0;
			try {
				await this.client.runCommand(`/tickingarea remove litematic_${i}`);
			} catch (e) {
				// ignore
			}
		}

		if (!this.job.cancelled) {
			const elapsed = ((Date.now() - this.job.startTime) / 1000).toFixed(1);
			const speed = Math.round(total / parseFloat(elapsed));
			this.client.tellAll(this.rawtext("litematic.msg.1e401015e2", { p0: file, p1: total, p2: totalCmds, p3: elapsed, p4: speed }));
		} else {
			this.client.tellAll(this.rawtext("litematic.msg.456abddfe1", { p0: file }));
		}
		this.job = null;
	}

	// l:verify <ID> map: 检查任务投影中方块映射错误（无法映射到基岩版的方块，导入时会被跳过）
	verify(id, sender) {
		const task = Litematic.tasks.get(id);
		const data = task.data;
		const unmapped = data.unmappedBlocks || [];
		if (!unmapped.length) {
			this.client.tell(
				this.rawtext("litematic.verify.pass", { p0: id, p1: task.file }), sender
			);
			return;
		}
		const lines = Object.entries(data.unmappedSummary || {})
			.map(([name, cnt]) => `§f${name} §7× §e${cnt}`).join("\n");
		this.client.tell(
			this.rawtext("litematic.verify.report", { p0: id, p1: task.file, p2: unmapped.length, p3: lines }), sender
		);
	}

	// l:verify <ID> world: 检查游戏世界里投影区域与投影数据的差异
	// 对投影的每个非空气方块执行 testforblock 逐块比对，不匹配（被挖掉/替换）即记录
	async verifyWorld(id, sender) {
		const c = this.client;
		const task = Litematic.tasks.get(id);
		const data = task.data;
		const { origin } = task;
		const blocks = data.blocks;
		if (!blocks.length) {
			this.client.tell(this.rawtext("litematic.msg.76219c3773", { p0: id }), sender);
			return;
		}
		const t0 = Date.now();
		const est = Math.ceil(blocks.length / 8);
		this.client.tell(this.rawtext("litematic.msg.4e5ceda6de", { p0: blocks.length, p1: est }), sender);
		const CONC = 4;
		const mismatches = [];
		let checked = 0;
		const delay = ms => new Promise(r => setTimeout(r, ms));
		this.verifyJob = { cancelled: false, taskId: id, fileName: task.file, total: blocks.length, checked: 0, mismatches: 0, startTime: Date.now() };
		try {
			const checkOne = async b => {
				const ax = origin.x + b.x, ay = origin.y + b.y, az = origin.z + b.z;
				const cmd = `testforblock ${ax} ${ay} ${az} ${b.cmd || b.identifier}`;
				let matched = false;
				// testforblock 命令可能被服务器限流丢弃（无响应），超时重试最多 3 次，避免误报差异
				for (let attempt = 0; attempt < 3; attempt++) {
					try {
						const d = await c.runCommand(cmd, 3000);
						if (d?.body?.statusCode === 0) matched = true;
						break;
					} catch {
						if (attempt < 2) await delay(300);
					}
				}
				if (!matched) {
					mismatches.push({ x: ax, y: ay, z: az, expect: b.identifier, cmd: b.cmd || b.identifier });
					this.verifyJob.mismatches = mismatches.length;
				}
				checked++;
				this.verifyJob.checked = checked;
			};
			for (let i = 0; i < blocks.length && !this.verifyJob.cancelled; i += CONC) {
				await Promise.all(blocks.slice(i, i + CONC).map(checkOne));
				if (checked >= 500 && checked % 500 === 0) {
					this.client.tellAll(this.rawtext("litematic.msg.893b86842e", { p0: checked, p1: blocks.length, p2: mismatches.length }));
				}
				await delay(1);
			}
		} finally {
			this.verifyJob = null;
		}
		if (checked === 0) {
			this.client.tell(this.rawtext("litematic.msg.64cbada0a7"), sender);
			return;
		}
		const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
		// 差异列表存档到任务，供 $fix 修复（重新放置期望方块）
		task.mismatches = mismatches;
		if (!mismatches.length) {
			this.client.tell(this.rawtext("litematic.msg.dfacbd8ea0", { p0: id, p1: checked, p2: elapsed }), sender);
			return;
		}
		const list = mismatches.slice(0, 20).map(m => {
			const sp = m.cmd && m.cmd.includes("[") ? m.cmd.slice(m.cmd.indexOf("[")) : "";
			return `§7(${m.x},${m.y},${m.z}) §f期望 §e${m.expect.replace(/^minecraft:/, "")}§f${sp}`;
		}).join("\n");
		this.client.tell(
			this.rawtext("litematic.verify.worldReport", { p0: id, p1: task.file, p2: checked, p3: mismatches.length, p4: elapsed, p5: list }), sender
		);
	}

	// l:fix <ID> [替代方块]: ① 重新放置 verify 发现的被挖掉/替换的方块 ② 替换无法映射的方块
	async fix(id, sender, fb) {
		const c = this.client;
		const task = Litematic.tasks.get(id);
		const data = task.data;
		const delay = ms => new Promise(r => setTimeout(r, ms));
		let n1 = 0, n2 = 0;
		const fixed = [];
		const failed = [];
		// ① 修复世界检查发现的差异（重新放置期望方块）
		const mismatches = task.mismatches || [];
		if (mismatches.length) {
			n1 = mismatches.length;
			const CONC = 4;
			this.fixJob = { cancelled: false, taskId: id, fileName: task.file, total: mismatches.length, done: 0, startTime: Date.now() };
			try {
				const placeOne = async m => {
					const idn = m.expect.replace(/^minecraft:/, "");
					const cmd = `/setblock ${m.x} ${m.y} ${m.z} ${m.cmd || idn}`;
					for (let attempt = 0; attempt < 3; attempt++) {
						try {
							const d = await c.runCommand(cmd, 3000);
							if (d?.body?.statusCode === 0) {
								fixed.push(`§7(${m.x},${m.y},${m.z}) §f→ §e${idn}`);
								this.fixJob.done++;
								return;
							}
						} catch {}
						await delay(300);
					}
					failed.push(m);
					this.fixJob.done++;
				};
				for (let i = 0; i < mismatches.length && !this.fixJob.cancelled; i += CONC) {
					await Promise.all(mismatches.slice(i, i + CONC).map(placeOne));
				}
				// 中断时未处理的差异保留，供再次 $fix 继续
				for (let i = this.fixJob.done; i < mismatches.length; i++) failed.push(mismatches[i]);
			} finally {
				this.fixJob = null;
			}
			task.mismatches = failed;
		}
		// ② 修复无法映射的方块（更新任务数据，供 $y 导入）
		const unmapped = data.unmappedBlocks || [];
		if (unmapped.length) {
			n2 = unmapped.length;
			const bid = fb || "minecraft:stone";
			const idn = bid.replace(/^minecraft:/, "");
			for (const u of unmapped) {
				data.blocks.push({ x: u.x, y: u.y, z: u.z, identifier: bid, state: {}, cmd: idn });
			}
			data.unmappedBlocks = [];
			data.unmappedSummary = {};
		}
		if (!n1 && !n2) {
			this.client.tell(this.rawtext("litematic.msg.d4954caaef", { p0: id }), sender);
			return;
		}
		const lines = [];
		if (n1) {
			lines.push(this.rawtext("litematic.fix.repaired", { p0: fixed.length, p1: n1 }));
			if (failed.length) lines.push(this.rawtext("litematic.fix.failed", { p0: failed.length, p1: id }));
		}
		if (n2) lines.push(this.rawtext("litematic.fix.unmapped", { p0: n2, p1: fb || "minecraft:stone" }));
		if (fixed.length) lines.push(fixed.slice(0, 20).join("\n"));
		this.client.tell(this.rawtext("litematic.msg.e80b25706c", { p0: id, p1: lines.join("\n") }), sender);
	}

	// ---- 预览 ----
	async preview(fileName, sender, x, y, z, mode) {
		const { raw, coords } = this.parsePlacement(x, y, z, mode);
		if (raw === null) {
			this.client.tell(this.rawtext("litematic.msg.8d44701b2a"), sender);
			return;
		}
		if (coords.length > 0 && coords.length < 3) {
			this.client.tell(this.rawtext("litematic.msg.60fce4dc33"), sender);
			return;
		}
		const filePath = path.join(this.config.basePath, fileName.endsWith(".litematic") ? fileName : fileName + ".litematic");
		if (!fs.existsSync(filePath)) {
			this.client.tell(this.rawtext("litematic.msg.4b2a0817b2", { p0: fileName }), sender);
			return;
		}
		this.client.tell(this.rawtext("litematic.msg.4bfbdbb632"), sender);
		let data;
		try {
			data = await parseLitematic(filePath);
		} catch (e) {
			this.client.tell(`§cLitematic | §fError > §i${this.rawtext("error.parse")}`, sender);
			return;
		}
		if (!raw) trimAir(data);
		let origin;
		if (coords.length === 3) {
			origin = { x: Math.floor(Number(coords[0])), y: Math.floor(Number(coords[1])), z: Math.floor(Number(coords[2])) };
		} else {
			try {
				const pos = await this.client.getPosition("@s");
				if (!pos) {
					this.client.tell(this.rawtext("litematic.msg.484ff1f550"), sender);
					return;
				}
				origin = { x: Math.floor(pos.x), y: Math.floor(pos.y) - 1, z: Math.floor(pos.z) };
			} catch {
				this.client.tell(this.rawtext("litematic.msg.484ff1f550"), sender);
				return;
			}
		}
		if (origin.y < -64 || origin.y + data.sy - 1 > 320) {
			this.client.tell(this.rawtext("litematic.msg.6e5483a31a", { p0: origin.y, p1: origin.y + data.sy - 1 }), sender);
			return;
		}
		this.clearPreview();
		this.previewData = { origin, data, file: fileName };
		this.spawnPreviewEntities();
		this.spawnPreviewParticles();
		this.previewTimer = setInterval(() => this.spawnPreviewParticles(), 1500);
		this.client.tell(
			this.rawtext("litematic.preview.info", {
				p0: fileName, p1: data.sx, p2: data.sy, p3: data.sz,
				p4: origin.x, p5: origin.y, p6: origin.z,
				p7: origin.x + data.sx - 1, p8: origin.y + data.sy - 1, p9: origin.z + data.sz - 1,
				p10: data.trimmedAir, p11: raw ? this.rawtext("litematic.preview.raw") : this.rawtext("litematic.preview.trim")
			}), sender
		);
	}

	clearPreview(sender?: string) {
		if (this.previewTimer) { clearInterval(this.previewTimer); this.previewTimer = null; }
		this.previewData = null;
		this.client.sendCommand(`/kill @e[name="§a[LIT]▪"]`);
		this.client.sendCommand(`/kill @e[name="§e[LIT]✦"]`);
		this.client.sendCommand(`/kill @e[name="§b[LIT]INFO"]`);
		if (sender) this.client.tell(this.rawtext("litematic.msg.f0872cf8d1"), sender);
	}

	// 12 条边框边（角点对）
	static previewEdges(x1, y1, z1, x2, y2, z2) {
		return [
			[[x1, y1, z1], [x2, y1, z1]], [[x1, y1, z2], [x2, y1, z2]],
			[[x1, y2, z1], [x2, y2, z1]], [[x1, y2, z2], [x2, y2, z2]],
			[[x1, y1, z1], [x1, y2, z1]], [[x2, y1, z1], [x2, y2, z1]],
			[[x1, y1, z2], [x1, y2, z2]], [[x2, y1, z2], [x2, y2, z2]],
			[[x1, y1, z1], [x1, y1, z2]], [[x2, y1, z1], [x2, y1, z2]],
			[[x1, y2, z1], [x1, y2, z2]], [[x2, y2, z1], [x2, y2, z2]]
		];
	}

	spawnPreviewEntities() {
		const { origin, data } = this.previewData;
		const x1 = origin.x, y1 = origin.y, z1 = origin.z;
		const x2 = x1 + data.sx - 1, y2 = y1 + data.sy - 1, z2 = z1 + data.sz - 1;
		const step = Math.max(3, Math.ceil(Math.max(data.sx, data.sy, data.sz) / 50));
		for (const [px, py, pz] of [[x1, y1, z1], [x2, y1, z1], [x1, y1, z2], [x2, y1, z2], [x1, y2, z1], [x2, y2, z1], [x1, y2, z2], [x2, y2, z2]]) {
			this.client.sendCommand(`/summon text_display ${px} ${py} ${pz} "§e[LIT]✦"`);
		}
		for (const [a, b] of Litematic.previewEdges(x1, y1, z1, x2, y2, z2)) {
			const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
			const len = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
			const n = Math.floor(len / step);
			for (let i = 1; i <= n; i++) {
				this.client.sendCommand(`/summon text_display ${Math.round(a[0] + dx * i / n)} ${Math.round(a[1] + dy * i / n)} ${Math.round(a[2] + dz * i / n)} "§a[LIT]▪"`);
			}
		}
		this.client.sendCommand(`/summon text_display ${Math.floor((x1 + x2) / 2)} ${y2 + 2} ${Math.floor((z1 + z2) / 2)} "§b[LIT]INFO"`);
	}

	spawnPreviewParticles() {
		if (!this.previewData) return;
		const { origin, data } = this.previewData;
		const x1 = origin.x, y1 = origin.y, z1 = origin.z;
		const x2 = x1 + data.sx - 1, y2 = y1 + data.sy - 1, z2 = z1 + data.sz - 1;
		const step = Math.max(3, Math.ceil(Math.max(data.sx, data.sy, data.sz) / 60));
		// 底边 4 条 + 立柱 4 条（顶部省略，避免粒子过多）
		const edges = Litematic.previewEdges(x1, y1, z1, x2, y2, z2).slice(0, 8);
		for (const [a, b] of edges) {
			const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
			const len = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
			const n = Math.floor(len / step);
			for (let i = 0; i <= n; i++) {
				this.client.sendCommand(`/particle minecraft:endrod ${a[0] + dx * i / n + 0.5} ${a[1] + dy * i / n + 0.5} ${a[2] + dz * i / n + 0.5}`);
			}
		}
	}

	// ---- 导出 .mcstructure ----
	async exportStructure(fileName, sender, exportName, mode) {
		let raw = false;
		if (mode === "raw") raw = true;
		else if (mode === "trim") raw = false;
		else if (mode !== undefined) {
			this.client.tell(this.rawtext("litematic.msg.2e53e138da"), sender);
			return;
		}
		if (mode === undefined && exportName === "raw") { raw = true; exportName = undefined; }
		const filePath = path.join(this.config.basePath, fileName.endsWith(".litematic") ? fileName : fileName + ".litematic");
		if (!fs.existsSync(filePath)) {
			this.client.tell(this.rawtext("litematic.msg.4b2a0817b2", { p0: fileName }), sender);
			return;
		}
		this.client.tell(this.rawtext("litematic.msg.4bfbdbb632"), sender);
		let data;
		try {
			data = await parseLitematic(filePath);
		} catch (e) {
			this.client.tell(`§cLitematic | §fError > §i${this.rawtext("error.parse")}`, sender);
			return;
		}
		if (!raw) trimAir(data);
		const name = (exportName || fileName.replace(/\.litematic$/i, "")).replace(/[\\/:*?"<>|]/g, "_");
		const dir = resolvePath("./structures");
		fs.mkdirSync(dir, { recursive: true });
		const outPath = path.join(dir, name + ".mcstructure");
		try {
			fs.writeFileSync(outPath, buildMcStructure(data));
		} catch (e) {
			this.client.tell(`§cLitematic | §fError > §i${this.rawtext("error.export")}`, sender);
			return;
		}
		this.client.tell(
			this.rawtext("litematic.export.info", { p0: outPath, p1: data.sx, p2: data.sy, p3: data.sz, p4: data.blocks.length, p5: data.trimmedAir }), sender
		);
	}

	onDestroy() {
		if (this.job) this.job.cancelled = true;
		if (this.verifyJob) this.verifyJob.cancelled = true;
		if (this.fixJob) this.fixJob.cancelled = true;
		if (this.previewTimer) { clearInterval(this.previewTimer); this.previewTimer = null; }
		this.pending = null;
		this.job = null;
		this.verifyJob = null;
		this.fixJob = null;
		this.previewData = null;
		this.client = null;
	}
}