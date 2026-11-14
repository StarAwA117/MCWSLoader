// 基础参数类型解析器：返回 { value } 或 { error }
const PARAM_PARSERS = {
	Boolean: (text) => (text === "true" || text === "false")
		? { value: text === "true" }
		: { error: `"${text}" 处应为布尔型` },
	String: (text) => ({ value: text }),
	Integer: (text) => {
		if (!/^-?\d+$/.test(text)) return { error: `"${text}" 处应为整型` };
		const value = Number(text);
		return Number.isSafeInteger(value) ? { value } : { error: `"${text}" 处应为整型` };
	},
	Float: (text) => {
		if (!/^-?\d*\.?\d+(?:e[+-]?\d+)?$/i.test(text)) return { error: `"${text}" 处应为浮点型` };
		const value = parseFloat(text);
		return Number.isFinite(value) ? { value } : { error: `"${text}" 处应为浮点型` };
	}
};

/**
 * 命令框架类
 * 提供声明式的命令定义和执行框架
 * 支持多种参数类型和链式调用
 */
export default class Command {
	/**
	 * 当前命令前缀（从配置读取，运行时动态可改）
	 * @type {string}
	 */
	static commandPrefix = "$";

	/**
	 * 动态设置命令前缀
	 * @param {string} text - 新的命令前缀
	 * @returns {boolean} 设置是否成功
	 */
	static setCommandPrefix(text) {
		// 空前缀会让所有聊天消息都被当成命令，必须拒绝
		if (typeof text !== "string" || !text || /\s/.test(text)) return false;
		Command.commandPrefix = text;
		return true;
	}

	/**
	 * 解析命令参数字符串
	 * 支持双引号包裹的含空格参数
	 * @param {string} input - 原始命令字符串
	 * @returns {string[]} 解析后的参数数组
	 * @throws {Error} 当双引号未闭合时抛出错误
	 */
	static parseArgs(input) {
		const tokens = [];
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
		if (inQuote) throw new Error("未闭合的双引号");
		if (hasToken) tokens.push(cur);
		return tokens;
	}

	/**
	 * 创建命令实例的静态工厂方法
	 * @param {string} name - 命令名称
	 * @param {string|null} description - 命令描述
	 * @returns {Command} 新的命令实例
	 */
	static create(name, description = null) {
		return new Command(name, description);
	}

	/**
	 * 构造函数
	 * @param {string} name - 命令名称
	 * @param {string|null} description - 命令描述
	 */
	constructor(name, description) {
		this.name = name;
		this.description = description;
		this.parameters = [];
		this.func = null;
		// 异步执行出错时的回调（由调用方注入，用于向用户反馈错误）
		this.onError = null;
	}

	/**
	 * 添加布尔类型参数
	 * @param {string|null} description - 参数描述
	 * @param {boolean} optional - 是否为可选参数
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addBoolean(description = null, optional = false) {
		this._addParameter(["Boolean", description, optional]);
		return this;
	}

	/**
	 * 添加字符串类型参数
	 * @param {string|null} description - 参数描述
	 * @param {boolean} optional - 是否为可选参数
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addString(description = null, optional = false) {
		this._addParameter(["String", description, optional]);
		return this;
	}

	/**
	 * 添加整型参数
	 * @param {string|null} description - 参数描述
	 * @param {boolean} optional - 是否为可选参数
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addInteger(description = null, optional = false) {
		this._addParameter(["Integer", description, optional]);
		return this;
	}

	/**
	 * 添加浮点型参数
	 * @param {string|null} description - 参数描述
	 * @param {boolean} optional - 是否为可选参数
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addFloat(description = null, optional = false) {
		this._addParameter(["Float", description, optional]);
		return this;
	}

	/**
	 * 添加枚举类型参数（限定可选值）
	 * @param {Array} e - 可选值数组
	 * @param {string|null} description - 参数描述
	 * @param {boolean} optional - 是否为可选参数
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addEnum(e, description = null, optional = false) {
		if (!Array.isArray(e) || e.length === 0) throw new Error("addEnum() 需要非空数组");
		return this.add(e, description, optional);
	}

	/**
	 * 添加自定义类型参数
	 * @param {string} type - 参数类型名称
	 * @param {string|null} description - 参数描述
	 * @param {boolean} optional - 是否为可选参数
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	add(type, description = null, optional = false) {
		if (typeof type !== "string" && !Array.isArray(type)) {
			throw new Error("参数类型必须是字符串或数组");
		}
		this._addParameter([type, description, optional]);
		return this;
	}

	/**
	 * 内部方法：添加参数到参数列表
	 * 确保可选参数在必选参数之后
	 * @param {Array} param - 参数定义 [type, description, optional]
	 * @throws {Error} 当可选参数后面跟着必选参数时抛出错误
	 */
	_addParameter(param) {
		const optional = param[2];
		
		// 如果是必选参数，检查是否已经有可选参数
		if (!optional) {
			const hasOptional = this.parameters.some(p => p[2]);
			if (hasOptional) {
				throw new Error("必选参数不能放在可选参数之后");
			}
		}
		
		this.parameters.push(param);
	}

