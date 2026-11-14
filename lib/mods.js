import { logger, messageLogger } from "./logger.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import readline from "readline";
import Current from "./current.js";
import Command from "./command.js";
import { SAPIMessageHandler } from "./sapi.js";
import { installNpmDependency, parseDependency } from "./modinstall.js";

// Default client mod class (auto-loaded, no manifest scanning)
import DefaultTool from "./tool.js";

// Terminal readline lib
import * as terminal from "./readline.js";

const DEFAULT_CLIENT_MODS = { tool: DefaultTool };

// 权限等级对应表（与 PermissionManager 保持一致）
const TIER_LEVELS = { normal: 0, user: 1, op: 2, owner: 3 };

// Lazy imports for injection (avoid circular deps)
let _PermissionManager = null;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MOD_DIR = path.resolve(__dirname, "..", "mod");
const CONFIG_PATH = path.resolve(__dirname, "..", "config.json");
const MODS_CONFIG_PATH = path.join(MOD_DIR, "mods_config.json");

// ==================== Global Config ====================

let rawConfig;
try {
	rawConfig = fs.readFileSync(CONFIG_PATH, "utf-8");
} catch (e) {
	throw new Error(`Failed to read config.json: ${e.message}`);
}
export const config = JSON.parse(rawConfig);

// 兼容旧版配置结构，将 safety/顶层 rateLimit 迁移到新路径
function normalizeConfig(cfg) {
	if (!cfg || typeof cfg !== "object") return cfg;
	const conn = (cfg.ws && cfg.ws.connection) || {};
	const cmd = (cfg.command) || {};
	// 旧 safety 连接相关 -> ws.connection
	const safety = (cfg.safety) || {};
	if (safety.rateLimitWindow !== undefined && conn.rateLimitWindow === undefined) conn.rateLimitWindow = safety.rateLimitWindow;
	if (safety.rateLimitMax !== undefined && conn.rateLimitMax === undefined) conn.rateLimitMax = safety.rateLimitMax;
	if (safety.enableMaxConnections !== undefined && conn.enableMaxConnections === undefined) conn.enableMaxConnections = safety.enableMaxConnections;
	if (safety.maxConnections !== undefined && conn.maxConnections === undefined) conn.maxConnections = safety.maxConnections;
	if (safety.enableConnectionRateLimit !== undefined && conn.enableConnectionRateLimit === undefined) conn.enableConnectionRateLimit = safety.enableConnectionRateLimit;
	if (safety.perMessageDeflate !== undefined && conn.perMessageDeflate === undefined) conn.perMessageDeflate = safety.perMessageDeflate;
	if (safety.maxPayload !== undefined && conn.maxPayload === undefined) conn.maxPayload = safety.maxPayload;
	if (!cfg.ws) cfg.ws = { name: cfg.ws?.name || "MCWSLoader", port: cfg.ws?.port || 8080 };
	cfg.ws.connection = conn;
	// 旧 safety 命令相关 -> command
	if (safety.commandMaxLength !== undefined && cmd.maxLength === undefined) cmd.maxLength = safety.commandMaxLength;
	// 旧顶层 rateLimit.command -> command.rateLimit
	const oldRate = (cfg.rateLimit && cfg.rateLimit.command) || {};
	const rate = (cmd.rateLimit) || {};
	if (oldRate.enabled !== undefined && rate.enabled === undefined) rate.enabled = oldRate.enabled;
	if (oldRate.windowMs !== undefined && rate.windowMs === undefined) rate.windowMs = oldRate.windowMs;
	if (oldRate.maxPerWindow !== undefined && rate.maxPerWindow === undefined) rate.maxPerWindow = oldRate.maxPerWindow;
	cmd.rateLimit = rate;
	cfg.command = cmd;
	// 删除旧顶层 rateLimit 避免混淆
	if (cfg.rateLimit) delete cfg.rateLimit;
	// 删除旧 safety 避免混淆
	if (cfg.safety) delete cfg.safety;
	return cfg;
}
normalizeConfig(config);

Command.commandPrefix = sanitizePrefix(config.commandPrefix);
config.commandPrefix = Command.commandPrefix;

// 空前缀会让所有聊天消息都被当成命令；配置里出现非法值时回退到默认值
function sanitizePrefix(prefix) {
	return (typeof prefix === "string" && prefix && !/\s/.test(prefix)) ? prefix : "$";
}

export function reloadConfig() {
	const fresh = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
	const prevPrefix = Command.commandPrefix;
	for (const k of Object.keys(config)) delete config[k];
	Object.assign(config, fresh);
	normalizeConfig(config);
	if (fresh.commandPrefix == null) config.commandPrefix = prevPrefix;
	config.commandPrefix = sanitizePrefix(config.commandPrefix);
	Command.commandPrefix = config.commandPrefix;
	// config.json 全量替换后，Mod 合并配置缓存全部失效
	modRegistry.invalidateConfigCache();
	return config;
}

// ==================== Deep Merge ====================

function mergeDeep(target, ...sources) {
	for (const source of sources) {
		if (!source) continue;
		for (const key of Object.keys(source)) {
			if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
				if (!target[key] || typeof target[key] !== "object") target[key] = {};
				mergeDeep(target[key], source[key]);
			} else {
				target[key] = source[key];
			}
		}
	}
	return target;
}

