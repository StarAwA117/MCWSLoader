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
import { resolveCaseInsensitivePath, resolveModuleUrl } from "./paths.js";
import PermissionManager from "./permission.js";
import type { AppConfig } from "./types/config.js";
import type { Client } from "./types/client.js";
import type { ModConstructor, ModEntry, ModSAPI } from "./types/mod.js";
import type { CommandResponse } from "./types/config.js";

type AnyRecord = Record<string, any>;
type ModClass = ModConstructor;
type ModsConfigMap = Map<string, { enabled: boolean }>;
interface ResolvedMethod {
	fn: (...args: any[]) => unknown;
	ctx: unknown;
}

// Default client mod class (auto-loaded, no manifest scanning)
import DefaultTool from "./tool.js";

// Terminal readline lib
import * as terminal from "./readline.js";

const DEFAULT_CLIENT_MODS: Record<string, ModClass> = { tool: DefaultTool as unknown as ModClass };

// 权限等级对应表（与 PermissionManager 保持一致）
const TIER_LEVELS: Record<string, number> = { normal: 0, user: 1, op: 2, owner: 3 };

// 配置合并时丢弃这些键，防止 __proto__ 原型污染
const UNSAFE_CONFIG_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function isUnsafeConfigKey(key: string): boolean {
	return UNSAFE_CONFIG_KEYS.has(key);
}

/** 深拷贝并移除 __proto__ / prototype / constructor */
export function sanitizeConfigObject<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeConfigObject(item)) as T;
	}
	if (value && typeof value === "object") {
		const out: AnyRecord = {};
		for (const [key, item] of Object.entries(value as AnyRecord)) {
			if (isUnsafeConfigKey(key)) continue;
			out[key] = sanitizeConfigObject(item);
		}
		return out as T;
	}
	return value;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MOD_DIR = path.resolve(__dirname, "..", "mods");
const CONFIG_PATH = path.resolve(__dirname, "..", "config.json");
const CONFIG_EXAMPLE_PATH = path.resolve(__dirname, "..", "config.example.json");
const MODS_CONFIG_PATH = path.join(MOD_DIR, "mods_config.json");
const PROJECT_ROOT = path.resolve(MOD_DIR, "..");

function projectRoot(): string {
	return PROJECT_ROOT;
}

// ==================== Global Config ====================

// CI / 直接导入 lib 时可能没有 config.json（被 gitignore），回退到示例配置
function readConfigText(): string {
	if (fs.existsSync(CONFIG_PATH)) return fs.readFileSync(CONFIG_PATH, "utf-8");
	if (fs.existsSync(CONFIG_EXAMPLE_PATH)) {
		// 此时 logger 可能仍在循环初始化，使用 console 避免 TDZ
		console.warn("config.json not found, using config.example.json");
		return fs.readFileSync(CONFIG_EXAMPLE_PATH, "utf-8");
	}
	throw new Error("config.json and config.example.json are both missing");
}

let rawConfig: string;
try {
	rawConfig = readConfigText();
} catch (e) {
	throw new Error(`Failed to read config.json: ${(e as Error).message}`);
}
export const config = sanitizeConfigObject(JSON.parse(rawConfig)) as AppConfig;

// 配置可能包含密码哈希，启动时收紧权限（Windows 上 chmod 语义有限，忽略失败）
try { fs.chmodSync(CONFIG_PATH, 0o600); } catch { /* ignore */ }

