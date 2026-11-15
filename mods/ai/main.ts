import ModBase from "../../lib/modbase.js";
import OpenAI from "openai";
import { errorDetail, toUserError } from "../../lib/errors.js";

// OpenAI 客户端（惰性创建；配置变化时重建）
let openai: OpenAI | null = null;
let openaiKey = "";

const COMMAND_JSON_PROMPT = `[MCWSLoader command protocol]

You are in command mode. Reply with exactly one JSON object and nothing else.
Do not wrap it in markdown fences.

Schema:
{
  "message": "short text shown to the player",
  "commands": ["Minecraft Bedrock command without a leading slash"],
  "continue": false
}

Rules:
- "message" is required and must be a string.
- "commands" must be an array of strings. Use [] when no command is needed.
- Set "continue" to true only when another AI turn is needed after the commands finish. Otherwise use false.
- When "continue" is true, every command will be executed and then you will receive a user message containing JSON:
  {"type":"command_results","round":1,"results":[{"command":"...","result":{...}}]}
  Use that result as ground truth for the next turn.
- Never claim a command succeeded before receiving its result.
- Never put commentary, explanations, or markdown outside the JSON object.
`;

type CommandExecution = {
	command: string;
	result?: unknown;
	error?: string;
};

type CommandResponseObject = {
	message: string;
	commands: string[];
	continue: boolean;
	warnings: string[];
};

class AIError extends Error {
	userMessage: string;
	key: string;

	constructor(userMessage: string, detail?: string, key = "ai.error.request") {
		super(detail || userMessage);
		this.name = "AIError";
		this.userMessage = userMessage;
		this.key = key;
	}
}

function mapAIError(error: unknown): AIError {
	if (error instanceof AIError) return error;
	const source = error as { status?: unknown; code?: unknown; message?: unknown; response?: { status?: unknown } } | null;
	const status = Number(source?.status ?? source?.response?.status ?? 0);
	const message = String(source?.message ?? "");
	if (status === 401 || status === 403) return new AIError("AI 认证失败，请检查 apiKey 或接口权限。", message, "ai.error.auth");
	if (status === 404) return new AIError("AI 接口或模型不存在，请检查 baseURL 和 model。", message, "ai.error.model");
	if (status === 429) return new AIError("AI 请求过于频繁或额度不足，请稍后重试。", message, "ai.error.rate");
	if (/context.length|maximum context|token.*exceed|too many tokens/i.test(message)) {
		return new AIError("对话上下文过长，请使用 ai:reset 重置后再试。", message, "ai.error.context");
	}
	if (/ETIMEDOUT|timed? out|AbortError|aborted/i.test(message)) return new AIError("AI 请求超时，请稍后重试。", message, "ai.error.timeout");
	if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(message)) {
		return new AIError("无法连接 AI 服务，请检查网络、baseURL 或代理。", message, "ai.error.network");
	}
	if (/content filter|safety/i.test(message)) return new AIError("AI 拒绝回答该请求。", message, "ai.error.content");
	return new AIError("AI 请求失败，请稍后重试。", message);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	const number = Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.min(max, Math.max(min, Math.trunc(number)));
}

function cloneMessages(messages: unknown): Array<Record<string, unknown>> {
	if (!Array.isArray(messages)) return [];
	return messages
		.filter((message) => message && typeof message === "object")
		.map((message) => ({ ...(message as Record<string, unknown>) }));
}

