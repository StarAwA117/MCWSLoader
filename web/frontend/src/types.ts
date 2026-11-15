/** 前端使用的 API 数据模型 */

export interface ClientInfo {
	id: string;
	ip: string;
	isMain: boolean;
	trusted: boolean;
	connectedAt: number;
	localPlayerName: string | null;
}

export interface ModInfo {
	name: string;
	displayName?: string;
	description: string;
	displayDescription?: string;
	version: string;
	author: string;
	enabled: boolean;
	hasConfig: boolean;
	hasReadme: boolean;
	entry: { server: boolean; client: boolean };
}

export interface PermissionData {
	owner: string;
	op: string[];
	user: string[];
	blocker: string[];
}

export interface ServerStatus {
	server: { uptime: number; wsPort: number; name: string; webPort: number };
	connections: { count: number; mainClient: string | null; clients: ClientInfo[] };
	mods: { server: string[]; client: string[] };
	sapi: { commandExists: boolean | null; polling: boolean };
	properties: Record<string, unknown>;
}

export interface ProcessInfo {
	pid: number;
	uptime: number;
	memory: { rss: number; heapUsed: number; heapTotal: number };
	nodeVersion: string;
	platform: string;
	version: string;
}

export interface TagInfo {
	name: string;
	title?: string;
	commit?: string | null;
	prerelease?: boolean;
}

export interface CommandOutputLine {
	type: "input" | "success" | "error";
	text: string;
}

export interface ModManifest {
	name?: string;
	version?: string;
	description?: string;
	author?: string;
	[key: string]: unknown;
}

/** Mod 配置面板的字段树 */
export interface ModFieldNode {
	path: string;
	key: string;
	type: "group" | "row" | "json" | "array" | "boolean" | "number" | "string";
	children?: ModFieldNode[];
}