// 兼容旧版配置结构，将 safety/顶层 rateLimit 迁移到新路径
function normalizeConfig(cfg: AnyRecord): AnyRecord {
	if (!cfg || typeof cfg !== "object") return cfg;
	const conn: AnyRecord = (cfg.ws && cfg.ws.connection) || {};
	const cmd: AnyRecord = cfg.command || {};
	// 旧 safety 连接相关 -> ws.connection
	const safety: AnyRecord = cfg.safety || {};
	if (safety.rateLimitWindow !== undefined && conn.rateLimitWindow === undefined) conn.rateLimitWindow = safety.rateLimitWindow;
	if (safety.rateLimitMax !== undefined && conn.rateLimitMax === undefined) conn.rateLimitMax = safety.rateLimitMax;
	if (safety.enableMaxConnections !== undefined && conn.enableMaxConnections === undefined) conn.enableMaxConnections = safety.enableMaxConnections;
	if (safety.maxConnections !== undefined && conn.maxConnections === undefined) conn.maxConnections = safety.maxConnections;
	if (safety.enableConnectionRateLimit !== undefined && conn.enableConnectionRateLimit === undefined) conn.enableConnectionRateLimit = safety.enableConnectionRateLimit;
	if (safety.perMessageDeflate !== undefined && conn.perMessageDeflate === undefined) conn.perMessageDeflate = safety.perMessageDeflate;
	if (safety.maxPayload !== undefined && conn.maxPayload === undefined) conn.maxPayload = safety.maxPayload;
	if (!cfg.ws) cfg.ws = { name: "MCWSLoader", port: 8080 };
	if (!cfg.ws.host) cfg.ws.host = "127.0.0.1";
	cfg.ws.connection = conn;
	// 默认要求批准；loopback 连接在 ws.ts 中自动信任，所以本机使用无感
	if (conn.requireApproval === undefined) conn.requireApproval = true;
	if (!Array.isArray(conn.allowedIPs)) conn.allowedIPs = [];
	conn.allowedIPs = conn.allowedIPs.map((item: unknown) => String(item));
	// 旧 safety 命令相关 -> command
	if (safety.commandMaxLength !== undefined && cmd.maxLength === undefined) cmd.maxLength = safety.commandMaxLength;
	// 旧顶层 rateLimit.command -> command.rateLimit
	const oldRate = (cfg.rateLimit && cfg.rateLimit.command) || {};
	const rate = (cmd.rateLimit) || {};
	if (oldRate.enabled !== undefined && rate.enabled === undefined) rate.enabled = oldRate.enabled;
	if (oldRate.windowMs !== undefined && rate.windowMs === undefined) rate.windowMs = oldRate.windowMs;
	if (oldRate.maxPerWindow !== undefined && rate.maxPerWindow === undefined) rate.maxPerWindow = oldRate.maxPerWindow;
	cmd.rateLimit = rate;
	if (!cmd.playerRateLimit || typeof cmd.playerRateLimit !== "object") cmd.playerRateLimit = {};
	if (cmd.playerRateLimit.enabled === undefined) cmd.playerRateLimit.enabled = true;
	if (cmd.playerRateLimit.windowMs === undefined) cmd.playerRateLimit.windowMs = 5000;
	if (cmd.playerRateLimit.maxPerWindow === undefined) cmd.playerRateLimit.maxPerWindow = 10;
	if (cmd.allowShellExec === undefined) cmd.allowShellExec = false;
	cfg.command = cmd;

	if (!cfg.update || typeof cfg.update !== "object" || Array.isArray(cfg.update)) cfg.update = {};
	if (cfg.update.autoCheck === undefined) cfg.update.autoCheck = false;
	if (cfg.update.allowPrerelease === undefined) cfg.update.allowPrerelease = false;

	if (!cfg.web || typeof cfg.web !== "object") cfg.web = {};
	if (!cfg.sapi || typeof cfg.sapi !== "object" || Array.isArray(cfg.sapi)) cfg.sapi = {};
	if (!cfg.sapi.gmsg) cfg.sapi.gmsg = "gmsg";
	if (!cfg.sapi.smsg) cfg.sapi.smsg = "smsg";
	if (!cfg.utils || typeof cfg.utils !== "object" || Array.isArray(cfg.utils)) cfg.utils = {};
	if (cfg.utils.tellAllToTell === undefined) cfg.utils.tellAllToTell = false;
	if (cfg.utils.enablePolling === undefined) cfg.utils.enablePolling = true;

	if (!cfg.web.ui || typeof cfg.web.ui !== "object") cfg.web.ui = {};
	if (cfg.web.ui.theme !== "catppuccin-mocha") cfg.web.ui.theme = "star";
	if (!Array.isArray(cfg.web.ui.allowedOrigins)) cfg.web.ui.allowedOrigins = [];
	cfg.web.ui.allowedOrigins = cfg.web.ui.allowedOrigins.map((item: unknown) => String(item));
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
// 拒绝绝对路径 / 盘符 / ..，避免 manifest 的 entry 指向 Mod 目录之外
function normalizeModEntry(value: unknown): string | null {
	if (typeof value !== "string" || !value) return null;
	const normalized = value.replace(/\\/g, "/");
	if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) {
		logger.warning(`Mod entry path rejected: ${value}`);
		return null;
	}
	return normalized;
}

function sanitizePrefix(prefix: unknown): string {
	return (typeof prefix === "string" && prefix && !/\s/.test(prefix)) ? prefix : "$";
}

export function reloadConfig(): AppConfig {
	const fresh = sanitizeConfigObject(JSON.parse(readConfigText())) as AppConfig;
	const prevPrefix = Command.commandPrefix;
	for (const k of Object.keys(config)) delete config[k];
	Object.assign(config, fresh);
	normalizeConfig(config as AnyRecord);
	if (fresh.commandPrefix == null) config.commandPrefix = prevPrefix;
	config.commandPrefix = sanitizePrefix(config.commandPrefix);
	Command.commandPrefix = config.commandPrefix;
	// config.json 全量替换后，Mod 合并配置缓存全部失效
	modRegistry.invalidateConfigCache();
	return config;
}

// ==================== Deep Merge ====================

