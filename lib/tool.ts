import type { Client } from "./types/client.js";
import { errorDetail, toUserError } from "./errors.js";

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
	declare rawtext: (key: string, params?: Record<string, unknown>) => string;
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
		prefix = "$",
		tr: (key: string, params?: Record<string, unknown>) => string = (key) => key
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
			const desc = cmd.description || tr("core.help.noDescription");
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
				lines.push(tr("core.help.params") + ": " + paramStr);
			}
		}

		if (p < totalPages) {
			lines.push(tr("core.help.nextPage", { p0: prefix, p1: navCommand, p2: p + 1 }));
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
				this.Command.create("t:help", this.rawtext("core.msg.cc9eeb2606"))
					.addOptionalInteger(this.rawtext("core.param.7b0930e205"))
					.setFunc(async (sender: string, page: number) => {
						const prefix = this.Command.commandPrefix;
						const perm = this.PermissionManager.query(sender);

						const cmdMap = this.client.clientMod?.commands;
						if (!cmdMap) return;

						const cmds = [...cmdMap.normal];
						if (perm >= 1) cmds.push(...cmdMap.user);
						if (perm >= 2) cmds.push(...cmdMap.op);
						if (perm >= 3) cmds.push(...cmdMap.owner);

						const lines = Tool.formatHelp(cmds, page || 1, 5, "t:help", this.rawtext("core.help.title"), prefix, (key, params) => this.rawtext(key, params));
						lines.forEach((line) => this.client.tell(line, sender));
					}),

				this.Command.create("t:search", this.rawtext("core.msg.934897b462"))
					.addString(this.rawtext("core.param.cc1b21e800"), true)
					.addOptionalInteger(this.rawtext("core.param.7b0930e205"))
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
								this.rawtext("core.msg.7a84ff9b79", { p0: keyword }),
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

				this.Command.create("p:query", this.rawtext("core.msg.c08869f963"))
					.addOptionalString(this.rawtext("core.param.9013849179"))
					.setFunc(async (commander: string, queried: string) => {
						const target = queried || commander;
						const permission = this.PermissionManager.query(target);
						this.client.tell(this.rawtext("core.msg.3c6602ee2f", { p0: target, p1: permission }), commander);
					})
			],

			op: [
				this.Command.create("t:send", this.rawtext("core.msg.fde335fd21"))
					.addString(this.rawtext("core.param.acbc5a5d36"), true)
					.setFunc((_: string, text: string) => {
						this.client.tellAll(text);
					}),

				this.Command.create("t:tellall", this.rawtext("core.msg.13a04ca765"))
					.addBoolean(this.rawtext("core.param.136f673d03"), true)
					.setFunc((sender: string, mode: boolean) => {
						const utils = this.client.utils;
						if (!utils || typeof utils.setTellAllMode !== "function") {
							this.client.tell(this.rawtext("core.msg.807e153fc1"), sender);
							return;
						}
						// 未提供参数：显示当前模式
						if (mode === undefined) {
							const cur = utils.getTellAllMode();
							this.client.tell(this.rawtext("core.msg.aae32ad469", { p0: cur ? "转发为 tell" : "按原样广播" }), sender);
							return;
						}
						utils.setTellAllMode(mode);
						this.client.tell(this.rawtext("core.msg.b1f1bb08d1", { p0: mode ? "开启转发" : "恢复原样" }), sender);
					}),

				this.Command.create("t:cmd", this.rawtext("core.msg.9d34ca936d"))
					.addString(this.rawtext("core.param.a95e895a9b"), true)
					.setFunc(async (_: string, command: string) => {
						try {
							const data = await this.client.runCommand(command);
							const status = data.body?.statusCode;
							const msg = data.body?.statusMessage || "无返回消息";
							this.client.tellAll(`§eTool | §fCommand > §i[${status}] ${msg}`);
						} catch (e) {
							console.error(`t:cmd failed: ${errorDetail(e)}`);
							this.client.tellAll(`§cTool | §fError > §i${toUserError(e, this.rawtext("core.error.command"))}`);
						}
					})
			],

			owner: [
				this.Command.create("p:add", this.rawtext("core.msg.14461c82f5"))
					.addString(this.rawtext("core.param.56ee7d07b1"), true)
					.addString(this.rawtext("core.param.9013849179"), true)
					.setFunc(async (_: string, object: string, value: string) => {
						const result = await this.PermissionManager.add(object, value);
						if (result instanceof Error) {
							this.client.tellAll(`§cPermission | §fError > §i${toUserError(result, this.rawtext("core.error.permission"))}`);
							return;
						}
						this.client.tellAll(`§ePermission | §fAdd > §i${value} -> ${object}`);
					}),

				this.Command.create("p:remove", this.rawtext("core.msg.05850b4973"))
					.addString(this.rawtext("core.param.56ee7d07b1"), true)
					.addString(this.rawtext("core.param.9013849179"), true)
					.setFunc(async (_: string, object: string, value: string) => {
						const result = await this.PermissionManager.remove(object, value);
						if (result instanceof Error) {
							this.client.tellAll(`§cPermission | §fError > §i${toUserError(result, this.rawtext("core.error.permission"))}`);
							return;
						}
						this.client.tellAll(`§ePermission | §fRemove > §i${value} <- ${object}`);
					}),

				this.Command.create("t:ping", this.rawtext("core.msg.8afb414481")).setFunc(() => {
					const start = Date.now();
					this.client
						.runCommand("list")
						.then(() => {
							const ms = Date.now() - start;
							this.client.tellAll(`§eTool | §fPing > §i${ms}ms`);
						})
						.catch(() => {
							this.client.tellAll(this.rawtext("core.msg.0f4edba4c2"));
						});
				}),

				this.Command.create("t:time", this.rawtext("core.msg.152b57845f")).setFunc((sender: string) => {
					const bj = new Date(Date.now() + 8 * 3600 * 1000);
					const pad = (n: number): string => String(n).padStart(2, "0");
					const date = `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())}`;
					const time = `${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}:${pad(bj.getUTCSeconds())}`;
					this.client.tell(`§eTool | §fTime > §i${date} ${time}`, sender);
				}),

				this.Command.create("t:start", this.rawtext("core.msg.4aae5f9c09")).setFunc(async (sender: string) => {
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

					this.client.tell(this.rawtext("core.msg.35849702b4", { p0: hubs.size }), sender);
				}),

				this.Command.create("t:move", this.rawtext("core.msg.3b07d9a276")).setFunc((sender: string) => {
					const oldClient = this.Current.client;
					if (!oldClient) {
						this.client.tell(this.rawtext("core.msg.04e2677e9d"), sender);
						return;
					}
					if (oldClient === this.client) {
						this.client.tell(this.rawtext("core.msg.bdd0f159a5"), sender);
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

					this.client.tellAll(this.rawtext("core.msg.ac46e35c76", { p0: sender }));
				}),

				this.Command.create("t:reload", this.rawtext("core.msg.914a62f6e2"))
					.addOptionalString(this.rawtext("core.param.72b49265ed"))
					.setFunc(async (sender: string, modName: string) => {
						const client = this.client;
						// 先按磁盘最新 config.json 刷新内存配置（支持运行中改文件后热更新）
						try {
							this.reloadConfig();
						} catch (e) {
							client.tell(`§cTool | §fError > §i${toUserError(e, this.rawtext("core.error.configReload"))}`, sender);
							return;
						}
						if (modName) {
							const manager = client.clientMod;
							if (!manager) {
								client.tell(this.rawtext("core.msg.26ad246d3b"), sender);
								return;
							}
							const result = await manager.reload(modName);
							client.tellAll(`§eTool | §fReload > §i${result.message}`);
						} else {
							const result = await this.ClientModManager.reloadAllClients();
							client.tellAll(
								this.rawtext("core.msg.c5e76d2abe", { p0: result.success.length || 0, p1: result.failed.length || 0 })
							);
							if (result.failed.length > 0) {
								result.failed.forEach((f) => client.tellAll(`§cTool | §fError > §i${f}`));
							}
						}
					}),

				this.Command.create("t:mod", this.rawtext("core.msg.a2a7f123ee")).setFunc((sender: string) => {
					const client = this.client;
					const modNames = Object.keys(this.ClientModManager.loadedMod || {});
					client.tell(this.rawtext("core.msg.06b9b3aee2", { p0: modNames.length }), sender);
					if (modNames.length === 0) {
						client.tell(this.rawtext("core.msg.b624002cd2"), sender);
					} else {
						modNames.forEach((name) => client.tell(`§f${name}`, sender));
					}
				}),

				this.Command.create("t:exec", this.rawtext("core.msg.ae4b234e0d"))
					.addString(this.rawtext("core.param.a95e895a9b"), true)
					.setFunc((_: string, command: string) => {
						if (this.config?.command?.allowShellExec !== true) {
							this.client.tellAll(this.rawtext("core.msg.0892755781"));
							return;
						}
						this.exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
							if (error) {
								console.error(`t:exec failed: ${errorDetail(error)}`);
								this.client.tellAll(`§cTool | §fexec > §i${toUserError(error, this.rawtext("core.error.command"))}`);
							}
							const output = stdout || stderr || "";
							const lines = output.split("\n").filter((l) => l.length > 0);

							this.client.tellAll(this.rawtext("core.msg.3fb2f425f4", { p0: lines.length }));
							if (lines.length === 0) {
								this.client.tellAll(this.rawtext("core.msg.56b4d8de5f"));
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
