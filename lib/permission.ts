import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalize(data: unknown): PermissionData {
	if (!data || typeof data !== "object") return { ...EMPTY, op: [], user: [], blocker: [] };
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
		return normalize(JSON.parse(fs.readFileSync(PERMISSION_FILE, "utf-8")));
	} catch {
		return { ...EMPTY, op: [], user: [], blocker: [] };
	}
}

function save(data: PermissionData): void {
	fs.writeFileSync(PERMISSION_FILE, JSON.stringify(data, null, 2), "utf-8");
}

export default class PermissionManager {
	static get(): PermissionData {
		return load();
	}

	static set(data: unknown): true | Error {
		if (!data || typeof data !== "object" || Array.isArray(data)) return new Error("无效的权限数据");
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
		const lower = name.toLowerCase();
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
		if (!(type in LEVELS)) return new Error(`未知权限类型: ${type}`);
		const data = load();
		if (type === "owner") {
			data.owner = name;
		} else {
			const group = type as Exclude<PermissionGroup, "owner">;
			if (!data[group].includes(name)) data[group].push(name);
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
		if (!(type in LEVELS)) return new Error(`未知权限类型: ${type}`);
		const data = load();
		if (type === "owner") {
			data.owner = "";
		} else {
			const group = type as Exclude<PermissionGroup, "owner">;
			data[group] = data[group].filter((n) => n !== name);
		}
		save(data);
		return true;
	}
}