// ==================== Mod Registry ====================

class ModRegistry {
	constructor() {
		this.mods = new Map();
		// name -> entry（Mod 名不保证唯一，先注册者优先，与旧的 find() 行为一致）
		this.byName = new Map();
		// id -> 合并后的配置（避免每个客户端实例重复深拷贝整份 config）
		this._mergedCache = new Map();
	}

	_loadModsConfig() {
		if (!fs.existsSync(MODS_CONFIG_PATH)) return new Map();
		try {
			const arr = JSON.parse(fs.readFileSync(MODS_CONFIG_PATH, "utf-8"));
			const map = new Map();
			for (const item of arr) {
				if (item && typeof item.name === "string") {
					map.set(item.name, { enabled: item.enabled !== false });
				}
			}
			return map;
		} catch (e) {
			logger.warning(`mods_config.json parse failed: ${e.message}`);
			return new Map();
		}
	}

	_saveModsConfig(configMap) {
		const arr = [];
		for (const [name, { enabled }] of configMap) {
			arr.push({ name, enabled });
		}
		fs.writeFileSync(MODS_CONFIG_PATH, JSON.stringify(arr, null, "\t") + "\n", "utf-8");
	}

	_ensureModInConfig(configMap, modId) {
		if (!configMap.has(modId)) {
			configMap.set(modId, { enabled: false });
			return true;
		}
		return false;
	}

	scan() {
		this.mods.clear();
		this.byName.clear();
		this._mergedCache.clear();
		if (!fs.existsSync(MOD_DIR)) return;

		const modsConfig = this._loadModsConfig();
		let changed = false;

		const entries = fs.readdirSync(MOD_DIR, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const modPath = path.join(MOD_DIR, entry.name);
			const manifestPath = path.join(modPath, "manifest.json");
			if (!fs.existsSync(manifestPath)) continue;

			try {
				const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
				const modId = manifest.uuid || entry.name;
				const modName = manifest.name || entry.name;

			const configPath = path.join(modPath, "config.json");
			const configExamplePath = path.join(modPath, "config.example.json");
			const hasConfig = fs.existsSync(configPath) || fs.existsSync(configExamplePath);
			const hasReadme = fs.existsSync(path.join(modPath, "README.md"));

			if (!fs.existsSync(configPath) && fs.existsSync(configExamplePath)) {
				fs.copyFileSync(configExamplePath, configPath);
			}

			let modConfig = {};
			if (fs.existsSync(configPath)) {
				modConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
			}

			const isNew = this._ensureModInConfig(modsConfig, modId);
			if (isNew) changed = true;
			const enabled = modsConfig.get(modId).enabled;

			this.mods.set(modId, {
				id: modId,
				name: modName,
				description: manifest.description || "",
				version: manifest.version || "0.0.0",
				author: manifest.author || "",
				enabled,
				entry: {
					server: manifest.entry?.server || null,
					client: manifest.entry?.client || null
				},
				path: modPath,
				config: modConfig,
				hasConfig,
				hasReadme,
				loaded: false,
				serverClass: null,
				clientClass: null,
				serverInstance: null
			});
			if (!this.byName.has(modName)) this.byName.set(modName, this.mods.get(modId));
			} catch (e) {
				logger.error(`Mod ${entry.name} manifest parse failed: ${e.message}`);
			}
		}

		if (changed) this._saveModsConfig(modsConfig);
	}

	getMergedConfig(modId) {
		const entry = this.mods.get(modId);
		if (!entry) return config;
		if (this._mergedCache.has(modId)) return this._mergedCache.get(modId);
		const merged = mergeDeep({}, config, entry.config);
		this._mergedCache.set(modId, merged);
		return merged;
	}

	// 配置变化后使缓存失效（config.json 热重载 / Mod 配置保存）
	invalidateConfigCache(modId) {
		if (modId === undefined) this._mergedCache.clear();
		else this._mergedCache.delete(modId);
	}

	list() { return [...this.mods.values()]; }
	get(modId) { return this.mods.get(modId) || null; }
	getByName(name) { return this.byName.get(name) || null; }

	enable(modId) {
		const entry = this.mods.get(modId);
		if (!entry) return { ok: false, message: `Mod "${modId}" not found` };
		entry.enabled = true;
		this._writeModsConfig(entry);
		return { ok: true, message: `Mod "${entry.name}" enabled` };
	}

	disable(modId) {
		const entry = this.mods.get(modId);
		if (!entry) return { ok: false, message: `Mod "${modId}" not found` };
		entry.enabled = false;
		this._writeModsConfig(entry);
		return { ok: true, message: `Mod "${entry.name}" disabled` };
	}

	_writeModsConfig(entry) {
		const configMap = this._loadModsConfig();
		configMap.set(entry.id, { enabled: entry.enabled });
		this._saveModsConfig(configMap);
	}

	// 从 mods_config.json 中移除记录（不删除文件）
	forget(modId) {
		const configMap = this._loadModsConfig();
		const changed = configMap.delete(modId);
		if (changed) this._saveModsConfig(configMap);
		const entry = this.mods.get(modId);
		this.mods.delete(modId);
		this._mergedCache.delete(modId);
		if (entry && this.byName.get(entry.name) === entry) this.byName.delete(entry.name);
		return changed;
	}