export function normalizeAIConfig(raw: any): any {
	const source = raw && typeof raw === "object" ? raw : {};
	const oldModels = source.models && typeof source.models === "object" ? source.models : null;
	const oldChat = oldModels?.chat ?? oldModels?.command ?? {};
	const oldCommand = oldModels?.command ?? oldChat;

	const config: any = { ...source };
	delete config.models;

	if (typeof config.model !== "string" || !config.model) {
		config.model = oldChat.model ?? oldCommand.model ?? "gpt-4o-mini";
	}
	if (!Array.isArray(config.messages)) {
		config.messages = oldChat.messages ?? oldCommand.messages ?? [];
	}
	config.messages = cloneMessages(config.messages)
		.filter((message) => typeof message.role === "string" && typeof message.content === "string");
	if (!config.messages.some((message) => message.role === "system")) {
		config.messages.unshift({ role: "system", content: "You are a helpful assistant." });
	}
	config.max_tokens = clampNumber(config.max_tokens ?? oldCommand.max_tokens ?? oldChat.max_tokens ?? 1024, 1, 32768, 1024);
	if (!config.options || typeof config.options !== "object") {
		config.options = oldChat.options ?? {};
	}

	// Preserve vendor-specific request fields (for example DeepSeek thinking).
	for (const key of ["thinking", "temperature", "top_p", "presence_penalty", "frequency_penalty", "stop", "response_format", "reasoning_effort"]) {
		if (config[key] === undefined && oldChat[key] !== undefined) config[key] = oldChat[key];
	}

	config.command = {
		maxRounds: clampNumber(config.command?.maxRounds ?? 4, 1, 8, 4),
		commandTimeoutMs: clampNumber(config.command?.commandTimeoutMs ?? 15000, 1000, 60000, 15000)
	};
	config.chatCooldown = clampNumber(config.chatCooldown ?? 5000, 0, 300000, 5000);
	return config;
}

export function withCommandPrompt(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
	const copy = cloneMessages(messages);
	let systemIndex = -1;
	for (let i = 0; i < copy.length; i++) {
		if (copy[i].role === "system") systemIndex = i;
	}
	if (systemIndex >= 0) {
		const content = String(copy[systemIndex]?.content ?? "");
		if (!content.includes("[MCWSLoader command protocol]")) {
			copy[systemIndex].content = `${content}${content ? "\n\n" : ""}${COMMAND_JSON_PROMPT}`;
		}
	} else {
		copy.unshift({ role: "system", content: COMMAND_JSON_PROMPT });
	}
	return copy;
}

/** Strip optional fences/prose and parse the command-mode JSON contract. */
export function parseCommandResponse(raw: string): CommandResponseObject {
	let text = String(raw ?? "").trim();
	text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start >= 0 && end > start) text = text.slice(start, end + 1);
	let parsed: any;
	try {
		parsed = JSON.parse(text);
	} catch (e) {
		throw new AIError("AI 返回的内容不是有效 JSON，请重试。", (e as Error).message, "ai.error.invalidJson");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new AIError("AI 返回的内容不是 JSON 对象，请重试。", text, "ai.error.invalidJson");
	}

	const warnings: string[] = [];
	let message = "";
	if (typeof parsed.message === "string") {
		message = parsed.message.trim();
		if (!message) warnings.push("ai.warn.emptyMessage");
	} else if (parsed.message !== undefined) {
		warnings.push("ai.warn.messageNotString");
	} else {
		warnings.push("ai.warn.emptyMessage");
	}

	let commands: string[] = [];
	if (Array.isArray(parsed.commands)) {
		const rawCommands = parsed.commands;
		commands = rawCommands
			.filter((command: unknown): command is string => typeof command === "string" && command.trim().length > 0)
			.map((command: string) => command.trim().replace(/^\/+/, ""));
		if (commands.length !== rawCommands.length) warnings.push("ai.warn.partialCommands");
	} else if (parsed.commands !== undefined) {
		warnings.push("ai.warn.commandsNotArray");
	}

	if (parsed.continue !== undefined && typeof parsed.continue !== "boolean") {
		warnings.push("ai.warn.continueNotBool");
	}

	return {
		message,
		commands,
		continue: parsed.continue === true,
		warnings
	};
}

// AI 对话类
// 通过 OpenAI 兼容接口与 AI 模型交互，支持单次对话和上下文对话模式
export default class AIHelper extends ModBase {
	// 玩家数据存储
	// 结构: Map<玩家名, { lastAIChat: number, AIChatContents: Array, AICommandContents: Array }>
	static playerData = new Map();

	// 注入的配置（启动时由 mods.js 设置）
	static config: any = null;

	// 清理定时器
	static cleanupInterval: any = null;

	// 启动自动清理
	// 注意：不绑定具体客户端，实时取当前主客户端，避免主客户端重连后清理逻辑对着已断开连接空转
	static startCleanup() {
		if (AIHelper.cleanupInterval) return;

		AIHelper.cleanupInterval = setInterval(() => {
			const client = AIHelper.Current.client;
			if (!client) return;

			// 获取当前在线玩家列表
			const onlinePlayers = new Set<string>();
			client.runCommand("list").then((data: any) => {
				const playersRaw = data?.body?.players;
				if (playersRaw && playersRaw !== "") {
					playersRaw.split(", ").forEach((name: string) => onlinePlayers.add(name));
				}

				// 销毁不在线玩家的数据
				for (const [name] of AIHelper.playerData) {
					if (!onlinePlayers.has(name)) {
						AIHelper.playerData.delete(name);
					}
				}
			}).catch(() => {});
		}, 45_000);
	}

