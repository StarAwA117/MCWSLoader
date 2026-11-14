import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { config, reloadConfig, ServerModManager, ClientModManager, modRegistry } from "../lib/mods.js";
import Current from "../lib/current.js";
import PermissionManager from "../lib/permission.js";
import Command from "../lib/command.js";
import { logger } from "../lib/logger.js";
import { collectCommands as collectTerminalCommands } from "../lib/readline.js";
import { parseMultipartBody } from "../lib/multipart.js";
import { extractZip, resolveModRoot, readManifest, copyMerge, removeDir, sanitizeFolderName, installDependencies, makeTempDir, makeTempPath, moveDir } from "../lib/modinstall.js";
import type { Client } from "../types/client.js";
import type { ModEntry } from "../types/mod.js";

type AnyRecord = Record<string, any>;
interface AuthState {
	attempts: number[];
	lockedUntil: number;
}

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, "frontend", "dist");
const CONFIG_PATH = path.resolve(__dirname, "..", "config.json");

const WEB_PORT = config.web?.port || 50005;
const authConfig = config.web?.auth || {};
const AUTH_MAX_ATTEMPTS = authConfig.maxAttempts || 3;
const AUTH_WINDOW_MS = authConfig.windowMs || 60000;
const AUTH_LOCKOUT_MS = authConfig.lockoutMs || 60000;

const GITHUB_API = "https://api.github.com/repos/StarAwA117/MCWSLoader";
const REPO_ROOT = path.resolve(__dirname, "..");
const CURRENT_VERSION = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8")) as { version: string }).version;

let temporaryPassword: string | null = null;
// 由 ws.ts 注入的进程关闭钩子（/api/system/restart 使用）
let shutdownHandler: (() => Promise<void>) | null = null;
// 请求体上限：防止异常客户端一次占满内存（Mod 导入单独限制）
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

// --- Auth rate limiting ---
const authAttempts = new Map<string, AuthState>();

function getAuthState(ip: string): AuthState {
	const now = Date.now();
	let state = authAttempts.get(ip);
	if (!state) {
		state = { attempts: [], lockedUntil: 0 };
		authAttempts.set(ip, state);
	}
	const lockedState: AuthState = state;
	lockedState.attempts = lockedState.attempts.filter((t) => now - t < AUTH_WINDOW_MS);
	if (lockedState.lockedUntil && now > lockedState.lockedUntil) {
		lockedState.lockedUntil = 0;
		lockedState.attempts = [];
	}
	return lockedState;
}

function json(res: ServerResponse, obj: unknown, status = 200): void {
	if (res.headersSent) return;
	res.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Access-Control-Allow-Origin": "*",
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options": "DENY",
		"Cache-Control": "no-store"
	});
	res.end(JSON.stringify(obj));
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				req.destroy();
				reject(new Error("Request body too large"));
				return;
			}
			chunks.push(chunk);
		});
		// 统一解码，避免 UTF-8 多字节字符跨 chunk 时被截断
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
}

/**
 * 读取并解析 JSON 请求体。
 * 失败时直接回 400，返回 null。
 */
async function readJson(req: IncomingMessage, res: ServerResponse): Promise<AnyRecord | null> {
	try {
		const body = await readBody(req);
		if (!body) return {};
		const data = JSON.parse(body);
		if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not an object");
		return data;
	} catch {
		json(res, { ok: false, message: "Invalid request format" }, 400);
		return null;
	}
}

/**
 * 按名称查找 Mod；未找到时回 404，返回 null。
 */
function findMod(name: string, res: ServerResponse): ModEntry | null {
	const entry = modRegistry.getByName(name);
	if (!entry) json(res, { ok: false, message: "Mod not found" }, 404);
	return entry;
}

function getClientInfo(ws: Client): {
	id: string;
	ip: string;
	isMain: boolean;
	connectedAt: number;
	localPlayerName: string | null;
} {
	return {
		id: ws.id,
		ip: ws._socket?.remoteAddress || "unknown",
		isMain: ws === Current.client,
		connectedAt: ws._connectedAt || Date.now(),
		localPlayerName: ws.localPlayerName || null
	};
}

function listClients(): ReturnType<typeof getClientInfo>[] {
	return [...Current.clientMods.keys()].map(getClientInfo);
}

const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
const sessions = new Map<string, { ip: string; createdAt: number }>();

function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
	return new Promise((resolve, reject) => {
		const salt = crypto.randomBytes(16).toString("hex");
		crypto.scrypt(password, salt, 64, (err, derivedKey) => {
			if (err) return reject(err);
			resolve({ salt, hash: derivedKey.toString("hex") });
		});
	});
}

function verifyPassword(password: string, salt: string, hash: string): Promise<boolean> {
	return new Promise((resolve, reject) => {
		crypto.scrypt(password, salt, 64, (err, derivedKey) => {
			if (err) return reject(err);
			resolve(derivedKey.toString("hex") === hash);
		});
	});
}