	// 删除模组：移除文件夹并从 mods_config.json 中删除
	remove(modId) {
		const entry = this.mods.get(modId);
		if (!entry) return { ok: false, message: `Mod "${modId}" not found` };
		try {
			fs.rmSync(entry.path, { recursive: true, force: true });
		} catch (e) {
			return { ok: false, message: `Failed to delete mod files: ${e.message}` };
		}
		this.forget(modId);
		return { ok: true, name: entry.name, id: modId };
	}
}

// ==================== EventBus ====================

class EventBus {
	constructor() { this.listeners = new Map(); }

	on(event, modName, callback) {
		if (!this.listeners.has(event)) this.listeners.set(event, new Map());
		const eventMap = this.listeners.get(event);
		if (!eventMap.has(modName)) eventMap.set(modName, []);
		eventMap.get(modName).push(callback);
	}

	off(event, modName) {
		if (this.listeners.has(event)) this.listeners.get(event).delete(modName);
	}

	emit(event, data, excludeMod = null) {
		if (!this.listeners.has(event)) return;
		const eventMap = this.listeners.get(event);
		for (const [modName, callbacks] of eventMap) {
			if (modName === excludeMod) continue;
			for (const cb of callbacks) {
				try { cb(data); } catch (e) {
					logger.error(`EventBus: ${modName}.${event} execution error`);
					logger.debug(e.message);
				}
			}
		}
	}

	clearMod(modName) {
		for (const [, eventMap] of this.listeners) eventMap.delete(modName);
	}

	clear() { this.listeners.clear(); }
}

// ==================== Storage ====================

class ModStorage {
	constructor(modName) { this.modName = modName; this.data = new Map(); }
	get(key, defaultValue) { return this.data.has(key) ? this.data.get(key) : defaultValue; }
	set(key, value) { this.data.set(key, value); }
	delete(key) { return this.data.delete(key); }
	has(key) { return this.data.has(key); }
	clear() { this.data.clear(); }
	keys() { return [...this.data.keys()]; }
	values() { return [...this.data.values()]; }
	entries() { return [...this.data.entries()]; }
}

class ModLogger {
	constructor(modName) { this.prefix = `[${modName}]`; }
	info(...args) { logger.info(`${this.prefix} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`); }
	warning(...args) { logger.warning(`${this.prefix} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`); }
	error(...args) { logger.error(`${this.prefix} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`); }
	debug(...args) { logger.debug(`${this.prefix} ${args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}`); }
}

// ==================== Global Singletons ====================

export const eventBus = new EventBus();

export class StorageManager {
	static stores = new Map();
	static getStore(modName) {
		if (!this.stores.has(modName)) this.stores.set(modName, new ModStorage(modName));
		return this.stores.get(modName);
	}
	static clearStore(modName) {
		const store = this.stores.get(modName);
		if (store) { store.clear(); this.stores.delete(modName); }
	}
	static clearAll() {
		for (const [, store] of this.stores) store.clear();
		this.stores.clear();
	}
}

// ==================== Mod Registry (global) ====================

export const modRegistry = new ModRegistry();


// ==================== Client Mod Manager ====================

export class ClientModManager {
	static loadedMod = {};

	// 按当前 modRegistry 同步已注册的 Mod（启用/禁用/导入后调用）
	static async syncClasses() {
		if (!_PermissionManager) _PermissionManager = (await import("./permission.js")).default;

		// 内置 Mod 始终保留
		for (const [name, ModClass] of Object.entries(DEFAULT_CLIENT_MODS)) {
			ClientModManager.loadedMod[name] = ModClass;
		}

		const enabled = modRegistry.list().filter(e => e.enabled && e.entry.client);
		const enabledNames = new Set(enabled.map(e => e.name));

		// 删除已禁用 / 已删除的 Mod，避免新客户端继续实例化
		for (const name of Object.keys(ClientModManager.loadedMod)) {
			if (DEFAULT_CLIENT_MODS[name]) continue;
			if (!enabledNames.has(name)) delete ClientModManager.loadedMod[name];
		}

		// 加载尚未注册的 Mod
		for (const entry of enabled) {
			if (ClientModManager.loadedMod[entry.name]) continue;
			try {
				const modModule = await import(path.join(entry.path, entry.entry.client));
				const modClass = modModule.default;
				if (!modClass) throw new Error("no default export");
				entry.clientClass = modClass;
				ClientModManager.loadedMod[entry.name] = modClass;
				logger.info(`Client Mod ${entry.name} loaded`);
			} catch (e) {
				logger.error(`Client Mod ${entry.name} load failed: ${e.message}`);
			}
		}
	}

	static async load() {
		await ClientModManager.syncClasses();
	}

	constructor(client) {
		this.client = client;
		this.modInstances = {};
		this.commands = { normal: [], user: [], op: [], owner: [] };
		this._commandIndex = new Map();
		this._methodCache = new WeakMap();
		this._methodLists = new Map();
		this.sapi = new SAPIMessageHandler(this.client);
		this._playerMessageCallback = null;
		// Mod 执行时通过 client.clientMod 访问命令表，必须在实例化前挂上
		if (client) client.clientMod = this;
		this.instantiate();
		this.message();
	}

