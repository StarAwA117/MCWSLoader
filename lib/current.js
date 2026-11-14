/**
 * 全局状态类
 * 存储当前主客户端引用和全局运行时属性
 * 用于管理全局状态和跨模块通信
 */
export default class Current {
	/**
	 * 当前主客户端连接实例
	 * @type {Object|null}
	 */
	static client = null;

	/**
	 * 客户端 Mod 管理器映射（ws -> ClientModManager）
	 * @type {Map<Object, Object>}
	 */
	static clientMods = new Map();

	/**
	 * 运行时属性键值存储（如循环定时器 ID 等）
	 * @type {Object}
	 */
	static properties = {};

	/**
	 * 检查指定属性是否存在
	 * @param {string} key - 属性键名
	 * @returns {boolean} 属性是否存在
	 */
	static has(key) {
		return key in this.properties;
	}

	/**
	 * 获取指定属性值
	 * @param {string} key - 属性键名
	 * @returns {*} 属性值
	 */
	static get(key) {
		return this.properties[key];
	}

	/**
	 * 设置指定属性值
	 * @param {string} key - 属性键名
	 * @param {*} value - 属性值
	 * @returns {*} 设置的值
	 */
	static set(key, value) {
		return this.properties[key] = value;
	}

	/**
	 * 注册一个已连接的客户端
	 * @param {Object} client - 客户端连接
	 * @param {Object} manager - 该客户端的 ClientModManager
	 * @returns {Object|null} 当前主客户端
	 */
	static addClient(client, manager) {
		if (manager) this.clientMods.set(client, manager);
		if (!this.client) this.client = client;
		return this.client;
	}

	/**
	 * 移除一个客户端；若它是主客户端则从剩余连接中选举新的主客户端
	 * @param {Object} client - 客户端连接
	 * @returns {Object|null} 新的主客户端
	 */
	static removeClient(client) {
		this.clientMods.delete(client);
		if (this.client !== client) return this.client;

		this.client = this.clientMods.keys().next().value || null;
		this.properties = {};
		return this.client;
	}

	/**
	 * 切换主客户端（同一连接重复调用是幂等的）
	 * @param {Object} client - 新的主客户端
	 * @returns {Object|null} 实际生效的主客户端
	 */
	static setMain(client) {
		if (client && !this.clientMods.has(client)) this.clientMods.set(client, client.clientMod);
		this.client = client || null;
		return this.client;
	}

	/**
	 * 重置所有状态（进程退出时调用）
	 */
	static reset() {
		this.client = null;
		this.clientMods.clear();
		this.properties = {};
	}
}