	/**
	 * 添加可选布尔类型参数
	 * @param {string|null} description - 参数描述
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addOptionalBoolean(description = null) {
		return this.addBoolean(description, true);
	}

	/**
	 * 添加可选字符串类型参数
	 * @param {string|null} description - 参数描述
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addOptionalString(description = null) {
		return this.addString(description, true);
	}

	/**
	 * 添加可选整型参数
	 * @param {string|null} description - 参数描述
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addOptionalInteger(description = null) {
		return this.addInteger(description, true);
	}

	/**
	 * 添加可选浮点型参数
	 * @param {string|null} description - 参数描述
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addOptionalFloat(description = null) {
		return this.addFloat(description, true);
	}

	/**
	 * 添加可选枚举类型参数
	 * @param {Array} e - 可选值数组
	 * @param {string|null} description - 参数描述
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addOptionalEnum(e, description = null) {
		return this.addEnum(e, description, true);
	}

	/**
	 * 添加可选自定义类型参数
	 * @param {string} type - 参数类型名称
	 * @param {string|null} description - 参数描述
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	addOptional(type, description = null) {
		return this.add(type, description, true);
	}

	/**
	 * 设置命令执行函数
	 * @param {Function} func - 执行函数
	 * @returns {Command} 返回 this 以支持链式调用
	 */
	setFunc(func) {
		this.func = func;
		return this;
	}

	/**
	 * 判断已解析的参数列表是否指向本命令
	 * @param {string[]} tokens - Command.parseArgs 的结果
	 * @returns {boolean}
	 */
	matches(tokens) {
		return Array.isArray(tokens) && tokens[0] === `${Command.commandPrefix}${this.name}`;
	}

	/**
	 * 执行命令（内部先解析参数）
	 * @param {string} commander - 命令发起者标识
	 * @param {string} text - 原始命令文本
	 * @param {Function} [onError] - 异步处理函数出错时的回调
	 * @returns {Object|boolean} 返回执行结果或 false
	 */
	execute(commander, text, onError = null) {
		let tokens;
		try {
			tokens = Command.parseArgs(text);
		} catch (e) {
			return {
				status: false,
				message: e.message
			};
		}
		return this.executeTokens(commander, tokens, onError);
	}

	/**
	 * 执行命令（复用已解析的参数）
	 * 分发器每条消息只解析一次参数，避免对每个命令重复解析
	 * @param {string} commander - 命令发起者标识
	 * @param {string[]} textList - Command.parseArgs 的结果
	 * @param {Function} [onError] - 异步处理函数出错时的回调
	 * @returns {Object|boolean} 返回执行结果或 false
	 */
	executeTokens(commander, textList, onError = this.onError) {
		// 校验命令名称是否匹配
		if (!this.matches(textList)) return false;

		// 计算必选参数和可选参数数量
		const requiredCount = this.parameters.filter(p => !p[2]).length;
		const totalCount = this.parameters.length;
		const providedArgs = textList.length - 1; // 减去命令名称

		// 校验参数数量是否在有效范围内
		if (providedArgs < requiredCount || providedArgs > totalCount) {
			return {
				status: false,
				message: `参数数量错误：需要 ${requiredCount}-${totalCount} 个参数，但提供了 ${providedArgs} 个`
			};
		}

		const resultList = [];

		for (let i = 0; i < this.parameters.length; i++) {
			const [type, , optional] = this.parameters[i];
			const text = textList[i + 1];

			if (optional && text === undefined) {
				resultList.push(undefined);
				continue;
			}

			// 枚举类型
			if (Array.isArray(type)) {
				if (!type.includes(text)) {
					return { status: false, message: `"${text}" 处应为枚举 ${type}` };
				}
				resultList.push(text);
				continue;
			}

			// 基础类型；未知类型原样透传文本
			const parser = PARAM_PARSERS[type];
			const parsed = parser ? parser(text) : { value: text };
			if (parsed.error) return { status: false, message: parsed.error };
			resultList.push(parsed.value);
		}

		// 调用命令执行函数
		if (!this.func || typeof this.func !== "function") {
			return {
				status: false,
				message: `命令 ${Command.commandPrefix}${this.name} 未实现`
			};
		}

		try {
			const ret = this.func(commander, ...resultList);
			// 异步命令函数（返回 Promise）出错时捕获，避免静默失败
			if (ret && typeof ret.then === "function") {
				ret.catch((e) => {
					if (typeof onError === "function") onError(e);
				});
			}
		} catch (e) {
			return {
				status: false,
				message: e.message
			};
		}

		return {
			status: true,
			message: resultList
		};
	}
}