	_resolveModMethod(instance, name) {
		if (!instance) return null;
		let cache = this._methodCache.get(instance);
		if (cache && cache.has(name)) return cache.get(name);
		let resolved = null;
		if (typeof instance[name] === "function") resolved = { fn: instance[name], ctx: instance };
		else {
			const cls = instance.constructor;
			if (cls && typeof cls[name] === "function") resolved = { fn: cls[name], ctx: cls };
		}
		if (!cache) { cache = new Map(); this._methodCache.set(instance, cache); }
		cache.set(name, resolved);
		return resolved;
	}

	// 构建 lifecycle 方法索引，避免每个网络包都遍历所有 Mod 做属性查找
	_buildMethodLists() {
		const names = [
			"onStart", "onDestroy", "onPocket", "onMessage",
			"onClientConnect", "onClientDisconnect", "onMainClientConnect", "onMainClientSwitch"
		];
		this._methodLists = new Map(names.map(n => [n, []]));
		for (const [name, instance] of Object.entries(this.modInstances)) {
			for (const methodName of names) {
				const m = this._resolveModMethod(instance, methodName);
				if (m) this._methodLists.get(methodName).push({ name, ...m });
			}
		}
	}

	instantiate() {
		// Load default client mods first
		for (const [name, ModClass] of Object.entries(DEFAULT_CLIENT_MODS)) {
			if (!ClientModManager.loadedMod[name]) {
				ClientModManager.loadedMod[name] = ModClass;
			}
		}
		for (const [name, ModClass] of Object.entries(ClientModManager.loadedMod)) {
			try { this._instantiateMod(name, ModClass); }
			catch (e) {
				logger.error(`Client Mod ${name} instantiation failed`);
				logger.debug(e.message);
			}
		}
		this._buildMethodLists();
		this._collectCommands();
	}

