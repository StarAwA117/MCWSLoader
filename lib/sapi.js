import { logger } from "./logger.js";
import { config } from "./mods.js";

/**
 * 命令不存在的状态码
 * @type {number}
 */
const COMMAND_NOT_FOUND = -2147483648;

/**
 * SAPI 桥接模块
 * Communicate with Minecraft Bedrock SAPI (Server API)
 *
 * 命令说明（命令名见 config.json 的 sapi，SAPI 端需要注册）：
 * - config.sapi.gmsg: 获取等待处理的消息列表（JSON 数组）
 * - config.sapi.smsg <json>: 设置要传递给 WebSocket 的消息（JSON 对象）
 *
 * 消息格式：
 * {
 *   "mod": "ModName",      // 目标 Mod 标识
 *   "type": "msgType",     // 消息类型
 *   "data": {}             // 消息数据
 * }
 */
export default class SAPIBridge {
	/**
	 * 检测 /gmsg 和 /smsg 命令是否存在
	 * @param {Object} client - 客户端连接
	 * @returns {Promise<boolean>} 命令是否存在
	 */
	static async detect(client) {
		if (!client) return false;

		try {
			const data = await client.runCommand(config.sapi.gmsg);
			const statusCode = data?.body?.statusCode;

			// -2147483648 表示命令不存在
			if (statusCode === COMMAND_NOT_FOUND) return false;

			return true;
		} catch (e) {
			logger.debug(`SAPI check failed: ${e.message}`);
			return false;
		}
	}

	/**
	 * 获取消息列表
	 * @param {Object} client - 客户端连接
	 * @returns {Promise<Array|null>} 消息列表；命令不存在时返回 null
	 */
	static async getMessages(client) {
		if (!client) return [];

		try {
			const data = await client.runCommand(config.sapi.gmsg);
			const statusCode = data?.body?.statusCode;

			// Check if command exists
			if (statusCode === COMMAND_NOT_FOUND) return null;

			// 从 statusMessage 获取消息（JSON 字符串）
			const statusMessage = data?.body?.statusMessage;
			if (!statusMessage) return [];

			// 尝试 JSON 解析
			try {
				const messages = JSON.parse(statusMessage);
				return Array.isArray(messages) ? messages : [];
			} catch {
				return [];
			}
		} catch (e) {
			logger.debug(`SAPI getMessages failed: ${e.message}`);
			return [];
		}
	}

	/**
	 * 发送消息
	 * @param {Object} client - 客户端连接
	 * @param {string} mod - Mod 标识
	 * @param {string} type - 消息类型
	 * @param {Object} data - 消息数据
	 * @returns {Promise<boolean|null>} true 成功；false 失败但命令存在；null 命令不存在
	 */
	static async sendMessage(client, mod, type, data = {}) {
		if (!client) return false;

		const message = JSON.stringify({ mod, type, data });

		// 检查消息长度
		if (Buffer.byteLength(message, "utf8") > 400) {
			logger.warning(`SAPI message too long: ${Buffer.byteLength(message, "utf8")} bytes`);
			return false;
		}

		const escaped = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
		const command = `${config.sapi.smsg} "${escaped}"`;

		// 检查完整命令长度（不能超过 runCommand 的 461 字节限制）
		const cmdCfg = (config.command) || {};
		const COMMAND_MAX_LENGTH = (cmdCfg.maxLength !== undefined) ? cmdCfg.maxLength : 461;
		if (Buffer.byteLength(command, "utf8") > COMMAND_MAX_LENGTH) {
			logger.warning(`SAPI command too long: ${Buffer.byteLength(command, "utf8")} bytes`);
			return false;
		}

		try {
			const result = await client.runCommand(command);
			const statusCode = result?.body?.statusCode;

			// Check if command exists
			if (statusCode === COMMAND_NOT_FOUND) return null;

			// statusCode 为 0 表示成功
			if (statusCode === 0) {
				logger.debug(`SAPI send success: ${mod}/${type}`);
				return true;
			}

			logger.debug(`SAPI send failed: statusCode=${statusCode}`);
			return false;
		} catch (e) {
			logger.debug(`SAPI sendMessage failed: ${e.message}`);
			return false;
		}
	}
}

/**
 * SAPI message handler (unified poller)
 * Instantiated per client, responsible for:
 * - Unified poll /gmsg message queue
 * - Route messages by mod field to registered handlers
 * - State is per-instance (independent per client)
 * - Stop polling when command missing, retry every 45s
 *
 * 特性：
 * - 实例化后自动开始轮询
 * - 轮询过程中如果命令不存在（-2147483648）自动停止，并周期性重试
 * - 可通过 start() 手动重新开始轮询
 * - 销毁时自动停止轮询
 */
export class SAPIMessageHandler {
	/**
	 * 构造函数
	 * @param {Object} client - 客户端连接
	 */
	constructor(client) {
		this.client = client;
		// 命令是否存在（实例级状态，null=未检测，false=不存在，true=存在）
		this.commandExists = null;
		this.polling = false;
		this.pollTimer = null;
		this.retryTimer = null;
		// 处理器注册表: modName -> Map<type, callback>
		this.handlers = new Map();
		this.pollInterval = 1000;
		this.retryInterval = 45_000;
		this.destroyed = false;

		// 自动开始轮询
		this.start();
	}

