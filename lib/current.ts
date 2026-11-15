import type { Client } from "./types/client.js";
import type { ClientModManager } from "./mods.js";

/**
 * 全局状态类
 * 存储当前主客户端引用和全局运行时属性
 * 用于管理全局状态和跨模块通信
 */
export default class Current {
	/** 当前主客户端连接实例 */
	static client: Client | null = null;

	/** 客户端 Mod 管理器映射（client -> ClientModManager） */
	static clientMods = new Map<Client, ClientModManager>();

	/** 运行时属性键值存储（如循环定时器 ID 等） */
	static properties: Record<string, unknown> = {};

	/**
	 * 检查指定属性是否存在
	 */
	static has(key: string): boolean {
		return key in this.properties;
	}

	/**
	 * 获取指定属性值
	 */
	static get<T = unknown>(key: string): T | undefined {
		return this.properties[key] as T | undefined;
	}

	/**
	 * 设置指定属性值
	 */
	static set<T>(key: string, value: T): T {
		this.properties[key] = value;
		return value;
	}

	/**
	 * 注册一个已连接的客户端
	 * @returns 当前主客户端
	 */
	static addClient(client: Client, manager?: ClientModManager): Client | null {
		if (manager) this.clientMods.set(client, manager);
		// Only approved clients may become the main client. Pending clients stay
		// connected so the WebUI can approve them, but must not receive commands.
		if (!this.client && client.trusted !== false) this.client = client;
		return this.client;
	}

	/**
	 * 移除一个客户端；若它是主客户端则从剩余连接中选举新的主客户端
	 * @returns 新的主客户端
	 */
	static removeClient(client: Client): Client | null {
		this.clientMods.delete(client);
		if (this.client !== client) return this.client;

		// Never promote a pending client. Pick the first approved remaining one.
		this.client = null;
		for (const candidate of this.clientMods.keys()) {
			if (candidate.trusted !== false) {
				this.client = candidate;
				break;
			}
		}
		// 仍有客户端时保留全局属性（如循环任务 ID），否则清理
		if (!this.client) this.properties = {};
		return this.client;
	}

	/**
	 * 切换主客户端（同一连接重复调用是幂等的）
	 */
	static setMain(client: Client | null): Client | null {
		if (client && client.trusted === false) return this.client;
		if (client && !this.clientMods.has(client)) {
			const manager = client.clientMod;
			if (manager) this.clientMods.set(client, manager);
		}
		this.client = client;
		return this.client;
	}

	/**
	 * 重置所有状态（进程退出时调用）
	 */
	static reset(): void {
		this.client = null;
		this.clientMods.clear();
		this.properties = {};
	}
}