	// 停止自动清理
	static stopCleanup() {
		if (AIHelper.cleanupInterval) {
			clearInterval(AIHelper.cleanupInterval);
			AIHelper.cleanupInterval = null;
		}
	}

	// 销毁（服务端关闭时调用）
	static onDestroy() {
		AIHelper.stopCleanup();
		AIHelper.playerData.clear();
	}

	// 获取或创建玩家数据
	static getPlayerData(name: string) {
		if (!AIHelper.playerData.has(name)) {
			AIHelper.playerData.set(name, {
				lastAIChat: 0,
				AIChatContents: [],
				AICommandContents: []
			});
		}
		return AIHelper.playerData.get(name);
	}

	// 聊天方法（sendMsg: 用户输入, mode: 模式, contents: 上下文）
	static async chat(sendMsg: string, mode: "chat" | "command", contents: any[] | null = null): Promise<string> {
		const config = normalizeAIConfig(AIHelper.config);
		if (!config.options?.apiKey) throw new Error("未配置 AI apiKey，请在 config.json 中填写");

		const clientKey = JSON.stringify(config.options);
		if (!openai || openaiKey !== clientKey) {
			try {
				openai = new OpenAI(config.options);
				openaiKey = clientKey;
			} catch (e) {
				throw new AIError("AI 配置无效，请检查 baseURL 和 apiKey。", (e as Error).message, "ai.error.config");
			}
		}

		const {
			options: _options,
			messages,
			model,
			max_tokens,
			command: _command,
			chatCooldown: _chatCooldown,
			stream: _stream,
			...extra
		} = config;

		const sendData: any = {
			...extra,
			model,
			messages: mode === "command" ? withCommandPrompt(messages) : cloneMessages(messages),
			max_tokens,
			stream: false
		};

		// 上文模式下将历史对话追加到请求中（过滤缺失 content 的异常历史，避免报 missing field）
		if (contents) {
			const validContents = contents.filter((msg: any) => typeof msg?.content === "string");
			sendData.messages.push(...validContents);
		}

		// 追加当前用户消息
		sendData.messages.push({
			role: "user",
			content: sendMsg
		});

		let completion: any;
		try {
			completion = await openai.chat.completions.create(sendData);
		} catch (e) {
			throw mapAIError(e);
		}

		// 提取回复内容（兼容字符串、数组及推理模型返回值）
		const rawContent = completion.choices?.[0]?.message?.content;
		const returnMsg = (() => {
			if (typeof rawContent === "string") return rawContent;
			if (Array.isArray(rawContent)) {
				return (rawContent as any[]).map((part: any) => part?.text ?? "").join("");
			}
			return (completion.choices?.[0]?.message as any)?.reasoning_content ?? "";
		})();

		// 上文模式下保存本次对话并限制历史长度
		if (contents) {
			contents.push({
				role: "user",
				content: sendMsg
			}, {
				role: "assistant",
				content: returnMsg ?? ""
			});
			if (contents.length > 40) contents.splice(0, contents.length - 40);
		}

		if (!returnMsg || !String(returnMsg).trim()) {
			throw new AIError("AI 没有返回可显示的内容，空输出。", undefined, "ai.error.emptyOutput");
		}

		return returnMsg;
	}

	// 构造函数
	constructor(client: any) {
		super();
		this.client = client;
		AIHelper.startCleanup();
	}

	// 返回命令定义
	onCommand() {
		return {
			normal: [
				this.Command.create("ai", this.rawtext("command.ai"))
					.addString(this.rawtext("ai.param.e55fa91ecf"), true)
					.setFunc(async (commander: string, text: string) => {
						await this.chat(text, commander);
					}),

				this.Command.create("ai:reset", this.rawtext("command.aiReset"))
					.setFunc((commander: string) => {
						this.reset(commander);
						this.client?.tellAll(`§eAI | §fSystem > §i${this.rawtext("ai.contextReset")}`);
					})
			],

			op: [
				this.Command.create("ai:c", this.rawtext("command.aiCommand"))
					.addString(this.rawtext("ai.param.e55fa91ecf"), true)
					.setFunc(async (commander: string, text: string) => {
						await this.command(text, commander);
					})
			]
		};
	}