	/**
	 * 注册消息处理器（按 modName 下放）
	 * @param {string} modName - Mod 名称
	 * @param {string} type - Message type, "*" means all types for that mod
	 * @param {Function} callback - 处理函数
	 */
	register(modName, type, callback) {
		if (!modName || typeof type !== "string" || typeof callback !== "function") return;
		if (!this.handlers.has(modName)) {
			this.handlers.set(modName, new Map());
		}
		this.handlers.get(modName).set(type, callback);
	}

	/**
	 * Remove message handler
	 * @param {string} modName - Mod 名称
	 * @param {string} type - 消息类型
	 */
	unregister(modName, type) {
		const modHandlers = this.handlers.get(modName);
		if (!modHandlers) return;
		modHandlers.delete(type);
		if (modHandlers.size === 0) this.handlers.delete(modName);
	}

	/**
	 * 清除指定 Mod 的全部处理器
	 * @param {string} modName - Mod 名称
	 */
	clearMod(modName) {
		this.handlers.delete(modName);
	}

	/**
	 * Send message (on behalf of specified mod)
	 * @param {string} modName - Mod 名称
	 * @param {string} type - 消息类型
	 * @param {Object} data - 消息数据
	 * @returns {Promise<boolean>} 是否发送成功
	 */
	async send(modName, type, data = {}) {
		if (!this.client || this.destroyed) return false;

		const result = await SAPIBridge.sendMessage(this.client, modName, type, data);

		// 命令不存在时禁用并周期重试
		if (result === null) {
			this._disable();
			return false;
		}

		// Send success means command restored, re-enable polling immediately
		if (result === true && this.commandExists === false) {
			this._enable();
		}

		return result === true;
	}

	/**
	 * 开始轮询消息
	 * Ignore if already polling
	 */
	start() {
		if (this.polling || !this.client || this.destroyed) return;
		this.polling = true;
		// Clear pending retry timer, current poll takes precedence
		if (this.retryTimer) {
			clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}
		logger.debug(`SAPI start polling`);
		this._poll();
	}

	/**
	 * 停止轮询消息
	 */
	stop() {
		if (!this.polling) return;
		this.polling = false;
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
		logger.debug(`SAPI stop polling`);
	}

	/**
	 * 内部轮询方法
	 */
	async _poll() {
		if (!this.polling || !this.client || this.destroyed) return;

		try {
			// 首次轮询前先检测命令是否存在
			if (this.commandExists === null) {
				const exists = await SAPIBridge.detect(this.client);
				if (!exists) {
					this._disable();
					return;
				}
				this.commandExists = true;
				logger.info("SAPI command detected, bridge enabled");
			}

			const messages = await SAPIBridge.getMessages(this.client);

			// 命令不存在，停止轮询并周期重试
			if (messages === null) {
				this._disable();
				return;
			}

			// 按 mod 下放处理接收到的消息
			for (const msg of messages) {
				this._handleMessage(msg);
			}
		} catch (e) {
			logger.debug(`SAPI polling error: ${e.message}`);
		}

		// 安排下次轮询
		if (this.polling) {
			this.pollTimer = setTimeout(() => this._poll(), this.pollInterval);
		}
	}

	/**
	 * 处理单条消息
	 * Route by mod field first;
	 * Broadcast to wildcard ("*") handlers if mod unregistered or empty
	 * @param {Object} msg - 消息对象 { mod, type, data }
	 */
	_handleMessage(msg) {
		if (!msg || typeof msg !== "object") return;

		const { mod, type, data } = msg;
		const msgData = { mod, type, data };

		const modHandlers = typeof mod === "string" ? this.handlers.get(mod) : undefined;

		if (modHandlers) {
			this._callHandler(modHandlers.get(type), msgData);
			this._callHandler(modHandlers.get("*"), msgData);
		} else {
			// Broadcast to all wildcard handlers when no matching mod
			for (const handlers of this.handlers.values()) {
				this._callHandler(handlers.get("*"), msgData);
			}
		}
	}

	/**
	 * Safely call single handler
	 * @param {Function|null} handler - 处理函数
	 * @param {Object} msg - 消息对象
	 */
	_callHandler(handler, msg) {
		if (typeof handler !== "function") return;
		try {
			handler(msg);
		} catch (e) {
			logger.error(`SAPI message handling error: ${msg.type}`);
			logger.debug(e.message);
		}
	}

	/**
	 * Disable bridge (command not found)
	 * 停止轮询并安排周期性重试
	 */
	_disable() {
		if (this.commandExists === false) return;
		this.commandExists = false;
		this.stop();
		logger.info("SAPI command not found, bridge disabled");
		this._scheduleRetry();
	}

	/**
	 * Enable bridge (command restored)
	 */
	_enable() {
		if (this.commandExists === true) return;
		this.commandExists = true;
		logger.info("SAPI command restored, bridge enabled");
		this.start();
	}

	/**
	 * 安排周期重试检测
	 */
	_scheduleRetry() {
		if (this.retryTimer || this.destroyed) return;
		this.retryTimer = setTimeout(async () => {
			this.retryTimer = null;
			if (this.destroyed || !this.client) return;
			try {
				const exists = await SAPIBridge.detect(this.client);
				if (exists) {
					this._enable();
				} else {
					this._scheduleRetry();
				}
			} catch {
				this._scheduleRetry();
			}
		}, this.retryInterval);
	}

	/**
	 * 销毁处理器
	 */
	destroy() {
		this.destroyed = true;
		this.stop();
		if (this.retryTimer) {
			clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}
		this.handlers.clear();
		this.client = null;
	}
}