async function checkPassword(password: string): Promise<boolean> {
	const auth = config.web?.auth || {};
	if (auth.passwordHash && auth.salt) {
		return await verifyPassword(password, auth.salt, auth.passwordHash);
	}
	// 兼容旧版明文密码
	if (auth.password) {
		return password === auth.password;
	}
	if (temporaryPassword && password === temporaryPassword) {
		return true;
	}
	return false;
}

function createSession(ip: string): string {
	const token = crypto.randomBytes(32).toString("hex");
	sessions.set(token, { ip, createdAt: Date.now() });
	return token;
}

function validateSession(token: unknown): boolean {
	if (typeof token !== "string" || !token) return false;
	const session = sessions.get(token);
	if (!session) return false;
	if (Date.now() - session.createdAt > SESSION_TIMEOUT) {
		sessions.delete(token);
		return false;
	}
	return true;
}

// 定期清理过期会话与登录限流记录，避免长期运行后 Map 无限增长
function cleanupAuthState(): void {
	const now = Date.now();
	for (const [token, session] of sessions) {
		if (now - session.createdAt > SESSION_TIMEOUT) sessions.delete(token);
	}
	for (const [ip, state] of authAttempts) {
		state.attempts = state.attempts.filter((t) => now - t < AUTH_WINDOW_MS);
		if (state.attempts.length === 0 && (!state.lockedUntil || now > state.lockedUntil)) authAttempts.delete(ip);
	}
}
const authCleanupTimer = setInterval(cleanupAuthState, 10 * 60 * 1000);
if (typeof authCleanupTimer.unref === "function") authCleanupTimer.unref();

function writeConfig(): void {
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, "\t") + "\n", "utf-8");
}

// 只读取日志尾部：日志文件可持续增长，全量读取再 split 会随文件变大而线性变慢
function readLogTail(filePath: string, maxLines: number, maxBytes = 512 * 1024): string[] {
	let fd: number | undefined;
	try {
		fd = fs.openSync(filePath, "r");
		const size = fs.fstatSync(fd).size;
		const start = Math.max(0, size - maxBytes);
		const buf = Buffer.allocUnsafe(size - start);
		fs.readSync(fd, buf, 0, buf.length, start);
		let text = buf.toString("utf-8");
		if (start > 0) {
			const nl = text.indexOf("\n");
			text = nl === -1 ? "" : text.slice(nl + 1);
		}
		return text.split("\n").filter(Boolean).slice(-maxLines);
	} catch {
		return [];
	} finally {
		if (fd !== undefined) fs.closeSync(fd);
	}
}

const startTime = Date.now();

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".woff": "font/woff"
};

const HTML_HEADERS = {
	"Content-Type": "text/html; charset=utf-8",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "DENY",
	"Cache-Control": "no-store"
};

// index.html 只变语言注入，按文件 mtime + 语言缓存，避免每个请求都读盘
const htmlCache = { filePath: "", mtimeMs: 0, language: "", html: "" };

function sendHTML(res: ServerResponse, filePath: string): void {
	let stat;
	try {
		stat = fs.statSync(filePath);
	} catch {
		res.writeHead(404, { "X-Content-Type-Options": "nosniff" });
		res.end("Not Found");
		return;
	}

	const language = String(config.language ?? "zh-CN");
	if (htmlCache.filePath === filePath && htmlCache.mtimeMs === stat.mtimeMs && htmlCache.language === language) {
		res.writeHead(200, HTML_HEADERS);
		res.end(htmlCache.html);
		return;
	}

	const html = fs.readFileSync(filePath, "utf-8");
	// JSON.stringify 后转义 "<"，避免配置里的语言值逃出 <script>
	const lang = JSON.stringify(language).replace(/</g, "\\u003c");
	const injected = html.replace("<head>", `<head><script>window.__LANGUAGE__=${lang};</script>`);
	htmlCache.filePath = filePath;
	htmlCache.mtimeMs = stat.mtimeMs;
	htmlCache.language = language;
	htmlCache.html = injected;
	res.writeHead(200, HTML_HEADERS);
	res.end(injected);
}

function serveStatic(res: ServerResponse, filePath: string): void {
	try {
		const stat = fs.statSync(filePath);
		if (!stat.isFile()) {
			const indexPath = path.join(DIST_DIR, "index.html");
			if (fs.existsSync(indexPath)) {
				sendHTML(res, indexPath);
			} else {
				res.writeHead(404, { "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" });
				res.end("Not Found");
			}
			return;
		}
	} catch {
		const indexPath = path.join(DIST_DIR, "index.html");
		if (fs.existsSync(indexPath)) {
			sendHTML(res, indexPath);
		} else {
			res.writeHead(404, { "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" });
			res.end("Not Found");
		}
		return;
	}
	const ext = path.extname(filePath);
	const mime = MIME_TYPES[ext] || "application/octet-stream";
	const headers: Record<string, string> = {
		"Content-Type": mime,
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options": "DENY"
	};
	if (ext === ".html") {
		headers["Cache-Control"] = "no-store";
		sendHTML(res, filePath);
	} else {
		headers["Cache-Control"] = "public, max-age=3600";
		res.writeHead(200, headers);
		fs.createReadStream(filePath).on("error", (e) => { res.destroy(e); }).pipe(res);
	}
}