	_instantiateMod(name, ModClass) {
		const entry = modRegistry.getByName(name);
		let mergedConfig;
		if (entry) {
			mergedConfig = modRegistry.getMergedConfig(entry.id);
		} else if (DEFAULT_CLIENT_MODS[name]) {
			// Default mod: load config from lib/<name>.config.json
			try {
				const cfgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), `${name}.config.json`);
				const modConfig = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
				mergedConfig = { ...config, ...modConfig };
			} catch {
				mergedConfig = config;
			}
		} else {
			mergedConfig = config;
		}

		if (ModClass && typeof ModClass === "function") ModClass.config = mergedConfig;
		const instance = new ModClass(this.client);

		instance.modName = name;
		instance.config = mergedConfig;
		// 部分 Mod 不在 constructor 中保存 client，这里兜底
		if (!instance.client) instance.client = this.client;
		const clientId = this.client?.id || "unknown";
		instance.storage = StorageManager.getStore(`client_${clientId}_${name}`);
		instance.logger = new ModLogger(`Client:${name}`);

		// Inject common dependencies
		const deps = {
			Command, Current, logger, messageLogger, fs, path, fileURLToPath, exec, readline: terminal,
			PermissionManager: _PermissionManager,
			ServerModManager, ClientModManager, reloadConfig
		};
		for (const [k, v] of Object.entries(deps)) {
			instance[k] = v;
			if (ModClass && typeof ModClass === "function") ModClass[k] = v;
		}

		instance.emit = (event, data) => {
			// 只有主客户端拥有全局事件总线；用本管理器自己的实例表，
			// 避免依赖 Current.clientMods（主客户端切换时会被清空）
			if (this.client !== Current.client) return;
			for (const [mn, mod] of Object.entries(this.modInstances)) {
				if (mod._listeners && mod._listeners[event]) {
					for (const cb of mod._listeners[event]) {
						try { cb(data); } catch (e) { logger.error(`EventBus: ${mn}.${event} execution error`); }
					}
				}
			}
		};
		instance.on = (event, callback) => {
			instance._listeners = instance._listeners || {};
			instance._listeners[event] = instance._listeners[event] || [];
			instance._listeners[event].push(callback);
		};
		instance.off = (event) => { if (instance._listeners) delete instance._listeners[event]; };

		instance.sapi = this._createModSAPI(name);
		this.modInstances[name] = instance;
		this.client[name] = instance;

		const startMethod = this._resolveModMethod(instance, "onStart") || this._resolveModMethod(instance, "start");
		if (startMethod) {
			try { startMethod.fn.apply(startMethod.ctx); }
			catch (e) {
				logger.error(`Client Mod ${name}.start execution error`);
				logger.debug(e.stack || e.message);
			}
		}
		return instance;
	}

	_collectCommands() {
		const TIERS = ["normal", "user", "op", "owner"];
		this.commands = { normal: [], user: [], op: [], owner: [] };
		this._commandIndex = new Map();

		for (const [name, instance] of Object.entries(this.modInstances)) {
			const commandMethod = instance.onCommand || instance.commands;
			if (typeof commandMethod !== "function") continue;

			let cmdMap;
			try {
				cmdMap = commandMethod.call(instance);
			} catch (e) {
				logger.error(`Client Mod ${name} command collection failed: ${e.message}`);
				continue;
			}
			if (!cmdMap || typeof cmdMap !== "object") {
				logger.warning(`Client Mod ${name} onCommand() did not return an object`);
				continue;
			}

			for (const tier of TIERS) {
				const list = cmdMap[tier];
				if (list === undefined) continue;
				if (!Array.isArray(list)) {
					logger.warning(`Client Mod ${name} returned a non-array "${tier}" command bucket`);
					continue;
				}
				for (const cmd of list) {
					if (!cmd || typeof cmd.name !== "string" || !cmd.name) {
						logger.warning(`Client Mod ${name} registered an invalid command in "${tier}"`);
						continue;
					}
					if (this._commandIndex.has(cmd.name)) {
						const prev = this._commandIndex.get(cmd.name);
						logger.warning(`Duplicate command "${cmd.name}" from mod ${name} ignored (already provided by ${prev.mod})`);
						continue;
					}
					this.commands[tier].push(cmd);
					this._commandIndex.set(cmd.name, { cmd, tier, mod: name });
				}
			}
		}
	}

	// 卸载单个 Mod 实例（不修改 loadedMod，reload 复用）
	unload(name) {
		const instance = this.modInstances[name];
		if (!instance) return false;

		const dm = this._resolveModMethod(instance, "onDestroy") || this._resolveModMethod(instance, "destroy");
		if (dm) { try { dm.fn.apply(dm.ctx); } catch {} }
		if (this.sapi && typeof this.sapi.clearMod === "function") this.sapi.clearMod(name);
		if (this.client?.utils && typeof this.client.utils.removeOwner === "function") this.client.utils.removeOwner(name);
		eventBus.clearMod(`client_${this.client?.id || "unknown"}_${name}`);
		if (this.client) this.client[name] = null;
		delete this.modInstances[name];
		this._methodLists.forEach(list => {
			const idx = list.findIndex(m => m.name === name);
			if (idx !== -1) list.splice(idx, 1);
		});
		this._collectCommands();
		return true;
	}

	async reload(name) {
		const entry = modRegistry.getByName(name);
		const isDefault = !entry && DEFAULT_CLIENT_MODS[name];

		if (!entry && !isDefault) {
			return { success: false, message: `Client Mod "${name}" not found` };
		}

		this.unload(name);

		try {
			const modPath = isDefault
				? path.join(path.dirname(fileURLToPath(import.meta.url)), `${name}.js`)
				: path.join(entry.path, entry.entry.client);
			const modModule = await import(`${modPath}?t=${Date.now()}`);
			const modClass = modModule.default;
			if (!modClass) return { success: false, message: `Client Mod "${name}" no default export` };
			if (entry) entry.clientClass = modClass;
			ClientModManager.loadedMod[name] = modClass;
			this._instantiateMod(name, modClass);
			this._buildMethodLists();
			this._collectCommands();
			logger.info(`Client Mod ${name} reloaded`);
			return { success: true, message: `Client Mod ${name} reloaded` };
		} catch (e) {
			logger.error(`Client Mod ${name} reload failed: ${e.message}`);
			return { success: false, message: `Client Mod ${name} reload failed: ${e.message}` };
		}
	}

	// 全量同步：新启用的 Mod 会实例化，已禁用/移除的会被卸载
	async reloadAll() {
		const success = [], failed = [];

		// 1) 卸载 loadedMod 中已不存在的实例
		for (const name of Object.keys(this.modInstances)) {
			if (!ClientModManager.loadedMod[name]) {
				this.unload(name);
				success.push(name);
			}
		}

		// 2) 新 Mod 实例化，已有 Mod 重新导入
		for (const [name, modClass] of Object.entries(ClientModManager.loadedMod)) {
			if (!this.modInstances[name]) {
				try {
					this._instantiateMod(name, modClass);
					this._buildMethodLists();
					this._collectCommands();
					success.push(name);
				} catch (e) {
					logger.error(`Client Mod ${name} instantiation failed: ${e.message}`);
					failed.push(name);
				}
			} else {
				const r = await this.reload(name);
				r.success ? success.push(name) : failed.push(name);
			}
		}
		return { success, failed };
	}

	static async reloadAllClients() {
		// 先按 modRegistry 同步类注册表，否则新导入/启用的 Mod 永远不会加载
		await ClientModManager.syncClasses();
		const success = [], failed = [];
		for (const [client, manager] of Current.clientMods) {
			if (!manager || typeof manager.reloadAll !== "function") continue;
			const r = await manager.reloadAll();
			success.push(...r.success.map(n => `${client?.id || "?"}:${n}`));
			failed.push(...r.failed.map(n => `${client?.id || "?"}:${n}`));
		}
		return { success, failed };
	}

	_createModSAPI(modName) {
		const hub = this.sapi;
		if (!hub) return null;
		return {
			on: (type, callback) => hub.register(modName, type, callback),
			off: (type) => hub.unregister(modName, type),
			send: (type, data = {}) => hub.send(modName, type, data),
			exists: () => hub.commandExists
		};
	}

	message() {
		// 分发器读取 this.commands 的动态内容，无需因 reload 重新订阅
		if (this._playerMessageCallback) return;

		this._playerMessageCallback = async (data) => {
			const sender = data?.body?.sender;
			const msg = data?.body?.message;
			const type = data?.body?.type;
			if (!msg || !type || !sender) return;

			this.log(sender, msg, type);
			if (type !== "chat") return;

			// 与 utils 的发包限制保持一致，避免过长文本进入命令解析
			const maxLength = config.command?.maxLength ?? 461;
			if (msg.length > maxLength) return;

			const prefix = Command.commandPrefix;
			if (!prefix || !msg.startsWith(prefix)) return;

			let tokens;
			try {
				tokens = Command.parseArgs(msg);
			} catch (e) {
				this._tellError(sender, e.message);
				return;
			}
			if (!tokens.length) return;

			const PermissionManager = await import("./permission.js").then(m => m.default);
			const permission = await PermissionManager.query(sender);
			if (permission instanceof Error) {
				this._tellError(sender, permission.message);
				return;
			}
			if (permission < 0) {
				this._tellError(sender, "command permission error");
				return;
			}

			const commandName = tokens[0];
			const entry = this._commandIndex.get(commandName.slice(prefix.length));
			if (!entry) {
				this._tellError(sender, `unknown command ${commandName}`);
				return;
			}

			const required = TIER_LEVELS[entry.tier];
			if (permission < required) {
				this._tellError(sender, "permission denied");
				return;
			}

			this._runCommand(entry.cmd, sender, tokens);
		};

		if (this.client && typeof this.client.subscribe === "function") {
			this.client.subscribe("PlayerMessage", this._playerMessageCallback);
		}
	}

	_tellError(sender, message) {
		if (!this.client) return;
		const text = `§cCommand | §fError > §i${message}`;
		if (sender) this.client.tell(text, sender);
		else this.client.tellAll(text);
	}

	_runCommand(cmd, sender, tokens) {
		try {
			cmd.onError = (e) => {
				this._tellError(sender, e.message);
				logger.debug(e.stack || e.message);
			};
			const result = typeof cmd.executeTokens === "function"
				? cmd.executeTokens(sender, tokens)
				: cmd.execute(sender, tokens.join(" "));
			if (result && !result.status && result.message) this._tellError(sender, result.message);
		} catch (e) {
			logger.error(`Command ${cmd.name} execution error: ${e.message}`);
			this._tellError(sender, e.message);
		}
	}

	log(sender, msg, type) {
		if (type === "chat" && this.client === Current.client) messageLogger.log(`<${sender}> ${msg}`);
	}

	// 兼容旧调用：按命令列表依次尝试（terminal 与外部 Mod 可能仍在使用）
	execute(sender, msg, cmds) {
		let tokens;
		try {
			tokens = Command.parseArgs(msg);
		} catch (e) {
			this._tellError(sender, e.message);
			return false;
		}
		for (const cmd of cmds) {
			if (typeof cmd.matches === "function") {
				if (!cmd.matches(tokens)) continue;
				this._runCommand(cmd, sender, tokens);
				return false;
			}
			// 旧版 Command：execute() 自带解析，只能在匹配时执行
			const result = cmd.execute(sender, msg);
			if (result) {
				if (!result.status && result.message) this._tellError(sender, result.message);
				return false;
			}
		}
		return true;
	}

	callModMethod(methodName, ...args) {
		let list = this._methodLists.get(methodName);
		if (!list) {
			// 未预先索引的自定义方法：现场解析并缓存
			list = [];
			for (const [name, instance] of Object.entries(this.modInstances)) {
				const m = this._resolveModMethod(instance, methodName);
				if (m) list.push({ name, ...m });
			}
			this._methodLists.set(methodName, list);
		}
		for (const { name, fn, ctx } of list) {
			try { fn.apply(ctx, args); }
			catch (e) {
				logger.error(`Client Mod ${name}.${methodName} execution error`);
				logger.debug(e.message);
			}
		}
	}

	getMod(modName) { return this.modInstances[modName] || null; }
	getAllMods() { return { ...this.modInstances }; }

	destroy() {
		this.callModMethod("onDestroy");
		if (this.sapi && typeof this.sapi.destroy === "function") this.sapi.destroy();
		this.sapi = null;
		const clientId = this.client?.id || "unknown";
		for (const [name, instance] of Object.entries(this.modInstances)) {
			instance.sapi = null;
			eventBus.clearMod(`client_${clientId}_${name}`);
			StorageManager.clearStore(`client_${clientId}_${name}`);
			this.client[name] = null;
		}
		this.client = null;
		this.modInstances = {};
		this.commands = { normal: [], user: [], op: [], owner: [] };
		this._commandIndex = new Map();
		this._methodLists = new Map();
	}
}


