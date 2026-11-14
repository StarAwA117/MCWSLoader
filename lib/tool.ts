import type { Client } from "../types/client.js";

type CommandClass = import("./command.js").default;
interface CommandConstructor {
	commandPrefix: string;
	create(name: string, description?: string | null): CommandClass;
}
type PermissionManagerClass = typeof import("./permission.js").default;
type CurrentClass = typeof import("./current.js").default;
type ServerModManagerClass = typeof import("./mods.js").ServerModManager;
type ClientModManagerClass = typeof import("./mods.js").ClientModManager;

/**
 * 内置客户端 Mod：命令帮助、搜索、权限查询与客户端控制。
 *
 * 依赖（Command/PermissionManager/...）由 mods.ts 在实例化后注入。
 */
export default class Tool {
	client: Client;

	declare Command: CommandConstructor;
	declare PermissionManager: PermissionManagerClass;
	declare Current: CurrentClass;
	declare ServerModManager: ServerModManagerClass;
	declare ClientModManager: ClientModManagerClass;
	declare reloadConfig: () => unknown;
	declare exec: typeof import("node:child_process").exec;
	declare config: Record<string, any>;

	/**
	 * 格式化命令帮助列表
	 * @param commands 命令对象数组
	 * @param page 页码（从 1 开始）
	 * @param perPage 每页显示数量
	 * @param navCommand 翻页导航命令（不含页码）
	 * @param title 列表标题
	 */
	static formatHelp(
		commands: CommandClass[],
		page = 1,
		perPage = 5,
		navCommand = "t:help",
		title = "命令帮助",
		prefix = "$"
	): string[] {
		const sorted = [...commands].sort((a, b) => {
			if (a.name === "t:help") return -1;
			if (b.name === "t:help") return 1;
			return a.name.localeCompare(b.name);
		});

		const total = sorted.length;
		const totalPages = Math.max(1, Math.ceil(total / perPage));
		const p = Math.min(Math.max(1, page), totalPages);
		const start = (p - 1) * perPage;
		const pageItems = sorted.slice(start, start + perPage);

		const lines: string[] = [];
		lines.push(`§d─── ${prefix}${title} §f[${p}/${totalPages}] §d───`);

		for (const cmd of pageItems) {
			const desc = cmd.description || "§7无描述";
			lines.push(`§c${prefix}${cmd.name} §f- §b${desc}`);
			if (cmd.parameters.length > 0) {
				const paramStr = cmd.parameters
					.map((param) => {
						const [type, paramDesc, optional] = param;
						const typeName = Array.isArray(type) ? type.join("|") : type;
						const descPart = paramDesc ? ` §7${paramDesc}` : "";
						return optional
							? `§u(${typeName}§u)${descPart}`
							: `§b${typeName}${descPart}`;
					})
					.join(" ");
				lines.push(`  §iParams: ${paramStr}`);
			}
		}

		if (p < totalPages) {
			lines.push(`§7输入 ${prefix}${navCommand} ${p + 1} 查看下一页`);
		}
		return lines;
	}

	constructor(client: Client) {
		this.client = client;
	}