// 卸载已加载的模组实例（服务端/客户端），不删除文件
function unloadMod(modEntry: ModEntry | null): void {
	if (!modEntry) return;
	if (modEntry.entry?.server) {
		ServerModManager._inst()?.unload(modEntry.name);
		delete ServerModManager.loadedMod[modEntry.name];
	}
	if (modEntry.entry?.client) {
		for (const [, mgr] of Current.clientMods) {
			if (!mgr) continue;
			mgr.unload(modEntry.name);
		}
		delete ClientModManager.loadedMod[modEntry.name];
	}
}

// 拉取并切换到指定 Release（更新/回退共用）
async function checkoutTag(tag: string): Promise<void> {
	const opts = { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 };
	await execAsync("git fetch --all", opts);
	await execAsync("git reset --hard HEAD", opts);
	await execFileAsync("git", ["checkout", "-f", tag], opts);
	await execAsync("npm install", { ...opts, timeout: 300000 });
}

// 主客户端切换：同时通知服务端 Mod 并重新挂载 SAPI
function switchMainClient(target: Client): void {
	const prev = Current.client;
	if (prev === target) return;
	Current.setMain(target);
	if (prev) ServerModManager.onMainClientSwitch(prev, target);
	ServerModManager.attachMainClient(target);
}

async function handleAPI(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
	const method = req.method;
	const pathname = url.pathname;

	if (method === "OPTIONS") {
		res.writeHead(204, {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, X-Auth-Token",
			"X-Content-Type-Options": "nosniff",
			"X-Frame-Options": "DENY"
		});
		res.end();
		return;
	}

	// Login endpoint (no auth required)
	if (pathname === "/api/login" && (method === "GET" || method === "POST")) {
		let password = "";
		if (method === "GET") {
			password = url.searchParams.get("pwd") || "";
		} else {
			const payload = await readJson(req, res);
			if (!payload) return;
			password = String(payload.password || "");
		}
		const ip = req.socket.remoteAddress || "unknown";

		const state = getAuthState(ip);
		if (state.lockedUntil && Date.now() < state.lockedUntil) {
			const waitSec = Math.ceil((state.lockedUntil - Date.now()) / 1000);
			return json(res, { ok: false, locked: true, waitSec }, 401);
		}

		const valid = await checkPassword(password);
		if (valid) {
			state.attempts = [];
			state.lockedUntil = 0;

			const token = createSession(ip);
			logger.info(`WebUI login success: IP=${ip}`);
			return json(res, { ok: true, token, expiresIn: SESSION_TIMEOUT });
		}

		state.attempts.push(Date.now());
		if (state.attempts.length >= AUTH_MAX_ATTEMPTS) {
			state.lockedUntil = Date.now() + AUTH_LOCKOUT_MS;
			logger.error(`WebUI login locked: IP=${ip} locked for ${AUTH_LOCKOUT_MS / 1000}s`);
			return json(res, { ok: false, locked: true, waitSec: Math.ceil(AUTH_LOCKOUT_MS / 1000) }, 401);
		}
		return json(res, { ok: false, message: "Invalid username or password", remaining: Math.max(0, AUTH_MAX_ATTEMPTS - state.attempts.length) }, 401);
	}

	// Auth check for all other API routes
	const token = req.headers["x-auth-token"];
	if (!validateSession(token)) {
		return json(res, { ok: false, message: "Unauthorized" }, 401);
	}

	try {
		// Status
		if (pathname === "/api/status" && method === "GET") {
			const clients = listClients();
			return json(res, {
				server: { uptime: Date.now() - startTime, wsPort: config.ws.port, name: config.ws.name, webPort: WEB_PORT },
				connections: { count: Current.clientMods.size, mainClient: Current.client?.id || null, clients },
				mods: { server: Object.keys(ServerModManager.loadedMod || {}), client: Object.keys(ClientModManager.loadedMod || {}) },
				sapi: { commandExists: Current.client?.clientMod?.sapi?.commandExists ?? null, polling: Current.client?.clientMod?.sapi?.polling ?? false },
				properties: Current.properties
			});
		}

		// Language
		if (pathname === "/api/language" && method === "GET") {
			return json(res, { language: config.language });
		}
		if (pathname === "/api/language" && method === "POST") {
			const payload = await readJson(req, res);
			if (!payload) return;
			const lang = String(payload.language || "");
			const allowed = ["zh-CN", "en"];
			if (!allowed.includes(lang)) return json(res, { ok: false, message: "Unsupported language" }, 400);
			config.language = lang;
			writeConfig();
			reloadConfig();
			return json(res, { ok: true, language: config.language });
		}

		// Config
		if (pathname === "/api/config" && method === "GET") {
			const cfg = structuredClone(config) as AnyRecord;
			const ai = cfg.ai as AnyRecord | undefined;
			if (ai?.options?.apiKey) ai.options.apiKey = "***";
			if (cfg.web?.auth) {
				cfg.web.auth.passwordHash = "";
				cfg.web.auth.salt = "";
			}
			return json(res, cfg);
		}
		if (pathname === "/api/config" && method === "PUT") {
			const newCfg = await readJson(req, res);
			if (!newCfg) return;
			// GET /api/config 会对敏感字段脱敏，保存时不能把脱敏后的值写回磁盘
			if (newCfg.web?.auth) {
				if (!newCfg.web.auth.passwordHash && config.web?.auth?.passwordHash) newCfg.web.auth.passwordHash = config.web.auth.passwordHash;
				if (!newCfg.web.auth.salt && config.web?.auth?.salt) newCfg.web.auth.salt = config.web.auth.salt;
			}
			const newAi = newCfg.ai as AnyRecord | undefined;
			const currentAi = (config as AnyRecord).ai as AnyRecord | undefined;
			if (newAi?.options && newAi.options.apiKey === "***" && currentAi?.options?.apiKey) {
				newAi.options.apiKey = currentAi.options.apiKey;
			}
			try {
				fs.writeFileSync(CONFIG_PATH, JSON.stringify(newCfg, null, "\t") + "\n", "utf-8");
			} catch (e) {
				const message = (e as Error).message;
				logger.error("Config save failed: " + message);
				return json(res, { ok: false, message: "Failed to write config: " + message }, 500);
			}
			reloadConfig();
			return json(res, { ok: true, message: "Config saved" });
		}

		// Auth: change password
		if (pathname === "/api/auth/change-password" && method === "POST") {
			const payload = await readJson(req, res);
			if (!payload) return;
			const authToken = req.headers["x-auth-token"];
			const oldPassword = String(payload.oldPassword || "");
			const newPassword = String(payload.newPassword || "");
			if (!newPassword) return json(res, { ok: false, message: "New password is required" }, 400);
			const auth = config.web?.auth || {};
			// 与登录一致：支持哈希密码、旧版明文密码、启动时的临时密码
			const valid = await checkPassword(oldPassword);
			if (!valid) return json(res, { ok: false, message: "Incorrect old password" }, 401);
			try {
				const { salt, hash } = await hashPassword(newPassword);
				auth.password = "";
				auth.salt = salt;
				auth.passwordHash = hash;
				await writeConfig();
				if (typeof authToken === "string") sessions.delete(authToken);
				return json(res, { ok: true, message: "Password updated, please login again" });
			} catch (e) {
				return json(res, { ok: false, message: "Password update failed" }, 500);
			}
		}

		// Permissions
		if (pathname === "/api/permissions" && method === "GET") {
			const perm = await PermissionManager.get();
			return json(res, perm);
		}
		if (pathname === "/api/permissions" && method === "PUT") {
			const perm = await readJson(req, res);
			if (!perm) return;
			const result = await PermissionManager.set(perm);
			if (result instanceof Error) throw result;
			return json(res, { ok: true });
		}
		const permMatch = pathname.match(/^\/api\/permissions\/(owner|op|user|blocker)\/(.+)$/);
		if (permMatch && method === "POST") {
			const [, group, player] = permMatch;
			const r = PermissionManager.add(group, decodeURIComponent(player));
			if (r instanceof Error) throw r;
			return json(res, { ok: true });
		}
		if (permMatch && method === "DELETE") {
			const [, group, player] = permMatch;
			const r = PermissionManager.remove(group, decodeURIComponent(player));
			if (r instanceof Error) throw r;
			return json(res, { ok: true });
		}

		// Mods
		if (pathname === "/api/mods" && method === "GET") {
			const allMods = modRegistry.list();
			const serverMods = allMods.filter(m => m.entry.server).map(m => ({
				name: m.name, description: m.description, version: m.version, author: m.author,
				enabled: m.enabled, hasConfig: m.hasConfig, hasReadme: m.hasReadme, entry: m.entry
			}));
			const clientMods = allMods.filter(m => m.entry.client).map(m => ({
				name: m.name, description: m.description, version: m.version, author: m.author,
				enabled: m.enabled, hasConfig: m.hasConfig, hasReadme: m.hasReadme, entry: m.entry
			}));
			return json(res, { server: serverMods, client: clientMods });
		}
		if (pathname === "/api/mods/reload-all" && method === "POST") {
			reloadConfig();
			// 重新读取各模组的 manifest / config.json，否则改过的配置重载也不会生效
			modRegistry.scan();
			const serverResult = await ServerModManager.reloadAll();
			const clientResult = await ClientModManager.reloadAllClients();
			collectTerminalCommands(ServerModManager, ClientModManager);
			return json(res, {
				ok: true,
				server: { success: serverResult.success, failed: serverResult.failed },
				client: { success: clientResult.success.length, failed: clientResult.failed }
			});
		}

		// Mod import
		if (pathname === "/api/mods/import" && method === "POST") {
			const overwrite = url.searchParams.get("overwrite") === "1";
			const modDir = path.join(__dirname, "..", "mod");
			const tmpBase = path.join(__dirname, "..", "tmp");
			let tempDir: string | null = null;
			let backupPath: string | null = null;
			let folderName: string | null = null;
			let installed = false;
			let manifest: import("../types/mod.js").ModManifest | null = null;
			let existingEntry: ModEntry | null = null;
			// 先清理临时文件再回响应，避免响应早于清理完成
			const finish = (payload: unknown, status = 200): void => {
				if (tempDir) removeDir(tempDir);
				if (backupPath) removeDir(backupPath);
				return json(res, payload, status);
			};
			try {
				const contentType = req.headers["content-type"] || "";
				if (!contentType.includes("multipart/form-data")) {
					return finish({ ok: false, code: "INVALID_FORMAT", message: "Invalid content type" }, 400);
				}

				const declared = Number(req.headers["content-length"] || 0);
				if (declared > MAX_UPLOAD_BYTES) {
					return finish({ ok: false, code: "INVALID_FORMAT", message: "File too large" }, 413);
				}

				const chunks: Buffer[] = [];
				let received = 0;
				for await (const chunk of req) {
					received += chunk.length;
					if (received > MAX_UPLOAD_BYTES) {
						return finish({ ok: false, code: "INVALID_FORMAT", message: "File too large" }, 413);
					}
					chunks.push(chunk);
				}
				const parts = parseMultipartBody(Buffer.concat(chunks), contentType);
				const filePart = parts?.file;
				if (!filePart || filePart.type !== "file") {
					return finish({ ok: false, code: "INVALID_FORMAT", message: "No file uploaded" }, 400);
				}

				const uploadName = String(filePart.filename || "mod.zip").toLowerCase();
				if (!uploadName.endsWith(".wsmod") && !uploadName.endsWith(".zip")) {
					return finish({ ok: false, code: "INVALID_FORMAT", message: "Unsupported file type" }, 400);
				}

				tempDir = makeTempDir(tmpBase, "mod_import_");
				const zipPath = path.join(tempDir, "upload.zip");
				fs.writeFileSync(zipPath, filePart.buffer);

				const extractDir = path.join(tempDir, "extract");
				await extractZip(zipPath, extractDir);

				const resolved = resolveModRoot(extractDir);
				if (!resolved) {
					return finish({ ok: false, code: "INVALID_FORMAT", message: "Missing manifest.json" }, 400);
				}
				manifest = readManifest(resolved.root);
				if (!manifest || !manifest.name) {
					return finish({ ok: false, code: "INVALID_FORMAT", message: "Invalid manifest.json: name is required" }, 400);
				}
				existingEntry = modRegistry.getByName(manifest.name) || null;

				// 已有同名模组时目标目录取它原来的目录，避免同名模组被安装成两份
				folderName = existingEntry
					? path.basename(existingEntry.path)
					: sanitizeFolderName(resolved.folderName || manifest.name);
				const targetDir = path.join(modDir, folderName);
				const targetExists = fs.existsSync(targetDir);

				if (targetExists && !overwrite) {
					return finish({ ok: false, code: "CONFLICT", name: manifest.name, folder: folderName }, 409);
				}

				// 覆盖安装：先备份旧版本，失败时才能原样回滚
				if (targetExists) {
					backupPath = makeTempPath(tmpBase, "mod_backup_");
					copyMerge(targetDir, backupPath);
				}

				// 覆盖时仅覆盖压缩包中出现的文件，未出现的保留
				installed = true;
				copyMerge(resolved.root, targetDir);

				// dependencies 为 npm 包名列表，安装到项目根目录
				await installDependencies(manifest, path.join(__dirname, ".."));

				modRegistry.scan();
				await ServerModManager.reloadAll();
				await ClientModManager.reloadAllClients();
				collectTerminalCommands(ServerModManager, ClientModManager);
				return finish({ ok: true, name: manifest.name, folder: folderName });
			} catch (e) {
				const err = e as Error & { code?: string };
				logger.error("Mod import failed: " + err.message);
				// 导入中途失败：恢复现场，避免留下半成品
				if (installed && folderName) {
					const targetDir = path.join(modDir, folderName);
					if (existingEntry) unloadMod(existingEntry);
					if (backupPath) {
						// 覆盖失败：回滚到旧版本
						removeDir(targetDir);
						try {
							moveDir(backupPath, targetDir);
							backupPath = null;
							logger.warning(`Mod "${folderName}" import failed, rolled back to previous version`);
						} catch (re) {
							logger.error(`Rollback failed for "${folderName}": ${(re as Error).message}`);
						}
					} else {
						// 全新安装失败：删除半成品并从 mods_config.json 移除
						removeDir(targetDir);
						modRegistry.forget(folderName);
						if (manifest?.uuid) modRegistry.forget(manifest.uuid);
					}
					try {
						modRegistry.scan();
						await ServerModManager.reloadAll();
						await ClientModManager.reloadAllClients();
						collectTerminalCommands(ServerModManager, ClientModManager);
					} catch {}
				}
				return finish({ ok: false, code: err.code || "INSTALL_FAILED", message: err.message }, 500);
			}
		}

		// Mod actions: delete / enable / disable / reload / config / manifest / readme
		const modRoute = pathname.match(/^\/api\/mods\/(.+)\/(delete|enable|disable|reload|config|manifest|readme)$/);
		if (modRoute) {
			const modName = decodeURIComponent(modRoute[1]);
			const action = modRoute[2];
			const modEntry = findMod(modName, res);
			if (!modEntry) return;

			if (action === "delete" && method === "POST") {
				unloadMod(modEntry);
				const r = modRegistry.remove(modEntry.id);
				if (!r.ok) return json(res, { ok: false, message: r.message }, 500);
				await ServerModManager.reloadAll();
				await ClientModManager.reloadAllClients();
				collectTerminalCommands(ServerModManager, ClientModManager);
				return json(res, { ok: true, name: modEntry.name });
			}

			if ((action === "enable" || action === "disable") && method === "POST") {
				const enabling = action === "enable";
				if (enabling) {
					const r = modRegistry.enable(modEntry.id);
					try {
						await ServerModManager.syncClasses();
						const sm = ServerModManager._inst();
						if (sm && modEntry.entry.server) await sm.reload(modEntry.name);

						if (modEntry.entry.client) {
							await ClientModManager.syncClasses();
							const modClass = ClientModManager.loadedMod[modEntry.name];
							for (const [, mgr] of Current.clientMods) {
								if (!mgr || !modClass) continue;
								mgr.unload(modEntry.name);
								mgr._instantiateMod(modEntry.name, modClass);
								mgr._buildMethodLists();
								mgr._collectCommands();
							}
						}
					} catch (e) {
						logger.error(`Mod ${modEntry.name} hot reload failed: ${(e as Error).message}`);
					}
					collectTerminalCommands(ServerModManager, ClientModManager);
					return json(res, r);
				}

				unloadMod(modEntry);
				const r = modRegistry.disable(modEntry.id);
				collectTerminalCommands(ServerModManager, ClientModManager);
				return json(res, r);
			}

			if (action === "reload" && method === "POST") {
				const results: { server: unknown; client: unknown } = { server: null, client: null };
				if (modEntry.entry.server) {
					const sm = ServerModManager._inst();
					results.server = sm ? await sm.reload(modEntry.name) : { success: false, message: "Server mod manager not initialized" };
				}
				if (modEntry.entry.client) {
					const successes = [], faileds = [];
					for (const [, mgr] of Current.clientMods) {
						if (!mgr || typeof mgr.reload !== "function") continue;
						const r = await mgr.reload(modEntry.name);
						r.success ? successes.push("ok") : faileds.push("fail");
					}
					results.client = { success: successes.length, failed: faileds.length };
				}
				collectTerminalCommands(ServerModManager, ClientModManager);
				return json(res, { ok: true, results });
			}

			if (action === "config") {
				const configPath = path.join(modEntry.path, "config.json");
				if (method === "GET") {
					const hasExample = fs.existsSync(path.join(modEntry.path, "config.example.json"));
					if (!fs.existsSync(configPath) && !hasExample) {
						return json(res, { ok: false, message: "Mod has no config file" }, 404);
					}
					const modConfig = fs.existsSync(configPath)
						? JSON.parse(fs.readFileSync(configPath, "utf-8"))
						: {};
					return json(res, { ok: true, config: modConfig });
				}
				if (method === "PUT") {
					const newConfig = await readJson(req, res);
					if (!newConfig) return;
					try {
						fs.writeFileSync(configPath, JSON.stringify(newConfig, null, "\t") + "\n", "utf-8");
					} catch (e) {
						return json(res, { ok: false, message: "Failed to write config: " + (e as Error).message }, 500);
					}
					// 同步注册表与合并配置缓存，否则之后的 reload 仍会拿到旧配置
					modEntry.config = newConfig;
					modRegistry.invalidateConfigCache(modEntry.id);
					return json(res, { ok: true, message: "Config saved" });
				}
			}

			if (action === "manifest" && method === "GET") {
				const manifestPath = path.join(modEntry.path, "manifest.json");
				if (!fs.existsSync(manifestPath)) return json(res, { ok: false, message: "Manifest file not found" }, 404);
				return json(res, { ok: true, manifest: JSON.parse(fs.readFileSync(manifestPath, "utf-8")) });
			}

			if (action === "readme" && method === "GET") {
				const readmePath = path.join(modEntry.path, "README.md");
				if (!fs.existsSync(readmePath)) return json(res, { ok: false, message: "No README file" });
				return json(res, { ok: true, readme: fs.readFileSync(readmePath, "utf-8") });
			}
		}

		// Commands
		if (pathname === "/api/commands" && method === "GET") {
			const cmds = [];
			if (Current.client?.clientMod) {
				const cm = Current.client.clientMod;
				const buckets = cm.commands as Record<string, Command[]>;
				for (const level of ["normal", "user", "op", "owner"]) {
					for (const cmd of buckets[level] ?? []) {
						cmds.push({
							name: `${Command.commandPrefix}${cmd.name}`,
							description: cmd.description,
							level,
							params: cmd.parameters.map((p) => ({ type: Array.isArray(p[0]) ? "enum" : p[0], desc: p[1], optional: p[2] }))
						});
					}
				}
			}
			return json(res, cmds);
		}
		if (pathname === "/api/command" && method === "POST") {
			const payload = await readJson(req, res);
			if (!payload) return;
			const { command } = payload;
			if (!command) throw new Error("Command cannot be empty");
			if (!Current.client) throw new Error("Main client not connected");
			const result = await Current.client.runCommand(command);
			return json(res, { ok: true, result });
		}

		// Clients
		if (pathname === "/api/clients" && method === "GET") {
			return json(res, listClients());
		}
		const clientTellMatch = pathname.match(/^\/api\/clients\/(.+)\/tell$/);
		if (clientTellMatch && method === "POST") {
			const clientId = decodeURIComponent(clientTellMatch[1]);
			const payload = await readJson(req, res);
			if (!payload) return;
			const { message } = payload;
			if (typeof message !== "string" || !message) return json(res, { ok: false, message: "Message is required" }, 400);
			for (const [ws] of Current.clientMods) {
				if (ws.id === clientId) { ws.tell(message); return json(res, { ok: true }); }
			}
			return json(res, { ok: false, message: "Client not found" }, 404);
		}
		const clientMoveMatch = pathname.match(/^\/api\/clients\/(.+)\/set-main$/);
		if (clientMoveMatch && method === "POST") {
			const clientId = decodeURIComponent(clientMoveMatch[1]);
			for (const [ws] of Current.clientMods) {
				if (ws.id === clientId) { switchMainClient(ws); return json(res, { ok: true }); }
			}
			return json(res, { ok: false, message: "Client not found" }, 404);
		}
		const clientDisconnectMatch = pathname.match(/^\/api\/clients\/(.+)\/disconnect$/);
		if (clientDisconnectMatch && method === "POST") {
			const clientId = clientDisconnectMatch[1];
			for (const [ws] of Current.clientMods) {
				if (ws.id === clientId) {
					// 主客户端移交由 ws 的 close 回调统一处理
					try { await ws.runCommand("/closewebsocket"); } catch {}
					ws.close();
					return json(res, { ok: true });
				}
			}
			return json(res, { ok: false, message: "Client not found" }, 404);
		}

		// System
		if (pathname === "/api/system/kill" && method === "POST") {
			json(res, { ok: true, message: "Process terminated" });
			setTimeout(() => process.exit(1), 500);
			return;
		}
		if (pathname === "/api/system/restart" && method === "POST") {
			json(res, { ok: true, message: "Restarting..." });
			setTimeout(async () => {
				try { if (shutdownHandler) await shutdownHandler(); } catch {}
				// 先释放 WebUI 端口，否则新进程会 EADDRINUSE
				await new Promise<void>((resolve) => {
					const timer = setTimeout(resolve, 1000);
					server.close(() => { clearTimeout(timer); resolve(); });
				});
				const { spawn } = await import("child_process");
				spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: "inherit" }).unref();
				process.exit(0);
			}, 500);
			return;
		}

		// Logs
		if (pathname === "/api/logs" && method === "GET") {
			const logName = url.searchParams.get("name") || "app";
			const lines = Math.min(5000, Math.max(1, parseInt(url.searchParams.get("lines") || "200", 10) || 200));
			// 只允许读取 logs 目录下的日志，防止路径穿越
			if (!/^[A-Za-z0-9_.-]+$/.test(logName)) return json(res, { lines: [] }, 400);
			const logPath = path.resolve(__dirname, "..", "logs", `${logName}.log`);
			if (!fs.existsSync(logPath)) return json(res, { lines: [] });
			return json(res, { lines: readLogTail(logPath, lines) });
		}

		// Chat
		if (pathname === "/api/chat" && method === "GET") {
			const logPath = path.resolve(__dirname, "..", "logs", "message.log");
			if (!fs.existsSync(logPath)) return json(res, { lines: [] });
			return json(res, { lines: readLogTail(logPath, 100) });
		}
		if (pathname === "/api/chat" && method === "POST") {
			const payload = await readJson(req, res);
			if (!payload) return;
			const { message } = payload;
			if (typeof message !== "string" || !message) return json(res, { ok: false, message: "Message is required" }, 400);
			if (!Current.client) throw new Error("Main client not connected");
			Current.client.tellAll(message);
			return json(res, { ok: true });
		}

		// System
		if (pathname === "/api/system/process" && method === "GET") {
			const mem = process.memoryUsage();
			return json(res, { pid: process.pid, uptime: process.uptime(), memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal }, nodeVersion: process.version, platform: process.platform, version: CURRENT_VERSION });
		}

		// Update
		async function githubFetch(apiPath: string): Promise<AnyRecord> {
			const response = await fetch(`${GITHUB_API}${apiPath}`, {
				headers: { "Accept": "application/vnd.github+json", "User-Agent": "MCWSLoader-UpdateChecker" }
			});
			if (!response.ok) throw new Error(`GitHub API request failed: HTTP ${response.status}`);
			return (await response.json()) as AnyRecord;
		}

		if (pathname === "/api/update/check" && method === "GET") {
			try {
				const release = await githubFetch("/releases/latest");
				const latestVersion = release.tag_name?.replace(/^v/, "") || null;
				return json(res, { current: CURRENT_VERSION, latest: latestVersion, hasUpdate: latestVersion && latestVersion !== CURRENT_VERSION, releaseName: release.name || null, releaseBody: release.body || null, publishedAt: release.published_at || null });
			} catch (e) {
				return json(res, { current: CURRENT_VERSION, latest: null, hasUpdate: false, error: (e as Error).message }, 502);
			}
		}

		if (pathname === "/api/update/tags" && method === "GET") {
			try {
				const releases = await githubFetch("/releases?per_page=100");
				const list = Array.isArray(releases) ? (releases as AnyRecord[]) : [];
				return json(res, { tags: list.map((r) => ({ name: r.tag_name, title: r.name || r.tag_name, commit: r.target_commitish || null })) });
			} catch (e) {
				return json(res, { tags: [], error: (e as Error).message }, 502);
			}
		}

		if (pathname === "/api/update/do" && method === "POST") {
			try {
				const release = await githubFetch("/releases/latest");
				const targetTag = release.tag_name;
				if (!targetTag) throw new Error("Cannot get latest version tag");
				await checkoutTag(targetTag);
				json(res, { ok: true, message: "Update complete, exiting. Please restart manually." });
				setTimeout(() => process.exit(0), 2000);
			} catch (e) {
				return json(res, { ok: false, message: "Update failed: " + (e as Error).message });
			}
		}

		if (pathname === "/api/update/rollback" && method === "POST") {
			const payload = await readJson(req, res);
			if (!payload) return;
			const { tag: targetTag } = payload;
			if (!targetTag) return json(res, { ok: false, message: "Please specify rollback version tag" }, 400);
			try {
				await checkoutTag(targetTag);
				json(res, { ok: true, message: "Rollback complete, exiting. Please restart manually." });
				setTimeout(() => process.exit(0), 2000);
			} catch (e) {
				return json(res, { ok: false, message: "Rollback failed: " + (e as Error).message });
			}
		}

		json(res, { error: "Not Found" }, 404);
	} catch (e) {
		json(res, { ok: false, message: (e as Error).message }, 400);
	}
}

