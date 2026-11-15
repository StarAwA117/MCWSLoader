import { toUserError } from "./errors.js";
import { tCore } from "./texts.js";

/** 参数类型：基础类型名、自定义类型名或枚举值数组 */
export type CommandParameterType = string | readonly string[];

/** [类型, 描述, 是否可选] */
export type ParameterTuple = [CommandParameterType, string | null, boolean];

export class CommandError extends Error {
	readonly userMessage: string;

	constructor(message: string) {
		super(message);
		this.name = "CommandError";
		this.userMessage = message;
	}
}

export type CommandResult = {
	status: boolean;
	message?: string | unknown[] | CommandError;
};

export type CommandErrorHandler = (error: Error) => void;

export type CommandFunc = (commander: string, ...args: any[]) => unknown;

interface ParsedValue {
	value?: unknown;
	error?: string;
}

type ValueParser = (text: string) => ParsedValue;

// 基础参数类型解析器：返回 { value } 或 { error }
const PARAM_PARSERS: Record<string, ValueParser> = {
	Boolean: (text) =>
		text === "true" || text === "false"
			? { value: text === "true" }
			: { error: tCore("core.command.boolean", { value: text }) },
	String: (text) => ({ value: text }),
	Integer: (text) => {
		if (!/^-?\d+$/.test(text)) return { error: tCore("core.command.integer", { value: text }) };
		const value = Number(text);
		return Number.isSafeInteger(value) ? { value } : { error: tCore("core.command.integer", { value: text }) };
	},
	Float: (text) => {
		if (!/^-?\d*\.?\d+(?:e[+-]?\d+)?$/i.test(text)) return { error: tCore("core.command.float", { value: text }) };
		const value = parseFloat(text);
		return Number.isFinite(value) ? { value } : { error: tCore("core.command.float", { value: text }) };
	}
};

/**
 * 命令框架类
 * 提供声明式的命令定义和执行框架
 * 支持多种参数类型和链式调用
 */
export default class Command {
	/** 当前命令前缀（由 config.commandPrefix 初始化，运行时可通过 setCommandPrefix 修改） */
	static commandPrefix = "$";

	name: string;
	description: string | null;
	parameters: ParameterTuple[];
	func: CommandFunc | null;
	/** 异步执行出错时的回调（兼容旧用法，推荐使用 execute 的 onError 参数） */
	onError: CommandErrorHandler | null = null;

	/**
	 * 动态设置命令前缀
	 * 空前缀会让所有聊天消息都被当成命令，因此拒绝空值/空白
	 */
	static setCommandPrefix(text: string): boolean {
		if (typeof text !== "string" || !text || /\s/.test(text)) return false;
		Command.commandPrefix = text;
		return true;
	}

	/**
	 * 解析命令参数字符串
	 * 支持双引号包裹的含空格参数，任意空白作为分隔符
	 */
	static parseArgs(input: string): string[] {
		const tokens: string[] = [];
		let cur = "";
		let inQuote = false;
		let hasToken = false;

		for (const ch of String(input)) {
			if (ch === '"') {
				if (inQuote) {
					tokens.push(cur);
					cur = "";
					hasToken = false;
					inQuote = false;
				} else {
					// 引号开启时标记 token 存在，使 "" 解析为空字符串
					inQuote = true;
					hasToken = true;
				}
			} else if (!inQuote && /\s/.test(ch)) {
				if (hasToken) {
					tokens.push(cur);
					cur = "";
					hasToken = false;
				}
			} else {
				cur += ch;
				hasToken = true;
			}
		}
		if (inQuote) throw new Error(tCore("core.command.unclosedQuote"));
		if (hasToken) tokens.push(cur);
		return tokens;
	}

	/** 创建命令实例的静态工厂方法 */
	static create(name: string, description: string | null = null): Command {
		return new Command(name, description);
	}

	constructor(name: string, description: string | null) {
		this.name = name;
		this.description = description;
		this.parameters = [];
		this.func = null;
	}

	/** 添加布尔类型参数 */
	addBoolean(description: string | null = null, optional = false): this {
		return this._addParameter(["Boolean", description, optional]);
	}

	/** 添加字符串类型参数 */
	addString(description: string | null = null, optional = false): this {
		return this._addParameter(["String", description, optional]);
	}

	/** 添加整型参数 */
	addInteger(description: string | null = null, optional = false): this {
		return this._addParameter(["Integer", description, optional]);
	}

	/** 添加浮点型参数 */
	addFloat(description: string | null = null, optional = false): this {
		return this._addParameter(["Float", description, optional]);
	}