	onCommand(): {
		normal: CommandClass[];
		op: CommandClass[];
		owner: CommandClass[];
	} {
		return {
			normal: [
				this.Command.create("t:help", "查看命令帮助")
					.addOptionalInteger("页码")
					.setFunc(async (sender: string, page: number) => {
						const prefix = this.Command.commandPrefix;
						const perm = this.PermissionManager.query(sender);

						const cmdMap = this.client.clientMod?.commands;
						if (!cmdMap) return;

						const cmds = [...cmdMap.normal];
						if (perm >= 1) cmds.push(...cmdMap.user);
						if (perm >= 2) cmds.push(...cmdMap.op);
						if (perm >= 3) cmds.push(...cmdMap.owner);

						const lines = Tool.formatHelp(cmds, page || 1, 5, "t:help", "命令帮助", prefix);
						lines.forEach((line) => this.client.tell(line, sender));
					}),

				this.Command.create("t:search", "搜索命令")
					.addString("关键词", true)
					.addOptionalInteger("页码")
					.setFunc(async (sender: string, keyword: string, page: number) => {
						const prefix = this.Command.commandPrefix;
						const perm = this.PermissionManager.query(sender);

						const cmdMap = this.client.clientMod?.commands;
						if (!cmdMap) return;

						const cmds = [...cmdMap.normal];
						if (perm >= 1) cmds.push(...cmdMap.user);
						if (perm >= 2) cmds.push(...cmdMap.op);
						if (perm >= 3) cmds.push(...cmdMap.owner);

						const kw = keyword.toLowerCase();
						const matched = cmds.filter(
							(cmd) =>
								cmd.name.toLowerCase().includes(kw) ||
								(cmd.description ?? "").toLowerCase().includes(kw)
						);

						if (!matched.length) {
							this.client.tell(
								`§cTool | §fSearch > §i没有找到与 "${keyword}" 相关的命令`,
								sender
							);
							return;
						}

						const lines = Tool.formatHelp(
							matched,
							page || 1,
							5,
							`t:search ${keyword}`,
							`命令搜索 "${keyword}"`,
							prefix
						);
						lines.forEach((line) => this.client.tell(line, sender));
					}),

				this.Command.create("p:query", "查询权限等级（不带参数查询自身）")
					.addOptionalString("账号")
					.setFunc(async (commander: string, queried: string) => {
						const target = queried || commander;
						const permission = this.PermissionManager.query(target);
						this.client.tell(`§ePermission | §fQuery > §i${target} 权限: ${permission}`, commander);
					})
			],

			op: [
				this.Command.create("t:send", "向外部发送消息")
					.addString("消息内容", true)
					.setFunc((_: string, text: string) => {
						this.client.tellAll(text);
					}),

				this.Command.create("t:tellall", "查看/切换本客户端 tellAll 转发模式")
					.addBoolean("模式 (true=转发为 tell false=原样)", true)
					.setFunc((sender: string, mode: boolean) => {
						const utils = this.client.utils;
						if (!utils || typeof utils.setTellAllMode !== "function") {
							this.client.tell("§cTool | §fError > §i当前客户端不支持此设置", sender);
							return;
						}
						// 未提供参数：显示当前模式
						if (mode === undefined) {
							const cur = utils.getTellAllMode();
							this.client.tell(`§eTool | §fTellAll > §i当前 ${cur ? "转发为 tell" : "按原样广播"}`, sender);
							return;
						}
						utils.setTellAllMode(mode);
						this.client.tell(`§eTool | §fTellAll > §i已${mode ? "开启转发" : "恢复原样"}`, sender);
					}),

				this.Command.create("t:cmd", "执行基岩版命令")
					.addString("命令内容", true)
					.setFunc(async (_: string, command: string) => {
						try {
							const data = await this.client.runCommand(command);
							const status = data.body?.statusCode;
							const msg = data.body?.statusMessage || "无返回消息";
							this.client.tellAll(`§eTool | §fCommand > §i[${status}] ${msg}`);
						} catch (e) {
							this.client.tellAll(`§cTool | §fError > §i命令执行失败: ${(e as Error).message}`);
						}
					})
			],

			owner: [
				this.Command.create("p:add", "添加指定账号权限")
					.addString("权限类型", true)
					.addString("账号", true)
					.setFunc(async (_: string, object: string, value: string) => {
						const result = await this.PermissionManager.add(object, value);
						if (result instanceof Error) {
							this.client.tellAll(`§cPermission | §fError > §i${result.message}`);
							return;
						}
						this.client.tellAll(`§ePermission | §fAdd > §i${value} -> ${object}`);
					}),

				this.Command.create("p:remove", "删除指定账号权限")
					.addString("权限类型", true)
					.addString("账号", true)
					.setFunc(async (_: string, object: string, value: string) => {
						const result = await this.PermissionManager.remove(object, value);
						if (result instanceof Error) {
							this.client.tellAll(`§cPermission | §fError > §i${result.message}`);
							return;
						}
						this.client.tellAll(`§ePermission | §fRemove > §i${value} <- ${object}`);
					}),

				this.Command.create("t:ping", "检测与服务器的延迟").setFunc(() => {
					const start = Date.now();
					this.client
						.runCommand("list")
						.then(() => {
							const ms = Date.now() - start;
							this.client.tellAll(`§eTool | §fPing > §i${ms}ms`);
						})
						.catch(() => {
							this.client.tellAll("§cTool | §fError > §i命令执行失败");
						});
				}),

				this.Command.create("t:time", "查看当前时间（北京时间）").setFunc((sender: string) => {
					const bj = new Date(Date.now() + 8 * 3600 * 1000);
					const pad = (n: number): string => String(n).padStart(2, "0");
					const date = `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())}`;
					const time = `${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}:${pad(bj.getUTCSeconds())}`;
					this.client.tell(`§eTool | §fTime > §i${date} ${time}`, sender);
				}),

				this.Command.create("t:start", "重新开始 SAPI 轮询").setFunc(async (sender: string) => {
					// 重置当前客户端与主客户端的统一 SAPI 轮询器
					const hubs = new Set<import("./sapi.js").SAPIMessageHandler>();
					const localHub = this.client.clientMod?.sapi;
					const mainHub = this.Current.client?.clientMod?.sapi;
					if (localHub) hubs.add(localHub);
					if (mainHub) hubs.add(mainHub);

					for (const hub of hubs) {
						hub.commandExists = null;
						hub.start();
					}

					this.client.tell(`§eTool | §fSAPI > §i已重新开始 ${hubs.size} 个 SAPI 轮询器`, sender);
				}),

				this.Command.create("t:move", "将当前客户端设为主客户端").setFunc((sender: string) => {
					const oldClient = this.Current.client;
					if (!oldClient) {
						this.client.tell("§cTool | §fError > §i当前没有主客户端", sender);
						return;
					}
					if (oldClient === this.client) {
						this.client.tell("§cTool | §fError > §i你已经是主客户端", sender);
						return;
					}

					const oldMods = this.Current.clientMods.get(oldClient);
					if (oldMods) {
						oldMods.destroy();
						this.Current.clientMods.delete(oldClient);
					}

					try {
						oldClient.close();
					} catch {
						// ignore
					}

					// 主客户端切换后通知所有服务端 Mod 并重新挂载 SAPI
					this.ServerModManager.onMainClientSwitch(oldClient, this.client);
					this.Current.client = this.client;
					this.ServerModManager.attachMainClient(this.client);

					this.client.tellAll(`§eTool | §fMove > §i主客户端已切换至 ${sender}`);
				}),

				this.Command.create("t:reload", "重载客户端 Mod（带名称重载单个，不带重载全部客户端）")
					.addOptionalString("Mod 名称")
					.setFunc(async (sender: string, modName: string) => {
						const client = this.client;
						// 先按磁盘最新 config.json 刷新内存配置（支持运行中改文件后热更新）
						try {
							this.reloadConfig();
						} catch (e) {
							client.tell(`§cTool | §fError > §i配置刷新失败: ${(e as Error).message}`, sender);
							return;
						}
						if (modName) {
							const manager = client.clientMod;
							if (!manager) {
								client.tell("§cTool | §fError > §i无法重载：客户端 Mod 管理器不可用", sender);
								return;
							}
							const result = await manager.reload(modName);
							client.tellAll(`§eTool | §fReload > §i${result.message}`);
						} else {
							const result = await this.ClientModManager.reloadAllClients();
							client.tellAll(
								`§eTool | §fReload > §i客户端 Mod 全量重载完成 成功: ${result.success.length || 0} 失败: ${result.failed.length || 0}`
							);
							if (result.failed.length > 0) {
								result.failed.forEach((f) => client.tellAll(`§cTool | §fError > §i${f}`));
							}
						}
					}),

				this.Command.create("t:mod", "显示所有客户端 Mod").setFunc((sender: string) => {
					const client = this.client;
					const modNames = Object.keys(this.ClientModManager.loadedMod || {});
					client.tell(`§eTool | §fMods > §i共 ${modNames.length} 个`, sender);
					if (modNames.length === 0) {
						client.tell("§i无", sender);
					} else {
						modNames.forEach((name) => client.tell(`§f${name}`, sender));
					}
				}),

				this.Command.create("t:exec", "在服务器终端执行命令")
					.addString("命令内容", true)
					.setFunc((_: string, command: string) => {
						if (this.config?.command?.allowShellExec !== true) {
							this.client.tellAll("§cTool | §fError > §it:exec 已被禁用（config.command.allowShellExec = false）");
							return;
						}
						this.exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
							if (error) {
								this.client.tellAll(`§cTool | §fexec > §i${error.message}`);
							}
							const output = stdout || stderr || "";
							const lines = output.split("\n").filter((l) => l.length > 0);

							this.client.tellAll(`§eTool | §fexec > §i共 ${lines.length} 行`);
							if (lines.length === 0) {
								this.client.tellAll("§i(无输出)");
								return;
							}

							lines.forEach((line) => this.client.tellAll(line));
						});
					})
			]
		};
	}

	onDestroy(): void {
		// 管理器会丢弃实例；这里无需手动清空 client
	}
}
