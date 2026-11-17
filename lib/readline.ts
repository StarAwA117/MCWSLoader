import readline from "node:readline";
import { appendAppLog, logger } from "./logger.js";
import Command from "./command.js";
import Current from "./current.js";
import { reloadConfig, config } from "./mods.js";
import { tCore, tForMod } from "./texts.js";
import { errorDetail, toUserError } from "./errors.js";
type ServerModManagerClass = typeof import("./mods.js").ServerModManager;
type ClientModManagerClass = typeof import("./mods.js").ClientModManager;

// 终端命令（内置 + 服务端 Mod 自动收集）
const commands: { normal: Command[]; ws: Command[] } = { normal: [], ws: [] };

let rl: readline.Interface | null = null;

function tr(key: string, params?: Record<string, unknown>): string {
	return tForMod(null, config.language, key, params);
}

/**
 * 收集所有服务端 Mod 的终端命令（加载后调用）
 * 服务端 Mod 可定义 onTerminalCommand() 或 static onTerminalCommand()
 */
export function collectCommands(
	ServerModManager: ServerModManagerClass,
	ClientModManager: ClientModManagerClass
): void {
	commands.normal = [];
	commands.ws = [];

	// 内置 p: 命令
	commands.normal.push(
		Command.create("test", tr("terminal.test.description")).setFunc(() => {
			console.log(`< ${tr("terminal.test.success")}`);
		}),

		Command.create("p:list", tr("terminal.list.description")).setFunc(() => {
			if (Current.clientMods.size === 0) {
				console.log(`< ${tr("terminal.list.empty")}`);
				return;
			}
			console.log(`< ${tr("terminal.list.title", { count: Current.clientMods.size })}`);
			let index = 0;
			for (const [ws] of Current.clientMods) {
				index += 1;
				const isMain = ws === Current.client ? tr("terminal.list.mainClient") : tr("terminal.list.number", { index });
				const ip = ws._socket?.remoteAddress || tr("terminal.list.unknownIp");
				console.log(`  §b${isMain} §f- §e${ip}`);
			}
		}),

		Command.create("p:reload", tr("terminal.reload.description")).setFunc(
			async () => {
				console.log(`< ${tr("terminal.reload.start")}`);
				try {
					reloadConfig();
					console.log(`< §a${tr("terminal.reload.config")}`);
				} catch (e) {
					console.error(`< §c${tr("terminal.reload.configFailed")}: ${toUserError(e)}`);
					return;
				}
				const serverResult = await ServerModManager.reloadAll();
				console.log(`< §a${tr("terminal.reload.serverSuccess", { names: serverResult.success.join(", ") || tr("terminal.reload.none") })}`);
				if (serverResult.failed.length > 0) {
					console.error(`< §c${tr("terminal.reload.serverFailed", { names: serverResult.failed.join(", ") })}`);
				}

				const clientResult = await ClientModManager.reloadAllClients();
				console.log(`< §a${tr("terminal.reload.clientSuccess", { count: clientResult.success.length || 0 })}`);
				if (clientResult.failed.length > 0) {
					console.error(`< §c${tr("terminal.reload.clientFailed")}`);
					clientResult.failed.forEach((f) => console.error(`  §c${f}`));
				}

				// 重载后重新收集终端命令，避免闭包指向已卸载的旧实例
				collectCommands(ServerModManager, ClientModManager);
			}
		),

		Command.create("p:mod", tr("terminal.mods.description")).setFunc(() => {
			const serverMods = ServerModManager.getLoadedModNames();
			console.log(`< ${tr("terminal.mods.server", { count: serverMods.length })}`);
			if (serverMods.length === 0) {
				console.log(`  §7${tr("terminal.mods.none")}`);
			} else {
				serverMods.forEach((name) => console.log(`  §b${name}`));
			}

			const clientMods = Object.keys(ClientModManager.loadedMod ?? {});
			console.log(`< ${tr("terminal.mods.client", { count: clientMods.length })}`);
			if (clientMods.length === 0) {
				console.log(`  §7${tr("terminal.mods.none")}`);
			} else {
				clientMods.forEach((name) => console.log(`  §b${name}`));
			}
		})
	);

	// 从服务端 Mod 收集终端命令（onTerminalCommand）
	const inst = ServerModManager._instance;
	if (!inst) return;

	for (const [name, instance] of Object.entries(inst.modInstances)) {
		const commandMethod = instance.onTerminalCommand || (instance.constructor as unknown as Record<string, unknown> | undefined)?.onTerminalCommand;
		if (typeof commandMethod !== "function") continue;

		let cmdMap: Record<string, unknown>;
		try {
			cmdMap = commandMethod.call(instance) as Record<string, unknown>;
		} catch (e) {
			logger.error(`Server Mod ${name} 命令收集失败: ${(e as Error).message}`);
			logger.debug((e as Error).stack ?? (e as Error).message);
			continue;
		}
		if (!cmdMap || typeof cmdMap !== "object") {
			logger.warning(`Server Mod ${name} onTerminalCommand() did not return an object`);
			continue;
		}

		for (const bucket of ["normal", "ws"] as const) {
			const list = cmdMap[bucket];
			if (list === undefined) continue;
			if (!Array.isArray(list)) {
				logger.warning(`Server Mod ${name} returned a non-array "${bucket}" terminal command bucket`);
				continue;
			}
			for (const cmd of list as Command[]) {
				if (!cmd || typeof cmd.name !== "string" || typeof cmd.execute !== "function") {
					logger.warning(`Server Mod ${name} registered an invalid terminal command in "${bucket}"`);
					continue;
				}
				if (commands[bucket].some((c) => c.name === cmd.name)) {
					logger.warning(`Duplicate terminal command "${cmd.name}" from mod ${name} ignored`);
					continue;
				}
				commands[bucket].push(cmd);
			}
		}
	}
}