	/** 添加枚举类型参数（限定可选值） */
	addEnum(e: readonly string[], description: string | null = null, optional = false): this {
		if (!Array.isArray(e) || e.length === 0) throw new Error("addEnum() 需要非空数组");
		return this.add(e, description, optional);
	}

	/** 添加自定义类型参数 */
	add(type: CommandParameterType, description: string | null = null, optional = false): this {
		if (typeof type !== "string" && !Array.isArray(type)) {
			throw new Error("参数类型必须是字符串或数组");
		}
		return this._addParameter([type, description, optional]);
	}

	/** 内部方法：添加参数到参数列表，确保可选参数在必选参数之后 */
	_addParameter(param: ParameterTuple): this {
		const optional = param[2];

		if (!optional) {
			const hasOptional = this.parameters.some((p) => p[2]);
			if (hasOptional) throw new Error("必选参数不能放在可选参数之后");
		}

		this.parameters.push(param);
		return this;
	}

	addOptionalBoolean(description: string | null = null): this {
		return this.addBoolean(description, true);
	}

	addOptionalString(description: string | null = null): this {
		return this.addString(description, true);
	}

	addOptionalInteger(description: string | null = null): this {
		return this.addInteger(description, true);
	}

	addOptionalFloat(description: string | null = null): this {
		return this.addFloat(description, true);
	}

	addOptionalEnum(e: readonly string[], description: string | null = null): this {
		return this.addEnum(e, description, true);
	}

	addOptional(type: CommandParameterType, description: string | null = null): this {
		return this.add(type, description, true);
	}

	/** 设置命令执行函数 */
	setFunc(func: CommandFunc): this {
		this.func = func;
		return this;
	}

	/** 判断已解析的参数列表是否指向本命令 */
	matches(tokens: string[]): boolean {
		return Array.isArray(tokens) && tokens[0] === `${Command.commandPrefix}${this.name}`;
	}

	/** 执行命令（内部先解析参数） */
	execute(commander: string, text: string, onError: CommandErrorHandler | null = null): CommandResult | false {
		let tokens: string[];
		try {
			tokens = Command.parseArgs(text);
		} catch (e) {
			return { status: false, message: new CommandError(toUserError(e, tCore("core.command.invalid"))) };
		}
		return this.executeTokens(commander, tokens, onError);
	}

	/** 执行命令（复用已解析的参数，分发器每条消息只解析一次） */
	executeTokens(
		commander: string,
		textList: string[],
		onError: CommandErrorHandler | null = this.onError
	): CommandResult | false {
		if (!this.matches(textList)) return false;

		const requiredCount = this.parameters.filter((p) => !p[2]).length;
		const totalCount = this.parameters.length;
		const providedArgs = textList.length - 1;

		if (providedArgs < requiredCount || providedArgs > totalCount) {
			return {
				status: false,
				message: new CommandError(tCore("core.command.argCount", {
					min: requiredCount,
					max: totalCount,
					provided: providedArgs
				}))
			};
		}

		const resultList: unknown[] = [];

		for (let i = 0; i < this.parameters.length; i++) {
			const param = this.parameters[i];
			if (!param) continue;
			const [type, , optional] = param;
			const text = textList[i + 1];

			if (optional && text === undefined) {
				resultList.push(undefined);
				continue;
			}

			// 枚举类型
			if (typeof type !== "string") {
				if (!type.includes(text ?? "")) {
					return {
						status: false,
						message: new CommandError(tCore("core.command.enum", { value: text ?? "", values: type.join("|") }))
					};
				}
				resultList.push(text);
				continue;
			}

			// 基础类型；未知类型原样透传文本
			const parser = Object.prototype.hasOwnProperty.call(PARAM_PARSERS, type)
				? PARAM_PARSERS[type]
				: null;
			const parsed = parser ? parser(text ?? "") : { value: text };
			if (parsed.error) return { status: false, message: new CommandError(parsed.error) };
			resultList.push(parsed.value);
		}

		if (!this.func || typeof this.func !== "function") {
			return {
				status: false,
				message: new CommandError(tCore("core.command.notImplemented", { command: `${Command.commandPrefix}${this.name}` }))
			};
		}

		try {
			const ret = this.func(commander, ...resultList);
			// 异步命令函数（返回 Promise）出错时捕获，避免静默失败
			if (ret && typeof (ret as PromiseLike<unknown>).then === "function") {
				(ret as PromiseLike<unknown>).then(undefined, (e: Error) => {
					if (typeof onError === "function") onError(e);
				});
			}
		} catch (e) {
			return { status: false, message: new CommandError(toUserError(e, tCore("core.command.invalid"))) };
		}

		return {
			status: true,
			message: resultList
		};
	}
}