function mergeDeep(target: AnyRecord, ...sources: Array<AnyRecord | null | undefined>): AnyRecord {
	for (const source of sources) {
		if (!source) continue;
		for (const key of Object.keys(source)) {
			if (isUnsafeConfigKey(key)) continue;
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
	mods: Map<string, ModEntry>;
	byName: Map<string, ModEntry>;
	_mergedCache: Map<string, AnyRecord>;

	constructor() {
		this.mods = new Map();
		// name -> entry（Mod 名不保证唯一，先注册者优先，与旧的 find() 行为一致）
		this.byName = new Map();
		// id -> 合并后的配置（避免每个客户端实例重复深拷贝整份 config）
		this._mergedCache = new Map();
	}

	_loadModsConfig(): ModsConfigMap {
		if (!fs.existsSync(MODS_CONFIG_PATH)) return new Map();
		try {
			const arr = JSON.parse(fs.readFileSync(MODS_CONFIG_PATH, "utf-8")) as Array<AnyRecord>;
			const map: ModsConfigMap = new Map();
			for (const item of arr) {
				if (item && typeof item.name === "string") {
					map.set(item.name, { enabled: item.enabled !== false });
				}
			}
			return map;
		} catch (e) {
			logger.warning(`mods_config.json parse failed: ${(e as Error).message}`);
			return new Map();
		}
	}

	_saveModsConfig(configMap: ModsConfigMap): void {
		const arr: Array<{ name: string; enabled: boolean }> = [];
		for (const [name, { enabled }] of configMap) {
			arr.push({ name, enabled });
		}
		fs.writeFileSync(MODS_CONFIG_PATH, JSON.stringify(arr, null, "\t") + "\n", "utf-8");
	}

	_ensureModInConfig(configMap: ModsConfigMap, modId: string): boolean {
		if (!configMap.has(modId)) {
			configMap.set(modId, { enabled: false });
			return true;
		}
		return false;
	}

	_readJson(filePath: string): AnyRecord | null {
		try {
			return JSON.parse(fs.readFileSync(filePath, "utf-8")) as AnyRecord;
		} catch (e) {
			logger.warning(`${path.basename(path.dirname(filePath))}/${path.basename(filePath)} parse failed: ${(e as Error).message}`);
			return null;
		}
	}

	scan(): void {
		this.mods.clear();
		this.byName.clear();
		this._mergedCache.clear();
		if (!fs.existsSync(MOD_DIR)) return;

		const modsConfig = this._loadModsConfig();
		let changed = false;

		for (const entry of fs.readdirSync(MOD_DIR, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const modPath = path.join(MOD_DIR, entry.name);
			const manifestPath = resolveCaseInsensitivePath(modPath, "manifest.json");
			if (!manifestPath) continue;

			const manifest = this._readJson(manifestPath);
			if (!manifest) continue;

			const modId = manifest.uuid || entry.name;
			const modName = manifest.name || entry.name;
			const configPath = resolveCaseInsensitivePath(modPath, "config.json") || path.join(modPath, "config.json");
			const configExamplePath = resolveCaseInsensitivePath(modPath, "config.example.json") || path.join(modPath, "config.example.json");
			const hasConfig = fs.existsSync(configPath) || fs.existsSync(configExamplePath);
			const hasReadme = !!resolveCaseInsensitivePath(modPath, "README.md");

			if (!fs.existsSync(configPath) && fs.existsSync(configExamplePath)) {
				fs.copyFileSync(configExamplePath, configPath);
			}
			if (fs.existsSync(configPath)) {
				try { fs.chmodSync(configPath, 0o600); } catch { /* ignore */ }
			}

			// 配置损坏时回退为空对象，不应因此丢掉整个 Mod
			const modConfig: AnyRecord = fs.existsSync(configPath) ? (this._readJson(configPath) || {}) : {};

			if (this._ensureModInConfig(modsConfig, modId)) changed = true;
			const enabled = modsConfig.get(modId)?.enabled ?? false;

			const rawServer = manifest.entry?.server || null;
			const rawClient = manifest.entry?.client || null;

			this.mods.set(modId, {
				id: modId,
				name: modName,
				description: manifest.description || "",
				version: manifest.version || "0.0.0",
				author: manifest.author || "",
				enabled,
				entry: {
					server: normalizeModEntry(rawServer),
					client: normalizeModEntry(rawClient)
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
			const registered = this.mods.get(modId);
			if (registered && !this.byName.has(modName)) this.byName.set(modName, registered);
		}

		if (changed) this._saveModsConfig(modsConfig);
	}

	getMergedConfig(modId: string): AnyRecord {
		const entry = this.mods.get(modId);
		if (!entry) return config as AnyRecord;
		const cached = this._mergedCache.get(modId);
		if (cached) return cached;
		const merged = mergeDeep({}, config as AnyRecord, entry.config);
		this._mergedCache.set(modId, merged);
		return merged;
	}

	// 配置变化后使缓存失效（config.json 热重载 / Mod 配置保存）
	invalidateConfigCache(modId?: string): void {
		if (modId === undefined) this._mergedCache.clear();
		else this._mergedCache.delete(modId);
	}

	list(): ModEntry[] { return [...this.mods.values()]; }
	get(modId: string): ModEntry | null { return this.mods.get(modId) ?? null; }
	getByName(name: string): ModEntry | null { return this.byName.get(name) ?? null; }

	enable(modId: string): { ok: boolean; message: string } {
		const entry = this.mods.get(modId);
		if (!entry) return { ok: false, message: `Mod "${modId}" not found` };
		entry.enabled = true;
		this._writeModsConfig(entry);
		return { ok: true, message: `Mod "${entry.name}" enabled` };
	}

	disable(modId: string): { ok: boolean; message: string } {
		const entry = this.mods.get(modId);
		if (!entry) return { ok: false, message: `Mod "${modId}" not found` };
		entry.enabled = false;
		this._writeModsConfig(entry);
		return { ok: true, message: `Mod "${entry.name}" disabled` };
	}

	_writeModsConfig(entry: ModEntry): void {
		const configMap = this._loadModsConfig();
		configMap.set(entry.id, { enabled: entry.enabled });
		this._saveModsConfig(configMap);
	}

	// 从 mods_config.json 中移除记录（不删除文件）
	forget(modId: string): boolean {
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
	remove(modId: string): { ok: true; name: string; id: string } | { ok: false; message: string } {
		const entry = this.mods.get(modId);
		if (!entry) return { ok: false, message: `Mod "${modId}" not found` };
		try {
			fs.rmSync(entry.path, { recursive: true, force: true });
		} catch (e) {
			return { ok: false, message: `Failed to delete mod files: ${(e as Error).message}` };
		}
		this.forget(modId);
		return { ok: true, name: entry.name, id: modId };
	}
}

// ==================== EventBus ====================

type EventCallback = (data: unknown) => void;

class EventBus {
	listeners: Map<string, Map<string, EventCallback[]>>;

	constructor() { this.listeners = new Map(); }

	on(event: string, modName: string, callback: EventCallback): void {
		let eventMap = this.listeners.get(event);
		if (!eventMap) { eventMap = new Map(); this.listeners.set(event, eventMap); }
		let callbacks = eventMap.get(modName);
		if (!callbacks) { callbacks = []; eventMap.set(modName, callbacks); }
		callbacks.push(callback);
	}

	off(event: string, modName: string): void {
		this.listeners.get(event)?.delete(modName);
	}

	emit(event: string, data?: unknown, excludeMod: string | null = null): void {
		const eventMap = this.listeners.get(event);
		if (!eventMap) return;
		for (const [modName, callbacks] of eventMap) {
			if (modName === excludeMod) continue;
			for (const cb of callbacks) {
				try { cb(data); } catch (e) {
					logger.error(`EventBus: ${modName}.${event} execution error`);
					logger.debug((e as Error).message);
				}
			}
		}
	}

	clearMod(modName: string): void {
		for (const [, eventMap] of this.listeners) eventMap.delete(modName);
	}

	clear() { this.listeners.clear(); }
}

// ==================== Storage ====================

class ModStorage {
	modName: string;
	data: Map<string, unknown>;

	constructor(modName: string) {
		this.modName = modName;
		this.data = new Map();
	}

	get<T = unknown>(key: string, defaultValue?: T): T | undefined {
		return (this.data.has(key) ? this.data.get(key) : defaultValue) as T | undefined;
	}

	set(key: string, value: unknown): void { this.data.set(key, value); }
	delete(key: string): boolean { return this.data.delete(key); }
	has(key: string): boolean { return this.data.has(key); }
	clear(): void { this.data.clear(); }
	keys(): string[] { return [...this.data.keys()]; }
	values(): unknown[] { return [...this.data.values()]; }
	entries(): [string, unknown][] { return [...this.data.entries()]; }
}

function stringifyLogValue(value: unknown): string {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value) ?? String(value);
	} catch {
		return String(value);
	}
}

class ModLogger {
	prefix: string;

	constructor(modName: string) { this.prefix = `[${modName}]`; }

	_format(args: unknown[]): string {
		return `${this.prefix} ${args.map(stringifyLogValue).join(" ")}`;
	}

	info(...args: unknown[]): void { logger.info(this._format(args)); }
	warning(...args: unknown[]): void { logger.warning(this._format(args)); }
	error(...args: unknown[]): void { logger.error(this._format(args)); }
	debug(...args: unknown[]): void { logger.debug(this._format(args)); }
}

// ==================== Global Singletons ====================

export const eventBus = new EventBus();

export class StorageManager {
	static stores = new Map<string, ModStorage>();

	static getStore(modName: string): ModStorage {
		let store = this.stores.get(modName);
		if (!store) { store = new ModStorage(modName); this.stores.set(modName, store); }
		return store;
	}

	static clearStore(modName: string): void {
		const store = this.stores.get(modName);
		if (store) { store.clear(); this.stores.delete(modName); }
	}

	static clearAll(): void {
		for (const [, store] of this.stores) store.clear();
		this.stores.clear();
	}
}

// ==================== Mod Registry (global) ====================

export const modRegistry = new ModRegistry();


// ==================== Mod Manager Base ====================

const LIFECYCLE_METHODS = [
	"onStart", "onDestroy", "onPocket", "onMessage",
	"onClientConnect", "onClientDisconnect", "onMainClientConnect", "onMainClientSwitch"
];

// 注入给 Mod 的公共依赖（延迟构造一次，避免类初始化顺序问题）
let MOD_DEPENDENCIES: AnyRecord | null = null;
function getModDependencies(): AnyRecord {
	if (!MOD_DEPENDENCIES) {
		MOD_DEPENDENCIES = {
			Command, Current, logger, messageLogger, fs, path, fileURLToPath, exec,
			readline: terminal, PermissionManager, ServerModManager, ClientModManager, reloadConfig
		};
	}
	return MOD_DEPENDENCIES;
}

function injectModDependencies(instance: AnyRecord, ModClass: ModClass): void {
	for (const [key, value] of Object.entries(getModDependencies())) {
		instance[key] = value;
		// 兼容以静态属性访问依赖的 Mod（如 AIHelper.Current）
		if (typeof ModClass === "function") ModClass[key] = value;
	}
}

/**
 * 客户端 / 服务端 Mod 管理器的公共部分：
 * 方法索引、生命周期调用、卸载、实例查询。
 */
interface MethodEntry extends ResolvedMethod {
	name: string;
}

class ModManagerBase {
	modInstances: Record<string, AnyRecord>;
	_methodCache: WeakMap<AnyRecord, Map<string, ResolvedMethod | null>>;
	_methodLists: Map<string, MethodEntry[]>;
	_destroyMethods: Record<string, ResolvedMethod>;

	constructor() {
		this.modInstances = {};
		this._methodCache = new WeakMap();
		this._methodLists = new Map();
		this._destroyMethods = {};
	}

	get _label(): string { return "Mod"; }

	_resolveModMethod(instance: AnyRecord | null, name: string): ResolvedMethod | null {
		if (!instance) return null;
		let cache = this._methodCache.get(instance);
		const cached = cache?.get(name);
		if (cached !== undefined) return cached;
		let resolved: ResolvedMethod | null = null;
		if (typeof instance[name] === "function") {
			resolved = { fn: instance[name] as (...args: any[]) => unknown, ctx: instance };
		} else {
			const cls = instance.constructor as unknown as AnyRecord | undefined;
			if (cls && typeof cls[name] === "function") {
				resolved = { fn: cls[name] as (...args: any[]) => unknown, ctx: cls };
			}
		}
		if (!cache) { cache = new Map(); this._methodCache.set(instance, cache); }
		cache.set(name, resolved);
		return resolved;
	}

	// 兼容旧名称
	_resolveMethod(instance: AnyRecord | null, name: string): ResolvedMethod | null {
		return this._resolveModMethod(instance, name);
	}

	_buildMethodLists(): void {
		this._methodLists = new Map(LIFECYCLE_METHODS.map((n): [string, MethodEntry[]] => [n, []]));
		for (const [name, instance] of Object.entries(this.modInstances)) {
			for (const methodName of LIFECYCLE_METHODS) {
				const m = this._resolveModMethod(instance, methodName);
				if (m) this._methodLists.get(methodName)?.push({ name, ...m });
			}
		}
	}

	_initInstance(instance: AnyRecord, ModClass: ModClass, name: string, mergedConfig: AnyRecord, loggerName: string): void {
		instance.modName = name;
		instance.config = mergedConfig;
		if (typeof ModClass === "function") ModClass.config = mergedConfig;
		instance.storage = StorageManager.getStore(this._storageKey(name));
		instance.logger = new ModLogger(loggerName);
		injectModDependencies(instance, ModClass);
	}

	_storageKey(name: string): string { return `mod_${name}`; }

	_trackDestroy(name: string, instance: AnyRecord): void {
		const m = this._resolveModMethod(instance, "onDestroy") || this._resolveModMethod(instance, "destroy");
		if (m) this._destroyMethods[name] = m;
	}

	_startInstance(name: string, instance: AnyRecord): void {
		const m = this._resolveModMethod(instance, "onStart") || this._resolveModMethod(instance, "start");
		if (!m) return;
		try { m.fn.apply(m.ctx); }
		catch (e) {
			const err = e as Error;
			logger.error(`${this._label} Mod ${name} start execution error`);
			logger.debug(err.stack ?? err.message);
		}
	}

	_afterUnload(_name: string, _instance: AnyRecord): void {}

	// 卸载单个实例；子类通过 _afterUnload 处理 SAPI / 命令刷新等差异
	unload(name: string): boolean {
		const instance = this.modInstances[name];
		if (!instance) return false;
		const dm = this._destroyMethods[name]
			|| this._resolveModMethod(instance, "onDestroy")
			|| this._resolveModMethod(instance, "destroy");
		if (dm) { try { dm.fn.apply(dm.ctx); } catch {} }
		delete this.modInstances[name];
		delete this._destroyMethods[name];
		this._afterUnload(name, instance);
		for (const list of this._methodLists.values()) {
			const idx = list.findIndex(m => m.name === name);
			if (idx !== -1) list.splice(idx, 1);
		}
		return true;
	}

	callModMethod(methodName: string, ...args: unknown[]): void {
		let list = this._methodLists.get(methodName);
		if (!list) {
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
				logger.error(`${this._label} Mod ${name}.${methodName} execution error`);
				logger.debug((e as Error).message);
			}
		}
	}

	getMod(modName: string): AnyRecord | null { return this.modInstances[modName] ?? null; }
	getAllMods(): Record<string, AnyRecord> { return { ...this.modInstances }; }
}

// ==================== Client Mod Manager ====================

export class ClientModManager extends ModManagerBase {
	static loadedMod: Record<string, ModClass> = {};

	client: Client | null;
	commands: Record<"normal" | "user" | "op" | "owner", Command[]>;
	_commandIndex: Map<string, { cmd: Command; tier: string; mod: string }>;
	sapi: SAPIMessageHandler | null;
	_playerMessageCallback: ((data: CommandResponse) => Promise<void>) | null;
	_playerRate = new Map<string, number[]>();

	override get _label(): string { return "Client"; }
	override _storageKey(name: string): string { return `client_${this.client?.id || "unknown"}_${name}`; }

	override _afterUnload(name: string, _instance?: AnyRecord): void {
		if (this.sapi && typeof this.sapi.clearMod === "function") this.sapi.clearMod(name);
		if (this.client?.utils && typeof this.client.utils.removeOwner === "function") this.client.utils.removeOwner(name);
		eventBus.clearMod(`client_${this.client?.id || "unknown"}_${name}`);
		if (this.client) this.client[name] = null;
		this._collectCommands();
	}

	// 按当前 modRegistry 同步已注册的 Mod（启用/禁用/导入后调用）
	static async syncClasses() {
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
				if (!entry.entry.client) continue;
				const modPath = resolveCaseInsensitivePath(entry.path, entry.entry.client);
				if (!modPath) throw new Error("entry file not found");
				const modModule = await import(resolveModuleUrl(modPath));
				const modClass = modModule.default as ModClass | undefined;
				if (!modClass) throw new Error("no default export");
				entry.clientClass = modClass;
				ClientModManager.loadedMod[entry.name] = modClass;
				logger.info(`Client Mod ${entry.name} loaded`);
			} catch (e) {
				logger.error(`Client Mod ${entry.name} load failed: ${(e as Error).message}`);
			}
		}
	}

	static async load() {
		await ClientModManager.syncClasses();
	}

	constructor(client: Client) {
		super();
		this.client = client;
		this.commands = { normal: [], user: [], op: [], owner: [] };
		this._commandIndex = new Map();
		this.sapi = new SAPIMessageHandler(this.client);
		this._playerMessageCallback = null;
		// Mod 执行时通过 client.clientMod 访问命令表，必须在实例化前挂上
		if (client) client.clientMod = this;
		this.instantiate();
		this.message();
	}

	instantiate(): void {
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
				logger.debug((e as Error).message);
			}
		}
		this._buildMethodLists();
		this._collectCommands();
	}

	_instantiateMod(name: string, ModClass: ModClass): AnyRecord {
		const mergedConfig = this._mergedConfigFor(name);
		// 构造函数可能读取 ModClass.config，必须在实例化前赋值
		if (typeof ModClass === "function") ModClass.config = mergedConfig;
		const client = this.client;
		if (!client) throw new Error("client is not available");
		const instance = new ModClass(client);

		// 部分 Mod 不在 constructor 中保存 client，这里兜底
		if (!instance.client) instance.client = client;
		this._initInstance(instance, ModClass, name, mergedConfig, `Client:${name}`);

		// 客户端 Mod 的进程内事件总线（仅主客户端的 Mod 之间）
		instance.emit = (event: string, data?: unknown) => {
			if (this.client !== Current.client) return;
			for (const [mn, mod] of Object.entries(this.modInstances)) {
				if (mod._listeners && mod._listeners[event]) {
					for (const cb of mod._listeners[event]) {
						try { cb(data); } catch { logger.error(`EventBus: ${mn}.${event} execution error`); }
					}
				}
			}
		};
		instance.on = (event: string, callback: (data: unknown) => void) => {
			instance._listeners = instance._listeners || {};
			instance._listeners[event] = instance._listeners[event] || [];
			instance._listeners[event].push(callback);
		};
		instance.off = (event: string) => { if (instance._listeners) delete instance._listeners[event]; };

		instance.sapi = this._createModSAPI(name);
		this.modInstances[name] = instance;
		if (this.client) this.client[name] = instance;

		this._trackDestroy(name, instance);
		this._startInstance(name, instance);
		return instance;
	}

	// 客户端 Mod 配置：注册表配置 / 内置 Mod 的 lib/<name>.config.json / 全局配置
	_mergedConfigFor(name: string): AnyRecord {
		const entry = modRegistry.getByName(name);
		if (entry) return modRegistry.getMergedConfig(entry.id);
		if (DEFAULT_CLIENT_MODS[name]) {
			try {
				const cfgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), `${name}.config.json`);
				return { ...config, ...JSON.parse(fs.readFileSync(cfgPath, "utf-8")) };
			} catch {}
		}
		return config as AnyRecord;
	}

	_collectCommands(): void {
		const TIERS = ["normal", "user", "op", "owner"] as const;
		this.commands = { normal: [], user: [], op: [], owner: [] };
		this._commandIndex = new Map();

		for (const [name, instance] of Object.entries(this.modInstances)) {
			const commandMethod = instance.onCommand || instance.commands;
			if (typeof commandMethod !== "function") continue;

			let cmdMap;
			try {
				cmdMap = commandMethod.call(instance);
			} catch (e) {
				logger.error(`Client Mod ${name} command collection failed: ${(e as Error).message}`);
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
					if (!cmd || typeof cmd.name !== "string" || !cmd.name
						|| (typeof cmd.execute !== "function" && typeof cmd.executeTokens !== "function")) {
						logger.warning(`Client Mod ${name} registered an invalid command in "${tier}"`);
						continue;
					}
					const prev = this._commandIndex.get(cmd.name);
					if (prev) {
						logger.warning(`Duplicate command "${cmd.name}" from mod ${name} ignored (already provided by ${prev.mod})`);
						continue;
					}
					this.commands[tier].push(cmd as Command);
					this._commandIndex.set(cmd.name, { cmd: cmd as Command, tier, mod: name });
				}
			}
		}
	}

	async reload(name: string): Promise<{ success: boolean; message: string }> {
		const entry = modRegistry.getByName(name);
		const isDefault = !entry && DEFAULT_CLIENT_MODS[name];

		if (!entry && !isDefault) {
			return { success: false, message: `Client Mod "${name}" not found` };
		}

		this.unload(name);

		try {
			const modPath = isDefault
				? path.join(path.dirname(fileURLToPath(import.meta.url)), `${name}.ts`)
				: resolveCaseInsensitivePath(entry?.path ?? "", entry?.entry.client ?? "");
			if (!modPath) return { success: false, message: `Client Mod "${name}" entry file not found` };
			const modModule = await import(resolveModuleUrl(modPath, Date.now()));
			const modClass = modModule.default as ModClass | undefined;
			if (!modClass) return { success: false, message: `Client Mod "${name}" no default export` };
			if (entry) entry.clientClass = modClass;
			ClientModManager.loadedMod[name] = modClass;
			this._instantiateMod(name, modClass);
			this._buildMethodLists();
			this._collectCommands();
			logger.info(`Client Mod ${name} reloaded`);
			return { success: true, message: `Client Mod ${name} reloaded` };
		} catch (e) {
			const message = (e as Error).message;
			logger.error(`Client Mod ${name} reload failed: ${message}`);
			return { success: false, message: `Client Mod ${name} reload failed: ${message}` };
		}
	}

	// 全量同步：新启用的 Mod 会实例化，已禁用/移除的会被卸载
	async reloadAll(): Promise<{ success: string[]; failed: string[] }> {
		const success: string[] = [], failed: string[] = [];

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
					logger.error(`Client Mod ${name} instantiation failed: ${(e as Error).message}`);
					failed.push(name);
				}
			} else {
				const r = await this.reload(name);
				r.success ? success.push(name) : failed.push(name);
			}
		}
		return { success, failed };
	}

	static async reloadAllClients(): Promise<{ success: string[]; failed: string[] }> {
		// 先按 modRegistry 同步类注册表，否则新导入/启用的 Mod 永远不会加载
		await ClientModManager.syncClasses();
		const success: string[] = [], failed: string[] = [];
		for (const [client, manager] of Current.clientMods) {
			if (!manager || typeof manager.reloadAll !== "function") continue;
			const r = await manager.reloadAll();
			success.push(...r.success.map(n => `${client?.id || "?"}:${n}`));
			failed.push(...r.failed.map(n => `${client?.id || "?"}:${n}`));
		}
		return { success, failed };
	}

	_createModSAPI(modName: string): ModSAPI | null {
		const hub = this.sapi;
		if (!hub) return null;
		return {
			on: (type, callback) => hub.register(modName, type, callback),
			off: (type) => hub.unregister(modName, type),
			send: (type, data = {}) => hub.send(modName, type, data),
			exists: () => hub.commandExists
		};
	}

	message(): void {
		// 分发器读取 this.commands 的动态内容，无需因 reload 重新订阅
		if (this._playerMessageCallback) return;

		this._playerMessageCallback = async (data: CommandResponse) => {
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
				this._tellError(sender, (e as Error).message);
				return;
			}
			if (!tokens.length) return;

			if (this._isPlayerRateLimited(sender)) {
				this._tellError(sender, "too many commands, please slow down");
				return;
			}

			const permission = PermissionManager.query(sender);
			if (permission < 0) {
				this._tellError(sender, "command permission error");
				return;
			}

			const commandName = tokens[0] ?? "";
			const entry = this._commandIndex.get(commandName.slice(prefix.length));
			if (!entry) {
				this._tellError(sender, `unknown command ${commandName}`);
				return;
			}

			const required = TIER_LEVELS[entry.tier] ?? 0;
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

	_isPlayerRateLimited(sender: string): boolean {
		const cfg = config.command?.playerRateLimit;
		if (cfg?.enabled === false) return false;
		const windowMs = cfg?.windowMs ?? 5000;
		const max = cfg?.maxPerWindow ?? 10;
		if (max <= 0) return false;

		const now = Date.now();
		const recent = (this._playerRate.get(sender) ?? []).filter((time) => now - time < windowMs);
		if (recent.length >= max) {
			this._playerRate.set(sender, recent);
			return true;
		}
		recent.push(now);
		this._playerRate.set(sender, recent);
		return false;
	}

	_tellError(sender: string, message: unknown): void {
		if (!this.client) return;
		const text = `§cCommand | §fError > §i${String(message)}`;
		if (sender) this.client.tell(text, sender);
		else this.client.tellAll(text);
	}

	_runCommand(cmd: Command, sender: string, tokens: string[]): void {
		try {
			const onError = (e: Error) => {
				this._tellError(sender, e.message);
				logger.debug(e.stack ?? e.message);
			};
			const result = typeof cmd.executeTokens === "function"
				? cmd.executeTokens(sender, tokens, onError)
				: cmd.execute(sender, tokens.join(" "), onError);
			if (result && !result.status && result.message) this._tellError(sender, result.message);
		} catch (e) {
			const message = (e as Error).message;
			logger.error(`Command ${cmd.name} execution error: ${message}`);
			this._tellError(sender, message);
		}
	}

	log(sender: string, msg: string, type: string): void {
		if (type === "chat" && this.client === Current.client) messageLogger.log(`<${sender}> ${msg}`);
	}

	// 兼容旧调用：按命令列表依次尝试（terminal 与外部 Mod 可能仍在使用）
	execute(sender: string, msg: string, cmds: Command[]): boolean {
		let tokens;
		try {
			tokens = Command.parseArgs(msg);
		} catch (e) {
			this._tellError(sender, (e as Error).message);
			return false;
		}
		for (const cmd of cmds) {
			if (typeof cmd.matches === "function") {
				if (!cmd.matches(tokens)) continue;
				this._runCommand(cmd, sender, tokens);
				return false;
			}
			// 旧版 Command：execute() 自带解析，只能在匹配时执行
			const result = cmd.execute(sender, msg, (e: Error) => this._tellError(sender, e.message));
			if (result) {
				if (!result.status && result.message) this._tellError(sender, result.message);
				return false;
			}
		}
		return true;
	}

	destroy(): void {
		// 用实例化时解析好的 onDestroy/destroy，兼容只实现了 destroy() 的 Mod
		for (const [name, dm] of Object.entries(this._destroyMethods)) {
			try { dm.fn.apply(dm.ctx); }
			catch (e) {
				logger.error(`Client Mod ${name}.onDestroy execution error`);
				logger.debug((e as Error).message);
			}
		}
		this._destroyMethods = {};
		if (this.sapi && typeof this.sapi.destroy === "function") this.sapi.destroy();
		this.sapi = null;
		const clientId = this.client?.id || "unknown";
		for (const [name, instance] of Object.entries(this.modInstances)) {
			instance.sapi = null;
			eventBus.clearMod(`client_${clientId}_${name}`);
			StorageManager.clearStore(`client_${clientId}_${name}`);
			if (this.client) this.client[name] = null;
		}
		this.client = null;
		this.modInstances = {};
		this.commands = { normal: [], user: [], op: [], owner: [] };
		this._commandIndex = new Map();
		this._methodLists = new Map();
		this._playerRate.clear();
	}
}


