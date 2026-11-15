import ModBase from "../../lib/modbase.js";
import fs from "fs";
import path from "path";

// Minecraft 函数文件执行类
// 支持加载和执行 .mcfunction 格式的指令文件，支持嵌套调用和循环执行
export default class MCFunc extends ModBase {
	constructor(client) {
		super();
		this.client = client;
		// 存储循环执行的定时器
		this.loops = new Map();
	}

	// 返回命令定义
	onCommand() {
		return {
			op: [
this.Command.create("f:function", this.rawtext("command.fFunction"))
				.addString(this.rawtext("mcfunc.param.0fd3a9b4ea"))
				.setFunc((_, filePath) => {
					this.run(filePath);
				}),

this.Command.create("f:loop", this.rawtext("command.fLoop"))
				.addString(this.rawtext("mcfunc.param.0fd3a9b4ea"))
				.addString(this.rawtext("mcfunc.param.f330f510c5"), true)
				.addFloat(this.rawtext("mcfunc.param.f4fdfcf6f7"), true)
				.setFunc((_, filePath, name, interval) => {
					this.loop(filePath, name, interval);
				}),

this.Command.create("f:stop", this.rawtext("command.fStop"))
				.addOptionalString(this.rawtext("mcfunc.param.f330f510c5"))
				.setFunc((_, name) => {
					this.stop(name);
				})
			]
		};
	}

	// 加载函数文件
	// 返回按行分割的指令数组，失败返回 false
	async load(fileName) {
		try {
			const file = await fs.promises.readFile(path.join(this.config.basePath, fileName), "utf-8");
			const commands = file.split("\n");
			return commands;
		} catch {
			return false;
		}
	}

	// 执行函数文件
	// deep: 当前嵌套深度（防止无限递归，上限 16）
	// commands: 已加载的指令数组（首次调用时为 null，内部加载）
	async run(fileName, deep = 0, commands = null) {
		if (!this.client) return;
		if (!commands) {
			commands = await this.load(fileName);

			if (!commands) {
				this.client.tellAll(`§cMCFunc | §fError > §i${this.rawtext("mcfunc.loadFailed", { name: fileName })}`);
				return;
			}

			if (deep === 0) {
				this.client.tellAll(`§eMCFunc | §fRun > §i${this.rawtext("mcfunc.running", { name: fileName })}`);
			}
		}
		

		// 嵌套深度限制
		if (deep >= 16) return;

		for (const command of commands) {
			// 跳过注释行（以 # 开头）
			if (command.startsWith("#")) continue;

			// 嵌套调用其他函数文件
			if (command.startsWith("function ")) {
				await this.run(command.slice("function ".length), deep + 1);
				continue;
			}

			// 执行普通指令
			await this.client.sendCommand(command);
		}
	}

	// 循环执行函数文件
	// loopName: 循环标识名称
	// loopInterval: 循环间隔（秒），未指定则默认 50ms（1 游戏刻）
	async loop(fileName, loopName = null,  loopInterval = null) {
		if (!this.client) return;
		// 未指定名称时使用文件名作为循环名
		if (!loopName) loopName = fileName;

		const commands = await this.load(fileName);

		if (!commands) {
			this.client.tellAll(`§cMCFunc | §fError > §i${this.rawtext("mcfunc.loadFailed", { name: fileName })}`);
			return;
		}

		// 检查循环名是否已存在
		if (this.loops.has(loopName)) {
			this.client.tellAll(`§cMCFunc | §fError > §i${this.rawtext("mcfunc.loopExists", { name: loopName })}`);
			return;
		}

		// 默认间隔 50ms（1 游戏刻），否则将秒转换为毫秒（负数/异常值按 0 处理，避免 setInterval 空转）
		if (!loopInterval || !(loopInterval > 0)) {
			loopInterval = 50;
		} else {
			loopInterval *= 1000;
		}

		this.client.tellAll(`§eMCFunc | §fLoop > §i${this.rawtext("mcfunc.loopStarted", { name: loopName })}`);

		// 创建定时器循环执行；上一轮未结束时跳过本轮，避免慢脚本堆积
		const entry = { timer: null, running: false };
		entry.timer = setInterval(async () => {
			if (!this.client || entry.running) return;
			entry.running = true;
			try {
				await this.run(fileName, 0, commands);
			} catch (e) {
				this.logger.error(`MCFunc loop ${loopName} failed: ${e?.stack ?? e?.message ?? e}`);
			} finally {
				entry.running = false;
			}
		}, loopInterval);
		this.loops.set(loopName, entry);
	}

	// 停止循环
	// loopName: 指定循环名停止，为 null 时停止全部
	stop(loopName = null) {
		if (loopName === null || loopName === undefined) {
			// 停止所有循环
			for (const loop of this.loops.values()) {
				clearInterval(loop.timer);
			}

			this.loops.clear();
			this.client.tellAll(`§eMCFunc | §fLoop > §i${this.rawtext("mcfunc.allStopped")}`);
			return;
		}

		if (this.loops.has(loopName)) {
			const loop = this.loops.get(loopName);
			clearInterval(loop.timer);
			this.loops.delete(loopName);

			this.client.tellAll(`§eMCFunc | §fLoop > §i${this.rawtext("mcfunc.loopStopped", { name: loopName })}`);
		} else {
			this.client.tellAll(`§cMCFunc | §fError > §i${this.rawtext("mcfunc.loopMissing", { name: loopName })}`);
		}
	}

	// 销毁方法 - 停止所有循环并释放引用
	onDestroy() {
		this.stop();
		this.client = null;
	}
}


