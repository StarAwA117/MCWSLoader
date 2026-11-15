import { logger } from "./logger.js";
import { config } from "./mods.js";
import type { Client } from "./types/client.js";

/**
 * SAPI 命令不存在时 Minecraft 返回的状态码
 */
const COMMAND_NOT_FOUND = -2147483648;

export interface SapiMessage {
	mod?: string;
	type?: string;
	data?: unknown;
}

export type SapiHandler = (msg: SapiMessage) => void;

/**
 * SAPI (Server API) 消息桥
 *
 * 每个客户端连接一个实例，负责：
 * - 轮询 `config.sapi.gmsg` 取回消息队列
 * - 按 `mod` 字段把消息路由给注册的 Mod 处理器
 * - 代 Mod 通过 `config.sapi.smsg` 发送消息
 *
 * 消息格式：
 * ```
 * { "mod": "ModName", "type": "msgType", "data": {} }
 * ```
 *
 * 命令不存在时自动停止轮询，并每 45 秒重试一次；命令恢复后自动重新开始。
 */
export class SAPIMessageHandler {
	client: Client | null;
	/** null=未检测，false=不存在，true=存在 */
	commandExists: boolean | null = null;
	polling = false;
	pollTimer: NodeJS.Timeout | null = null;
	retryTimer: NodeJS.Timeout | null = null;

	/** 处理器注册表: modName -> Map<type, callback> */
	handlers = new Map<string, Map<string, SapiHandler>>();
	pollInterval = 1000;
	idlePollInterval = 3000;
	retryInterval = 45_000;
	_idlePolls = 0;
	destroyed = false;

	constructor(client: Client) {
		this.client = client;
		this.start();
	}

	// ==================== 处理器注册 ====================

	/**
	 * 注册消息处理器
	 * @param type 消息类型，"*" 表示该 Mod 的全部类型
	 */
	register(modName: string, type: string, callback: SapiHandler): void {
		if (!modName || typeof type !== "string" || typeof callback !== "function") return;
		let handlers = this.handlers.get(modName);
		if (!handlers) {
			handlers = new Map();
			this.handlers.set(modName, handlers);
		}
		handlers.set(type, callback);
	}

	unregister(modName: string, type: string): void {
		const handlers = this.handlers.get(modName);
		if (!handlers) return;
		handlers.delete(type);
		if (handlers.size === 0) this.handlers.delete(modName);
	}

	clearMod(modName: string): void {
		this.handlers.delete(modName);
	}

	// ==================== 发送 ====================

	/**
	 * 以指定 Mod 的身份发送消息
	 * @returns 是否发送成功
	 */
	async send(modName: string, type: string, data: unknown = {}): Promise<boolean> {
		if (!this.client || this.destroyed) return false;

		const result = await this._sendMessage(modName, type, data);

		// 命令不存在：停止轮询，等待重试
		if (result === null) {
			this._disable();
			return false;
		}
		// 发送成功说明命令已恢复
		if (result === true && this.commandExists === false) this._enable();
		return result === true;
	}

	/**
	 * @returns true 成功；false 失败；null 命令不存在
	 */
	async _sendMessage(mod: string, type: string, data: unknown = {}): Promise<boolean | null> {
		const client = this.client;
		if (!client) return false;

		const message = JSON.stringify({ mod, type, data });
		const messageBytes = Buffer.byteLength(message, "utf8");
		if (messageBytes > 400) {
			logger.warning(`SAPI message too long: ${messageBytes} bytes`);
			return false;
		}

		const escaped = message.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
		const command = `${config.sapi.smsg} "${escaped}"`;

		const maxLength = config.command?.maxLength ?? 461;
		const commandBytes = Buffer.byteLength(command, "utf8");
		if (commandBytes > maxLength) {
			logger.warning(`SAPI command too long: ${commandBytes} bytes`);
			return false;
		}

		try {
			const result = await client.runCommand(command);
			const statusCode = result.body?.statusCode;
			if (statusCode === COMMAND_NOT_FOUND) return null;
			if (statusCode === 0) {
				logger.debug(`SAPI send success: ${mod}/${type}`);
				return true;
			}
			logger.debug(`SAPI send failed: statusCode=${statusCode}`);
			return false;
		} catch (e) {
			logger.debug(`SAPI sendMessage failed: ${(e as Error).message}`);
			return false;
		}
	}

	// ==================== 轮询 ====================

	start(): void {
		if (this.polling || !this.client || this.destroyed) return;
		this.polling = true;
		if (this.retryTimer) {
			clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}
		logger.debug("SAPI start polling");
		void this._poll();
	}