	// 冷却检查函数
	cooldownTest(name: string): boolean {
		const data = AIHelper.getPlayerData(name);
		const now = Date.now();
		const lastTime = data.lastAIChat || 0;
		const cooldown = normalizeAIConfig(AIHelper.config).chatCooldown;

		// 发言过快检测（先判定，通过后再更新时间，避免冷却被每次失败发言后移）
		if (now - lastTime < cooldown) {
			this.client?.tellAll(`§cAI | §fCooldown > §i${this.rawtext("ai.cooldown")}`);
			return false;
		}

		data.lastAIChat = now;
		return true;
	}

	// 聊天方法
	async chat(sendMsg: string, name: string) {
		if (!this.cooldownTest(name)) return;

		const data = AIHelper.getPlayerData(name);
		const contents = data.AIChatContents;

		try {
			const result = await AIHelper.chat(sendMsg, "chat", contents);
			this.client?.tellAll(`§bAI | §f${name} > §i${result}`);
		} catch (e) {
			this.logger.error(`AI chat failed: ${errorDetail(e)}`);
			this.client?.tellAll(`§cAI | §fError > §i${e instanceof AIError ? this.rawtext(e.key) : this.rawtext("ai.error.request")}`);
		}
	}

	// 命令方法：单轮命令 + 可选连续对话
	async command(sendMsg: string, name: string) {
		if (!this.cooldownTest(name)) return;
		if (!this.client) return;

		const data = AIHelper.getPlayerData(name);
		const contents = data.AICommandContents;
		const config = normalizeAIConfig(AIHelper.config);
		const maxRounds = config.command.maxRounds;
		let input = sendMsg;

		for (let round = 1; round <= maxRounds; round++) {
			let raw: string;
			try {
				raw = await AIHelper.chat(input, "command", contents);
			} catch (e) {
				this.logger.error(`AI command request failed: ${errorDetail(e)}`);
				this.client?.tellAll(`§cAI | §fError > §i${e instanceof AIError ? this.rawtext(e.key) : this.rawtext("ai.error.request")}`);
				return;
			}

			let response: CommandResponseObject;
			try {
				response = parseCommandResponse(raw);
			} catch (e) {
				this.logger.error(`AI command response invalid: ${errorDetail(e)}`);
				this.client?.tellAll(`§cAI | §fError > §i${e instanceof AIError ? this.rawtext(e.key) : this.rawtext("ai.error.invalidJson")}`);
				return;
			}

			for (const warning of response.warnings) {
				this.client?.tellAll(`§eAI | §fWarn > §i${this.rawtext(warning)}`);
			}
			if (response.message) this.client?.tellAll(`§bAI | §f${name} > §i${response.message}`);

			const results: CommandExecution[] = [];
			for (const command of response.commands) {
				const normalized = command.trim().replace(/^\/+/, "");
				if (!normalized) continue;
				this.client?.tellAll(`§bAI | §fCommand > §i/${normalized}`);
				try {
					const result = await this.client.runCommand(normalized, config.command.commandTimeoutMs);
					results.push({ command: normalized, result });
				} catch (e) {
					this.logger.error(`AI command failed: ${normalized}: ${errorDetail(e)}`);
					results.push({ command: normalized, error: toUserError(e, "命令执行失败") });
				}
			}

			// 没有命令或 AI 未要求继续时结束，避免无意义的循环
			if (!response.continue || results.length === 0) return;

			if (round >= maxRounds) {
				this.client?.tellAll(`§eAI | §fSystem > §i${this.rawtext("ai.maxRounds", { max: maxRounds })}`);
				return;
			}

			// 下一轮将看到这轮的命令、原始 JSON 结果和完整历史上下文
			input = JSON.stringify({
				type: "command_results",
				round,
				results
			});
		}
	}

	// 清空对话上下文
	reset(name: string) {
		const data = AIHelper.getPlayerData(name);
		data.AIChatContents = [];
		data.AICommandContents = [];
	}

	// 销毁方法
	onDestroy() {
		AIHelper.stopCleanup();
		this.client = null;
	}
}