// ==================== Server Mod Manager (Singleton) ====================

export class ServerModManager {
	static _instance = null;

	static loadedMod = {};

	// 按 modRegistry 同步服务端 Mod 类注册表
	static async syncClasses() {
		if (!_PermissionManager) _PermissionManager = (await import("./permission.js")).default;

		const enabled = modRegistry.list().filter(e => e.enabled && e.entry.server);
		const enabledNames = new Set(enabled.map(e => e.name));

		for (const name of Object.keys(ServerModManager.loadedMod)) {
			if (!enabledNames.has(name)) delete ServerModManager.loadedMod[name];
		}

		for (const entry of enabled) {
			if (ServerModManager.loadedMod[entry.name]) continue;
			try {
				const modModule = await import(path.join(entry.path, entry.entry.server));
				const modClass = modModule.default;
				if (!modClass) throw new Error("no default export");
				entry.serverClass = modClass;
				ServerModManager.loadedMod[entry.name] = modClass;
				logger.info(`Server Mod ${entry.name} loaded`);
			} catch (e) {
				logger.error(`Server Mod ${entry.name} load failed: ${e.message}`);
			}
		}
	}

	static async load() {
		await ServerModManager.syncClasses();

		// 创建单例并实例化
		ServerModManager._instance = new ServerModManager();

		// 收集内置 + 服务端 Mod 的终端命令，启动终端交互
		terminal.collectCommands(ServerModManager, ClientModManager);
		terminal.start();
	}

