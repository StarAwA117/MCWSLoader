import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as V from "@pureeval/voxel-geometry";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCRIPTS_DIR = path.join(__dirname, "scripts");

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function groupByY(space) {
	const map = new Map();
	for (const pos of space) {
		const key = pos.y;
		if (!map.has(key)) map.set(key, []);
		map.get(key).push(pos);
	}
	return map;
}

function fillRanges(client, defaultBlock, origin, points) {
	if (!points.length) return;
	const ox = (origin && typeof origin === "object") ? (origin.x || 0) : 0;
	const oy = (origin && typeof origin === "object") ? (origin.y || 0) : 0;
	const oz = (origin && typeof origin === "object") ? (origin.z || 0) : 0;
	const sorted = points.slice().sort((a, b) => a.x - b.x || a.z - b.z);
	const y = sorted[0].y;
	let start = sorted[0];
	let prev = sorted[0];

	const flush = () => {
		if (!start || !prev) return;
		const x1 = start.x + ox;
		const z1 = start.z + oz;
		const x2 = prev.x + ox;
		const z2 = prev.z + oz;
		if (x1 === x2 && z1 === z2) {
			client.sendCommand(`setblock ${x1} ${y + oy} ${z1} ${defaultBlock}`).catch(() => {});
		} else {
			client.sendCommand(`fill ${x1} ${y + oy} ${z1} ${x2} ${y + oy} ${z2} ${defaultBlock}`).catch(() => {});
		}
	};

	for (let i = 1; i < sorted.length; i++) {
		const cur = sorted[i];
		if (cur.x === prev.x + 1 && cur.z === prev.z) {
			prev = cur;
		} else {
			flush();
			start = cur;
			prev = cur;
		}
	}
	flush();
}

function setBlocks(client, defaultBlock, origin) {
	return (arg) => {
		if (typeof arg === "string") {
			return (space) => {
				const byY = groupByY(space);
				for (const [y, pts] of byY) {
					fillRanges(client, arg, origin, pts);
				}
			};
		}
		const byY = groupByY(arg);
		for (const [y, pts] of byY) {
			fillRanges(client, defaultBlock, origin, pts);
		}
	};
}

function tellRaw(client, ...messages) {
	const text = messages.join("\n");
	client.sendCommand(`tellraw @s {"rawtext":[{"text":"§e${text}"}]}`).catch(() => {});
}

function broadcast(client, ...messages) {
	const text = messages.join("\n");
	client.sendCommand(`tellraw @a {"rawtext":[{"text":"§e${text}"}]}`).catch(() => {});
}

export default class FastBuilder {
	constructor(client) {
		this.client = client;
		this.modName = "FastBuilder";
		this.config = {};
		this.bindCommands();
	}

	bindCommands() {
		this.onCommand = () => ({
			op: [
				this.Command.create("fb:run", "执行 FastBuilder 脚本")
					.addString("脚本内容或文件名", true)
					.setFunc(async (sender, input) => {
						await this.runScript(sender, input);
					}),

				this.Command.create("fb:runthis", "以玩家当前位置为中心执行 FastBuilder 脚本")
					.addString("脚本内容或文件名", true)
					.setFunc(async (sender, input) => {
						const pos = await this.getPlayerPosition(sender);
						await this.runScript(sender, input, pos);
					}),

				this.Command.create("fb:list", "列出 FastBuilder 可用脚本")
					.setFunc(async (sender) => {
						if (!fs.existsSync(SCRIPTS_DIR)) {
							this.client.tell("§eFastBuilder | §fList > §i暂无脚本", sender);
							return;
						}
						const files = fs.readdirSync(SCRIPTS_DIR).filter(f => f.endsWith(".js"));
						if (files.length === 0) {
							this.client.tell("§eFastBuilder | §fList > §i暂无脚本", sender);
							return;
						}
						this.client.tell(`§eFastBuilder | §fList > §i共 ${files.length} 个脚本:`, sender);
						for (const file of files) {
							this.client.tell(`§f  - ${file}`, sender);
						}
					})
			]
		});
	}

	async getPlayerPosition(sender) {
		try {
			const pos = await this.client.getPosition("@p");
			if (pos && typeof pos === "object") {
				return { x: pos.x || 0, y: pos.y || 0, z: pos.z || 0 };
			}
		} catch {}
		return { x: 0, y: 0, z: 0 };
	}

	async runScript(sender, input, overrideOrigin = null) {
		const scriptPath = path.join(SCRIPTS_DIR, input);
		let code = input;

		if (fs.existsSync(scriptPath)) {
			try {
				code = fs.readFileSync(scriptPath, "utf-8");
				this.client.tell(`§eFastBuilder | §fRun > §i加载脚本: ${input}`, sender);
			} catch (e) {
				this.client.tell(`§cFastBuilder | §fError > §i读取脚本失败: ${e.message}`, sender);
				return;
			}
		}

		const session = this.client;
		const cfg = this.config || {};
		const defaultBlock = (cfg.defaultBlock && typeof cfg.defaultBlock === "string") ? cfg.defaultBlock : "iron_block";
		const cfgOrigin = (cfg.origin && typeof cfg.origin === "object") ? cfg.origin : { x: 0, y: 0, z: 0 };
		const origin = overrideOrigin || cfgOrigin;
		const particle = (cfg.particle && typeof cfg.particle === "string") ? cfg.particle : "minecraft:explosion";
		const sandbox = {
			...V.Generator,
			...V.Exp,
			...V.Transform,
			...V.LSystem,
			...V.IFS,
			...V.DLA,
			vec3: (x, y, z) => ({ x, y, z }),
		setBlocks: setBlocks(session, defaultBlock, origin),
			tell_raw: (...msg) => tellRaw(session, ...msg),
			broadcast: (...msg) => broadcast(session, ...msg),
			pos: () => this.getPlayerPosition(sender),
			setting: {
				block: defaultBlock,
				origin,
				particle
			}
		};

		try {
			this.client.tell("§eFastBuilder | §fRun > §i正在执行脚本...", sender);
			const body = `with(inside) { ${code} }`;
			const fn = new Function("inside", body);
			const result = fn(sandbox);
			if (result instanceof Promise) {
				await result;
			}
			this.client.tell("§eFastBuilder | §fRun > §i执行完成", sender);
		} catch (e) {
			this.client.tell(`§cFastBuilder | §fError > §i${e.message}`, sender);
		}
	}
}