/** 启动终端交互监听 */
export function start(): void {
	if (rl || !process.stdin.isTTY) return;
	const current = readline.createInterface({ input: process.stdin, output: process.stdout });
	current.on("line", onLine);
	// Some terminals detach stdin during shutdown and close() tries to restore
	// raw mode. Keep the readline error local instead of crashing the process.
	current.on("error", (error: NodeJS.ErrnoException) => {
		if (error.code !== "EIO") logger.debug(`Terminal input error: ${error.message}`);
	});
	rl = current;
}

/** 停止终端交互 */
export function stop(): void {
	if (!rl) return;
	const current = rl;
	rl = null;
	current.removeAllListeners("line");
	current.on("error", () => { /* stdin may already be detached */ });
	try { current.close(); } catch { /* ignore shutdown errors */ }
}

export interface TerminalCommandResult {
	ok: boolean;
	output: string[];
	message?: string;
}

function formatConsoleArg(value: unknown): string {
	if (typeof value === "string") return value;
	if (value instanceof Error) return value.stack || value.message;
	try {
		return typeof value === "object" ? JSON.stringify(value) : String(value);
	} catch {
		return String(value);
	}
}

/**
 * Execute a server-side terminal command from the WebUI.
 * console.log / console.error output is captured for the response and appended
 * to app.log so it also appears in the Logs page.
 */
export async function executeTerminalCommand(input: string): Promise<TerminalCommandResult> {
	const text = String(input ?? "").trim();
	if (!text) return { ok: false, output: [], message: tCore("webui.terminalEmpty") };
	if (!text.startsWith(Command.commandPrefix)) {
		return { ok: false, output: [], message: tCore("webui.terminalNotCommand", { prefix: Command.commandPrefix }) };
	}

	const output: string[] = [];
	const errors: string[] = [];
	const originalLog = console.log;
	const originalError = console.error;
	const originalWarn = console.warn;
	const capture = (target: string[], args: unknown[]): void => {
		const line = args.map(formatConsoleArg).join(" ");
		target.push(line);
	};
	console.log = (...args: unknown[]) => {
		capture(output, args);
		originalLog(...args);
	};
	console.warn = (...args: unknown[]) => {
		capture(output, args);
		originalWarn(...args);
	};
	console.error = (...args: unknown[]) => {
		capture(errors, args);
		originalError(...args);
	};

	let matched = false;
	let status = true;
	let message: string | undefined;
	try {
		for (const bucket of ["normal", "ws"] as const) {
			for (const cmd of commands[bucket]) {
				const result = cmd.execute("Terminal", text, (error) => {
					const line = toUserError(error);
					errors.push(line);
					originalError(line);
					logger.error(`Terminal command failed: ${errorDetail(error)}`);
				});
				if (result === false) continue;
				matched = true;
				if (!result.status) {
					status = false;
					message = typeof result.message === "string"
						? result.message
						: result.message instanceof Error
							? result.message.message
							: result.message === undefined
								? undefined
								: String(result.message);
				}
				break;
			}
			if (matched) break;
		}
		// Let async command implementations flush their console output.
		await new Promise((resolve) => setTimeout(resolve, 120));
	} finally {
		console.log = originalLog;
		console.warn = originalWarn;
		console.error = originalError;
	}

	if (!matched) {
		message = tCore("webui.terminalUnknown", { command: text.split(/\s+/)[0] ?? text });
	}
	const allOutput = [...output, ...errors];
	for (const line of allOutput) appendAppLog(line);
	return {
		ok: matched && status && errors.length === 0,
		output: allOutput,
		message: message ?? (errors[0] || undefined)
	};
}

/** 执行命令列表（返回 true 表示未匹配到任何命令） */
function execute(msg: string, cmds: Command[]): boolean {
	try {
		for (const cmd of cmds) {
			const onError = (e: Error): void => {
				console.error(toUserError(e));
				logger.error(`Command ${errorDetail(e)}`);
			};
			const result = cmd.execute("Terminal", msg, onError);
			if (result) {
				if (!result.status && result.message) console.error(toUserError(result.message));
				return false;
			}
		}
	} catch (e) {
		console.error(toUserError(e));
		return false;
	}
	return true;
}

/** 处理终端输入 */
function onLine(input: string): void {
	const isCommand = input.startsWith(Command.commandPrefix);

	if (isCommand) {
		if (!execute(input, commands.normal)) return;
	}

	if (!Current.client) {
		console.log(tr("terminal.noMainClient"));
		return;
	}

	// 游戏命令转发（以 / 开头）
	if (input.startsWith("/")) {
		Current.client
			.runCommand(input)
			.then((data) => {
				console.log(tr("terminal.commandStatus", { status: data.body?.statusCode ?? "", message: data.body?.statusMessage || tr("terminal.null") }));
			})
			.catch((e: Error) => {
				console.error(`${tr("terminal.commandFailed")}: ${toUserError(e)}`); logger.error(`Terminal command failed: ${errorDetail(e)}`);
			});
		return;
	}

	// 非命令文本作为聊天消息发送
	if (!isCommand) {
		Current.client.tellAll(input);
		return;
	}

	// 执行 WebSocket 级别命令
	if (!execute(input, commands.ws)) return;

	console.log(tr("terminal.unknownCommand", { command: input.split(" ")[0] ?? "" }));
}