	constructor() {
		if (ServerModManager._instance) {
			return ServerModManager._instance;
		}
		this.modInstances = {};
		this._destroyMethods = {};
		this._methodCache = new WeakMap();
		this._methodLists = new Map();
		this._instantiate();
	}

	_instantiate() {
		for (const [name, ModClass] of Object.entries(ServerModManager.loadedMod)) {
			this._createInstance(name, ModClass);
		}
		this._buildMethodLists();
	}

	// 实例化单个服务端 Mod（_instantiate / reload 共用，避免两份注入逻辑漂移）
	_createInstance(name, ModClass) {
		const entry = modRegistry.getByName(name);
		const mergedConfig = entry ? modRegistry.getMergedConfig(entry.id) : config;
		let instance;
		try {
			instance = new ModClass();
		} catch (e) {
			logger.error(`Server Mod ${name} instantiation failed: ${e.message}`);
			return null;
		}

		instance.modName = name;
		instance.config = mergedConfig;
		if (typeof ModClass === "function") ModClass.config = mergedConfig;
		instance.storage = StorageManager.getStore(`server_${name}`);
		instance.logger = new ModLogger(`Server:${name}`);
		instance.emit = (event, data) => eventBus.emit(event, data, name);
		instance.on = (event, callback) => eventBus.on(event, name, callback);
		instance.off = (event) => eventBus.off(event, name);

		// Inject common dependencies
		const deps = {
			Command, Current, logger, messageLogger, fs, path, fileURLToPath, exec, readline: terminal,
			PermissionManager: _PermissionManager,
			ServerModManager, ClientModManager, reloadConfig
		};
		for (const [k, v] of Object.entries(deps)) {
			instance[k] = v;
			if (typeof ModClass === "function") ModClass[k] = v;
		}

		this.modInstances[name] = instance;

		// 解析 onStart/start（兼容实例方法和静态方法）
		const startMethod = this._resolveMethod(instance, "onStart") || this._resolveMethod(instance, "start");
		if (startMethod) {
			const startName = typeof instance.onStart === "function" ? "onStart" : "start";
			try { startMethod.fn.apply(startMethod.ctx); }
			catch (e) {
				logger.error(`Server Mod ${name}.${startName} execution error`);
				logger.debug(e.stack || e.message);
			}
		}

		// 解析 onDestroy/destroy
		const destroyMethod = this._resolveMethod(instance, "onDestroy") || this._resolveMethod(instance, "destroy");
		if (destroyMethod) this._destroyMethods[name] = destroyMethod;

		return instance;
	}

	_resolveMethod(instance, name) {
		if (!instance) return null;
		let cache = this._methodCache.get(instance);
		if (cache && cache.has(name)) return cache.get(name);
		let resolved = null;
		if (typeof instance[name] === "function") resolved = { fn: instance[name], ctx: instance };
		else {
			const cls = instance.constructor;
			if (cls && typeof cls[name] === "function") resolved = { fn: cls[name], ctx: cls };
		}
		if (!cache) { cache = new Map(); this._methodCache.set(instance, cache); }
		cache.set(name, resolved);
		return resolved;
	}

	_buildMethodLists() {
		const names = [
			"onStart", "onDestroy", "onPocket", "onMessage",
			"onClientConnect", "onClientDisconnect", "onMainClientConnect", "onMainClientSwitch"
		];
		this._methodLists = new Map(names.map(n => [n, []]));
		for (const [name, instance] of Object.entries(this.modInstances)) {
			for (const methodName of names) {
				const m = this._resolveMethod(instance, methodName);
				if (m) this._methodLists.get(methodName).push({ name, ...m });
			}
		}
	}

	static _inst() {
		return ServerModManager._instance;
	}

	// 卸载单个服务端 Mod 实例（不改 loadedMod，reload 复用）
	unload(name) {
		const instance = this.modInstances[name];
		if (!instance) return false;
		const destroyMethod = this._destroyMethods[name] || this._resolveMethod(instance, "onDestroy") || this._resolveMethod(instance, "destroy");
		if (destroyMethod) { try { destroyMethod.fn.apply(destroyMethod.ctx); } catch {} }
		eventBus.clearMod(name);
		delete this.modInstances[name];
		delete this._destroyMethods[name];
		this._methodLists.forEach(list => {
			const idx = list.findIndex(m => m.name === name);
			if (idx !== -1) list.splice(idx, 1);
		});
		return true;
	}