// ==================== Server Mod Manager (Singleton) ====================

export class ServerModManager extends ModManagerBase {
	static _instance: ServerModManager | null = null;

	static loadedMod: Record<string, ModClass> = {};

	override get _label(): string { return "Server"; }
	override _storageKey(name: string): string { return `server_${name}`; }

	override _afterUnload(name: string): void {
		eventBus.clearMod(name);
	}

	// 按 modRegistry 同步服务端 Mod 类注册表
	static async syncClasses() {

		const enabled = modRegistry.list().filter(e => e.enabled && e.entry.server);
		const enabledNames = new Set(enabled.map(e => e.name));

		for (const name of Object.keys(ServerModManager.loadedMod)) {
			if (!enabledNames.has(name)) delete ServerModManager.loadedMod[name];
		}

		for (const entry of enabled) {
			if (ServerModManager.loadedMod[entry.name]) continue;
			try {
				if (!entry.entry.server) continue;
				const modPath = resolveCaseInsensitivePath(entry.path, entry.entry.server);
				if (!modPath) throw new Error("entry file not found");
				const modModule = await import(resolveModuleUrl(modPath));
				const modClass = modModule.default as ModClass | undefined;
				if (!modClass) throw new Error("no default export");
				entry.serverClass = modClass;
				ServerModManager.loadedMod[entry.name] = modClass;
				logger.info(`Server Mod ${entry.name} loaded`);
			} catch (e) {
				logger.error(`Server Mod ${entry.name} load failed: ${(e as Error).message}`);
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
		super();
		if (ServerModManager._instance) {
			return ServerModManager._instance;
		}
		this._instantiate();
	}

	_instantiate(): void {
		for (const [name, ModClass] of Object.entries(ServerModManager.loadedMod)) {
			this._createInstance(name, ModClass);
		}
		this._buildMethodLists();
	}

	// 实例化单个服务端 Mod（_instantiate / reload 共用）
	_createInstance(name: string, ModClass: ModClass): AnyRecord | null {
		const entry = modRegistry.getByName(name);
		const mergedConfig = entry ? modRegistry.getMergedConfig(entry.id) : (config as AnyRecord);
		// 构造函数可能读取 ModClass.config，必须在实例化前赋值
		if (typeof ModClass === "function") ModClass.config = mergedConfig;

		let instance: AnyRecord;
		try {
			instance = new ModClass();
		} catch (e) {
			logger.error(`Server Mod ${name} instantiation failed: ${(e as Error).message}`);
			return null;
		}

		this._initInstance(instance, ModClass, name, mergedConfig, `Server:${name}`);
		instance.emit = (event: string, data?: unknown) => eventBus.emit(event, data, name);
		instance.on = (event: string, callback: (data: unknown) => void) => eventBus.on(event, name, callback);
		instance.off = (event: string) => eventBus.off(event, name);

		this.modInstances[name] = instance;
		this._trackDestroy(name, instance);
		this._startInstance(name, instance);
		return instance;
	}

	static _inst(): ServerModManager | null {
		return ServerModManager._instance;
	}

	async reload(name: string): Promise<{ success: boolean; message: string }> {
		const entry = modRegistry.getByName(name);
		if (!entry || !entry.entry.server) {
			return { success: false, message: `Server Mod "${name}" not found` };
		}

		this.unload(name);

		try {
			const timestamp = Date.now();
			const modPath = resolveCaseInsensitivePath(entry.path, entry.entry.server);
			if (!modPath) return { success: false, message: `Server Mod "${name}" entry file not found` };
			const modModule = await import(resolveModuleUrl(modPath, timestamp));
			const modClass = modModule.default as ModClass | undefined;
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
			const message = (e as Error).message;
			logger.error(`Server Mod ${name} reload failed: ${message}`);
			return { success: false, message: `Server Mod ${name} reload failed: ${message}` };
		}
	}

	// 全量同步：实例化新启用的 Mod，卸载已禁用/移除的 Mod，其余重载
	async reloadAll(): Promise<{ success: string[]; failed: string[] }> {
		const success: string[] = [], failed: string[] = [];

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

	static async reloadAll(): Promise<{ success: string[]; failed: string[] }> {
		await ServerModManager.syncClasses();
		const inst = ServerModManager._instance;
		if (!inst) return { success: [], failed: [] };
		return inst.reloadAll();
	}

	static getLoadedModNames(): string[] {
		return Object.keys(ServerModManager.loadedMod);
	}

	static attachMainClient(client: Client): void {
		ServerModManager._inst()?.callModMethod("onMainClientConnect", client);
	}

	static onClientConnect(client: Client, isMainClient: boolean): void {
		ServerModManager._inst()?.callModMethod("onClientConnect", client, isMainClient);
	}

	static onMessage(client: Client, data: CommandResponse): void {
		ServerModManager._inst()?.callModMethod("onMessage", client, data);
	}

	static onClientDisconnect(client: Client, isMainClient: boolean): void {
		ServerModManager._inst()?.callModMethod("onClientDisconnect", client, isMainClient);
	}

	static onMainClientSwitch(oldClient: Client, newClient: Client): void {
		ServerModManager._inst()?.callModMethod("onMainClientSwitch", oldClient, newClient);
	}

	static destroy(): void {
		const inst = ServerModManager._instance;
		if (!inst) return;
		// 先调用所有 onDestroy
		for (const [name, dm] of Object.entries(inst._destroyMethods || {})) {
			try { dm.fn.apply(dm.ctx); }
			catch (e) {
				logger.error(`Server Mod ${name}.onDestroy execution error`);
				logger.debug((e as Error).message);
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

// 启动时检查已启用模组的 dependencies（npm 包名列表），缺失的自动安装
export async function checkModDependencies(): Promise<void> {
	if (!(config.ws && config.ws.checkDependenciesOnLoad !== false)) return;

	for (const entry of modRegistry.list()) {
		if (!entry.enabled) continue;
		const manifestPath = resolveCaseInsensitivePath(entry.path, "manifest.json");
		if (!manifestPath) continue;

		let manifest: { dependencies?: unknown[] };
		try {
			manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as { dependencies?: unknown[] };
		} catch {
			continue;
		}
		const deps = Array.isArray(manifest.dependencies) ? manifest.dependencies : [];
		if (!deps.length) continue;

		const label = entry.name;
		for (const dep of deps) {
			const parsed = parseDependency(dep);
			if (!parsed) {
				logger.error(`Mod "${label}" has an invalid dependency entry (npm package name expected): ${JSON.stringify(dep)}`);
				continue;
			}
			try {
				const r = await installNpmDependency(parsed.name, projectRoot());
				if (!r.skipped) logger.info(`npm package "${r.name}" installed for mod "${label}"`);
			} catch (e) {
				logger.error(`Failed to install npm package "${parsed.name}" for mod "${label}": ${(e as Error).message}`);
			}
		}
	}
}
