/** Mod 清单（manifest.json） */
export interface ModManifest {
	name?: string;
	uuid?: string;
	version?: string;
	description?: string;
	author?: string;
	entry?: {
		server?: string | null;
		client?: string | null;
	};
	dependencies?: unknown[];
	[key: string]: unknown;
}

/** Mod 注册表条目 */
export interface ModEntry {
	id: string;
	name: string;
	description: string;
	version: string;
	author: string;
	enabled: boolean;
	entry: {
		server: string | null;
		client: string | null;
	};
	path: string;
	nameKey?: string | null;
	descriptionKey?: string | null;
	config: Record<string, unknown>;
	hasConfig: boolean;
	hasReadme: boolean;
	loaded: boolean;
	serverClass: ModConstructor | null;
	clientClass: ModConstructor | null;
	serverInstance: unknown;
}

export type ModConstructor = (new (...args: any[]) => any) & {
	config?: Record<string, unknown>;
	[key: string]: any;
};

/** Mod 可用的存储接口 */
export interface ModStorageLike {
	get<T = unknown>(key: string, defaultValue?: T): T | undefined;
	set(key: string, value: unknown): void;
	delete(key: string): boolean;
	has(key: string): boolean;
	clear(): void;
	keys(): string[];
	values(): unknown[];
	entries(): [string, unknown][];
}

/** Mod 可用的日志接口 */
export interface ModLoggerLike {
	info(...args: unknown[]): void;
	warning(...args: unknown[]): void;
	error(...args: unknown[]): void;
	debug(...args: unknown[]): void;
}

/** SAPI 消息 */
export interface SapiMessage {
	mod?: string;
	type?: string;
	data?: unknown;
}

/** 注入给 Mod 的 SAPI 接口 */
export interface ModSAPI {
	on(type: string, callback: (msg: SapiMessage) => void): void;
	off(type: string): void;
	send(type: string, data?: unknown): Promise<boolean>;
	exists(): boolean | null;
}

/**
 * 注入给每个 Mod 实例的运行时上下文。
 * Mod 可以用 JSDoc `@this {ModContext}` 获得类型检查。
 */
export interface ModContext {
	modName: string;
	config: Record<string, unknown>;
	storage: ModStorageLike;
	logger: ModLoggerLike;
	client?: import("./client.js").Client;
	sapi?: ModSAPI;
	emit(event: string, data?: unknown): void;
	on(event: string, callback: (data: unknown) => void): void;
	off(event: string): void;
	Command: typeof import("../command.js").default;
	Current: typeof import("../current.js").default;
	PermissionManager: typeof import("../permission.js").default;
	ServerModManager: typeof import("../mods.js").ServerModManager;
	ClientModManager: typeof import("../mods.js").ClientModManager;
	reloadConfig(): unknown;
	fs: typeof import("node:fs");
	path: typeof import("node:path");
	fileURLToPath: typeof import("node:url").fileURLToPath;
	exec: typeof import("node:child_process").exec;
	readline: typeof import("../readline.js");
	[key: string]: unknown;
}

declare global {
	/** JSDoc `@this {ModContext}` 可在纯 JS Mod 中直接引用 */
	type ModContext = import("./mod.js").ModContext;
	type ModSAPI = import("./mod.js").ModSAPI;
	type ModStorageLike = import("./mod.js").ModStorageLike;
	type ModLoggerLike = import("./mod.js").ModLoggerLike;
}