	stop(): void {
		const wasPolling = this.polling;
		this.polling = false;
		if (this.pollTimer) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}
		// A retry must not revive a bridge that was explicitly stopped.
		if (this.retryTimer) {
			clearTimeout(this.retryTimer);
			this.retryTimer = null;
		}
		if (wasPolling) logger.debug("SAPI stop polling");
	}

	async _poll(): Promise<void> {
		if (!this.polling || !this.client || this.destroyed) return;

		try {
			// 首次轮询前先检测命令是否存在
			if (this.commandExists === null) {
				const exists = await this._detect();
				if (!exists) {
					this._disable();
					return;
				}
				this.commandExists = true;
				logger.info("SAPI command detected, bridge enabled");
			}

			const messages = await this._getMessages();

			// 命令不存在：停止轮询并周期重试
			if (messages === null) {
				this._disable();
				return;
			}

			for (const msg of messages) this._handleMessage(msg);

			// 空闲退避：连续多个空轮次后降低频率，有消息立即恢复
			if (messages.length > 0) this._idlePolls = 0;
			else this._idlePolls++;
		} catch (e) {
			logger.debug(`SAPI polling error: ${(e as Error).message}`);
			this._idlePolls++;
		}

		if (this.polling) {
			const delay = this._idlePolls >= 5 ? this.idlePollInterval : this.pollInterval;
			this.pollTimer = setTimeout(() => void this._poll(), delay);
		}
	}

	/** 检测 /gmsg 是否存在 */
	async _detect(): Promise<boolean> {
		const client = this.client;
		if (!client) return false;
		try {
			const data = await client.runCommand(config.sapi.gmsg);
			return data.body?.statusCode !== COMMAND_NOT_FOUND;
		} catch (e) {
			logger.debug(`SAPI check failed: ${(e as Error).message}`);
			return false;
		}
	}

	/**
	 * 取回等待处理的消息列表
	 * @returns null 表示命令不存在
	 */
	async _getMessages(): Promise<SapiMessage[] | null> {
		const client = this.client;
		if (!client) return [];
		try {
			const data = await client.runCommand(config.sapi.gmsg);
			if (data.body?.statusCode === COMMAND_NOT_FOUND) return null;

			const statusMessage = data.body?.statusMessage;
			if (!statusMessage) return [];
			try {
				const messages = JSON.parse(statusMessage) as unknown;
				return Array.isArray(messages) ? (messages as SapiMessage[]) : [];
			} catch {
				return [];
			}
		} catch (e) {
			logger.debug(`SAPI getMessages failed: ${(e as Error).message}`);
			return [];
		}
	}

	// ==================== 消息路由 ====================

	/** 按 mod 字段路由；mod 未注册时广播给所有通配处理器 */
	_handleMessage(msg: SapiMessage): void {
		if (!msg || typeof msg !== "object") return;

		const { mod, type, data } = msg;
		const msgData: SapiMessage = { mod, type, data };
		const handlers = typeof mod === "string" ? this.handlers.get(mod) : undefined;

		if (handlers) {
			this._callHandler(handlers.get(type ?? ""), msgData);
			this._callHandler(handlers.get("*"), msgData);
		} else {
			for (const group of this.handlers.values()) {
				this._callHandler(group.get("*"), msgData);
			}
		}
	}

	_callHandler(handler: SapiHandler | undefined, msg: SapiMessage): void {
		if (typeof handler !== "function") return;
		try {
			handler(msg);
		} catch (e) {
			logger.error(`SAPI message handling error: ${msg.type ?? ""}`);
			logger.debug((e as Error).message);
		}
	}

	// ==================== 启停 ====================

	_disable(): void {
		if (this.commandExists === false) return;
		this.commandExists = false;
		this.stop();
		logger.info("SAPI command not found, bridge disabled");
		this._scheduleRetry();
	}

	_enable(): void {
		if (this.commandExists === true) return;
		this.commandExists = true;
		logger.info("SAPI command restored, bridge enabled");
		this.start();
	}

	_scheduleRetry(): void {
		if (this.retryTimer || this.destroyed) return;
		this.retryTimer = setTimeout(async () => {
			this.retryTimer = null;
			if (this.destroyed || !this.client) return;
			try {
				if (await this._detect()) this._enable();
				else this._scheduleRetry();
			} catch {
				this._scheduleRetry();
			}
		}, this.retryInterval);
	}

	destroy(): void {
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