	async reload(name) {
		const entry = modRegistry.getByName(name);
		if (!entry || !entry.entry.server) {
			return { success: false, message: `Server Mod "${name}" not found` };
		}

		this.unload(name);

		try {
			const modPath = path.join(entry.path, entry.entry.server);
			const modModule = await import(`${modPath}?t=${Date.now()}`);
			const modClass = modModule.default;
			if (!modClass) return { success: false, message: `Server Mod "${name}" no default export` };

			entry.serverClass = modClass;
			ServerModManager.loadedMod[name] = modClass;
			if (!this._createInstance(name, modClass)) {
				return { success: false, message: `Server Mod "${name}" instantiation failed` };
			}
			this._buildMethodLists();
			logger.info(`Server Mod ${name} reloaded`);
			return { success: true, message: `Server Mod ${name} reloaded` };
		} catch (e) {
			logger.error(`Server Mod ${name} reload failed: ${e.message}`);
			return { success: false, message: `Server Mod ${name} reload failed: ${e.message}` };
		}
	}

	// 全量同步：实例化新启用的 Mod，卸载已禁用/移除的 Mod，其余重载
	async reloadAll() {
		const success = [], failed = [];

		for (const name of Object.keys(this.modInstances)) {
			if (!ServerModManager.loadedMod[name]) {
				this.unload(name);
				success.push(name);
			}
		}

		for (const [name] of Object.entries(ServerModManager.loadedMod)) {
			if (!this.modInstances[name]) {
				if (this._createInstance(name, ServerModManager.loadedMod[name])) success.push(name);
				else failed.push(name);
			} else {
				const result = await this.reload(name);
				result.success ? success.push(name) : failed.push(name);
			}
		}
		this._buildMethodLists();

		// 重载后服务端 Mod 的终端命令需要重新收集，否则会指向旧实例
		terminal.collectCommands(ServerModManager, ClientModManager);
		return { success, failed };
	}

	static async reloadAll() {
		await ServerModManager.syncClasses();
		const inst = ServerModManager._instance;
		if (!inst) return { success: [], failed: [] };
		return inst.reloadAll();
	}

	static getLoadedModNames() {
		return Object.keys(ServerModManager.loadedMod);
	}

	static attachMainClient(client) {
		ServerModManager._inst()?.callModMethod("onMainClientConnect", client);
	}

	static onClientConnect(client, isMainClient) {
		ServerModManager._inst()?.callModMethod("onClientConnect", client, isMainClient);
	}

	static onMessage(client, data) {
		ServerModManager._inst()?.callModMethod("onMessage", client, data);
	}

	static onClientDisconnect(client, isMainClient) {
		ServerModManager._inst()?.callModMethod("onClientDisconnect", client, isMainClient);
	}

	callModMethod(methodName, ...args) {
		let list = this._methodLists.get(methodName);
		if (!list) {
			list = [];
			for (const [name, instance] of Object.entries(this.modInstances)) {
				const m = this._resolveMethod(instance, methodName);
				if (m) list.push({ name, ...m });
			}
			this._methodLists.set(methodName, list);
		}
		for (const { name, fn, ctx } of list) {
			try { fn.apply(ctx, args); }
			catch (e) {
				logger.error(`Server Mod ${name}.${methodName} execution error`);
				logger.debug(e.message);
			}
		}
	}

	static onMainClientSwitch(oldClient, newClient) {
		ServerModManager._inst()?.callModMethod("onMainClientSwitch", oldClient, newClient);
	}

	getMod(modName) { return this.modInstances[modName] || null; }
	getAllMods() { return { ...this.modInstances }; }

	static destroy() {
		const inst = ServerModManager._instance;
		if (!inst) return;
		// 先调用所有 onDestroy
		for (const [name, dm] of Object.entries(inst._destroyMethods || {})) {
			try { dm.fn.apply(dm.ctx); }
			catch (e) {
				logger.error(`Server Mod ${name}.onDestroy execution error`);
				logger.debug(e.message);
			}
		}
		for (const name of Object.keys(inst.modInstances)) {
			eventBus.clearMod(name);
			StorageManager.clearStore(`server_${name}`);
		}
		inst.modInstances = {};
		inst._destroyMethods = {};
		ServerModManager._instance = null;
		terminal.stop();
	}
}

// ==================== Dependency Checker ====================

// 启动时检查所有模组的 dependencies（npm 包名列表），缺失的自动安装
export async function checkModDependencies() {
	if (!(config.ws && config.ws.checkDependenciesOnLoad !== false)) return;
	if (!fs.existsSync(MOD_DIR)) return;
	const projectRoot = path.resolve(MOD_DIR, "..");
	for (const entry of fs.readdirSync(MOD_DIR, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const modPath = path.join(MOD_DIR, entry.name);
		let manifest;
		try {
			manifest = JSON.parse(fs.readFileSync(path.join(modPath, "manifest.json"), "utf-8"));
		} catch {
			continue;
		}
		const deps = Array.isArray(manifest.dependencies) ? manifest.dependencies : [];
		if (!deps.length) continue;
		const label = manifest.name || entry.name;
		for (const dep of deps) {
			const parsed = parseDependency(dep);
			if (!parsed) {
				logger.error(`Mod "${label}" has an invalid dependency entry (npm package name expected): ${JSON.stringify(dep)}`);
				continue;
			}
			try {
				const r = await installNpmDependency(parsed.name, projectRoot);
				if (!r.skipped) logger.info(`npm package "${r.name}" installed for mod "${label}"`);
			} catch (e) {
				logger.error(`Failed to install npm package "${parsed.name}" for mod "${label}": ${e.message}`);
			}
		}
	}
}