const server = http.createServer((req, res) => {
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	if (url.pathname.startsWith("/api/")) {
		// 兑底：处理器内部异常不应变成 unhandled rejection（Node 会因此退出进程）
		handleAPI(req, res, url).catch((e) => {
			logger.error("API handler error: " + (e?.stack || e));
			try {
				if (!res.headersSent) json(res, { ok: false, message: "Internal server error" }, 500);
				else res.end();
			} catch {}
		});
		return;
	}
	let filePath = path.join(DIST_DIR, url.pathname);
	if (filePath.endsWith("/") || filePath.endsWith(path.sep)) filePath = path.join(filePath, "index.html");

	// 路径穿越保护：解析后必须仍在 dist 目录内
	const resolvedPath = path.resolve(filePath);
	if (resolvedPath !== DIST_DIR && !resolvedPath.startsWith(DIST_DIR + path.sep)) {
		res.writeHead(403, { "X-Content-Type-Options": "nosniff" });
		res.end("Forbidden");
		return;
	}
	serveStatic(res, filePath);
});

export function startWebServer(onShutdown: (() => Promise<void>) | null = null): Promise<void> {
	if (typeof onShutdown === "function") shutdownHandler = onShutdown;
	return new Promise<void>((resolve, reject) => {
		const onError = (err: Error): void => {
			server.off("listening", onListening);
			reject(err);
		};
		const onListening = () => {
			server.off("error", onError);
			const hasCustomPassword = !!(config.web?.auth?.passwordHash || config.web?.auth?.password);
			if (!hasCustomPassword) {
				temporaryPassword = crypto.randomBytes(8).toString("hex");
				logger.info(`WebUI temporary password: ${temporaryPassword}`);
			}
			const source = hasCustomPassword ? "config file" : "random";
			logger.info(`WebUI started: http://127.0.0.1:${WEB_PORT}/login [${source}]`);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(WEB_PORT, "0.0.0.0");
	});
}

export default { startWebServer };
