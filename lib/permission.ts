import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tCore } from "./texts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PERMISSION_FILE = path.resolve(__dirname, "..", "permission.json");

export const LEVELS = {
	blocker: 0,
	user: 1,
	op: 2,
	owner: 3
} as const;

export type PermissionGroup = keyof typeof LEVELS;

export interface PermissionData {
	owner: string;
	op: string[];
	user: string[];
	blocker: string[];
}

const EMPTY: PermissionData = { owner: "", op: [], user: [], blocker: [] };

function permissionError(key: string, params?: Record<string, unknown>): Error {
	const message = tCore(key, params);
	const error = new Error(message) as Error & { userMessage: string };
	error.userMessage = message;
	return error;
}

/** Cached parsed permissions. The file is checked by mtime so manual edits still apply. */
let cache: PermissionData | null = null;
let cacheMtimeMs = -1;

function empty(): PermissionData {
	return { ...EMPTY, op: [], user: [], blocker: [] };
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalize(data: unknown): PermissionData {
	if (!data || typeof data !== "object") return empty();
	const record = data as Record<string, unknown>;
	return {
		owner: typeof record.owner === "string" ? record.owner : "",
		op: stringArray(record.op),
		user: stringArray(record.user),
		blocker: stringArray(record.blocker)
	};
}

function load(): PermissionData {
	try {
		const stat = fs.statSync(PERMISSION_FILE);
		if (cache && cacheMtimeMs === stat.mtimeMs) return cache;
		// chmod 失败（Windows/只读挂载）不应导致权限文件被当成空数据
		try { fs.chmodSync(PERMISSION_FILE, 0o600); } catch { /* ignore */ }
		const data = normalize(JSON.parse(fs.readFileSync(PERMISSION_FILE, "utf-8")));
		cache = data;
		cacheMtimeMs = stat.mtimeMs;
		return data;
	} catch {
		return empty();
	}
}

function save(data: PermissionData): void {
	const temporary = `${PERMISSION_FILE}.tmp`;
	fs.writeFileSync(temporary, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
	fs.renameSync(temporary, PERMISSION_FILE);
	try { fs.chmodSync(PERMISSION_FILE, 0o600); } catch { /* ignore */ }
	cache = data;
	try { cacheMtimeMs = fs.statSync(PERMISSION_FILE).mtimeMs; } catch { cacheMtimeMs = -1; }
}

export default class PermissionManager {
	static get(): PermissionData {
		const data = load();
		return {
			owner: data.owner,
			op: [...data.op],
			user: [...data.user],
			blocker: [...data.blocker]
		};
	}

	static set(data: unknown): true | Error {
		if (!data || typeof data !== "object" || Array.isArray(data)) return permissionError("core.permission.invalidData");
		save(normalize(data));
		return true;
	}

	/**
	 * 查询权限等级
	 * @param name 玩家名
	 * @returns 权限等级 (0-3)
	 */
	static query(name: string): number {
		const data = load();
		const lower = String(name ?? "").toLowerCase();
		if (data.owner && data.owner.toLowerCase() === lower) return LEVELS.owner;
		if (data.op.some((n) => n.toLowerCase() === lower)) return LEVELS.op;
		if (data.user.some((n) => n.toLowerCase() === lower)) return LEVELS.user;
		if (data.blocker.some((n) => n.toLowerCase() === lower)) return LEVELS.blocker;
		return 0;
	}

	/**
	 * 添加权限
	 * @param type 权限类型 (owner/op/user/blocker)
	 * @param name 玩家名
	 */
	static add(type: PermissionGroup | string, name: string): true | Error {
		if (!Object.prototype.hasOwnProperty.call(LEVELS, type)) return permissionError("core.permission.unknownType", { type });
		const data = load();
		if (type === "owner") {
			data.owner = name;
		} else {
			const group = type as Exclude<PermissionGroup, "owner">;
			if (!data[group].some((entry) => entry.toLowerCase() === name.toLowerCase())) data[group].push(name);
		}
		save(data);
		return true;
	}

	/**
	 * 删除权限
	 * @param type 权限类型 (owner/op/user/blocker)
	 * @param name 玩家名
	 */
	static remove(type: PermissionGroup | string, name: string): true | Error {
		if (!Object.prototype.hasOwnProperty.call(LEVELS, type)) return permissionError("core.permission.unknownType", { type });
		const data = load();
		if (type === "owner") {
			data.owner = "";
		} else {
			const group = type as Exclude<PermissionGroup, "owner">;
			data[group] = data[group].filter((n) => n.toLowerCase() !== name.toLowerCase());
		}
		save(data);
		return true;
	}
}
