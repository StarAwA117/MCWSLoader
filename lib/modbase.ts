import type Command from "./command.js";
import type Current from "./current.js";
import type PermissionManager from "./permission.js";
import type { ClientModManager as ClientModManagerType, ServerModManager as ServerModManagerType } from "./mods.js";
import type { Client } from "./types/client.js";
import type { ModLoggerLike, ModSAPI, ModStorageLike } from "./types/mod.js";

/**
 * Runtime base class for bundled Mods.
 *
 * The Mod system injects Command/Current/storage/logger/sapi/... onto every
 * instance after construction. Declaring them here gives TypeScript Mods a
 * typed `this` without importing those modules or changing the injection
 * contract.
 */
export class ModBase {
	/** Injected Mod config (global config merged with the Mod's config.json) */
	static config: any = null;

	// Static dependency injection (used by Mods that access deps via the class)
	static Command: typeof Command;
	static Current: typeof Current;
	static PermissionManager: typeof PermissionManager;
	static ServerModManager: typeof ServerModManagerType;
	static ClientModManager: typeof ClientModManagerType;

	/** WebSocket connection (client Mods) */
	client: Client | null = null;
	/** Instance config injected by the Mod manager */
	config: any = null;

	declare Command: typeof Command;
	declare Current: typeof Current;
	declare PermissionManager: typeof PermissionManager;
	declare ServerModManager: typeof ServerModManagerType;
	declare ClientModManager: typeof ClientModManagerType;

	declare storage: ModStorageLike;
	declare logger: ModLoggerLike;
	declare sapi: ModSAPI;
	declare t: (key: string, params?: Record<string, unknown>) => string;

	declare emit: (event: string, data?: unknown) => void;
	declare on: (event: string, callback: (data: unknown) => void) => void;
	declare off: (event: string) => void;

	declare fs: typeof import("node:fs");
	declare path: typeof import("node:path");
	declare fileURLToPath: typeof import("node:url").fileURLToPath;
	declare exec: typeof import("node:child_process").exec;
	declare readline: typeof import("./readline.js");
	declare reloadConfig: () => unknown;
}

export default ModBase;

// Mods deliberately keep their own instance fields out of the base class.
// An index signature keeps those dynamic fields usable without forcing every
// individual Mod to redeclare them.
export interface ModBase {
	[key: string]: any;
}
