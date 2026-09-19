import http from "http";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { exec, execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { config, reloadConfig, eventBus, ServerModManager, ClientModManager, modRegistry } from "../lib/mods.js";
import Current from "../lib/current.js";
import PermissionManager from "../lib/permission.js";
import Command from "../lib/command.js";
import { logger } from "../lib/logger.js";
import { collectCommands as collectTerminalCommands } from "../lib/readline.js";
import { parseMultipartBody } from "../../multipart.js";

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
const CURRENT_VERSION = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8")).version;

let logBuffer = [];
let temporaryPassword = null;
let updating = false;
let rollingBack = false;
const LOG_BUFFER_MAX = 500;

const originalLog = logger.log.bind(logger);
logger.log = function (message, type) {
	originalLog(message, type);
	if (type && ["info", "warning", "error", "debug"].includes(type)) {
		const entry = { time: Date.now(), type, message };
		logBuffer.push(entry);
		if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
	}
};

// --- Auth rate limiting ---
const authAttempts = new Map();

function getAuthState(ip) {
	const now = Date.now();
	let state = authAttempts.get(ip);
	if (!state) {
		state = { attempts: [], lockedUntil: 0 };
		authAttempts.set(ip, state);
	}
	state.attempts = state.attempts.filter(t => now - t < AUTH_WINDOW_MS);
	if (state.lockedUntil && now > state.lockedUntil) {
		state.lockedUntil = 0;
		state.attempts = [];
	}
	return state;
}

function json(res, obj, status = 200) {
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

function readBody(req) {
	return new Promise((resolve, reject) => {
		let body = "";
		req.on("data", (c) => { body += c; });
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}

function getClientInfo(ws) {
	return {
		id: ws.id,
		ip: ws._socket?.remoteAddress || "unknown",
		isMain: ws === Current.client,
		connectedAt: ws._connectedAt || Date.now(),
		localPlayerName: ws.localPlayerName || null
	};
}

const SESSION_TIMEOUT = 24 * 60 * 60 * 1000; // 24 hours
const sessions = new Map();

function hashPassword(password) {
	return new Promise((resolve, reject) => {
		const salt = crypto.randomBytes(16).toString("hex");
		crypto.scrypt(password, salt, 64, (err, derivedKey) => {
			if (err) return reject(err);
			resolve({ salt, hash: derivedKey.toString("hex") });
		});
	});
}

function verifyPassword(password, salt, hash) {
	return new Promise((resolve, reject) => {
		crypto.scrypt(password, salt, 64, (err, derivedKey) => {
			if (err) return reject(err);
			resolve(derivedKey.toString("hex") === hash);
		});
	});
}

async function checkPassword(password) {
	const auth = config.web?.auth || {};
	if (auth.passwordHash && auth.salt) {
		return await verifyPassword(password, auth.salt, auth.passwordHash);
	}
	if (temporaryPassword && password === temporaryPassword) {
		return true;
	}
	return false;
}

function createSession(ip) {
	const token = crypto.randomBytes(32).toString("hex");
	sessions.set(token, { ip, createdAt: Date.now() });
	return token;
}

function validateSession(token) {
	if (!token) return false;
	const session = sessions.get(token);
	if (!session) return false;
	if (Date.now() - session.createdAt > SESSION_TIMEOUT) {
		sessions.delete(token);
		return false;
	}
	return true;
}

function writeConfig() {
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, "	") + "\n", "utf-8");
}

const startTime = Date.now();

const MIME_TYPES = {
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

function sendHTML(res, filePath) {
	const html = fs.readFileSync(filePath, "utf-8");
	const injected = html.replace("<head>", `<head><script>window.__LANGUAGE__="${config.language}";</script>`);
	res.writeHead(200, {
		"Content-Type": "text/html; charset=utf-8",
		"X-Content-Type-Options": "nosniff",
		"X-Frame-Options": "DENY",
		"Cache-Control": "no-store"
	});
	res.end(injected);
}

function serveStatic(res, filePath) {
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
	const headers = {
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

async function handleAPI(req, res, url) {
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
	if (pathname === "/api/login" && method === "GET") {
		const password = url.searchParams.get("pwd") || "";
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
			const clients = [];
			for (const [ws] of Current.clientMods) clients.push(getClientInfo(ws));
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
			const authToken = req.headers["x-auth-token"];
			if (!validateSession(authToken)) return json(res, { ok: false, message: "Unauthorized" }, 401);
			const body = await readBody(req);
			let payload;
			try { payload = JSON.parse(body); } catch { return json(res, { ok: false, message: "Invalid request format" }, 400); }
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
			const cfg = JSON.parse(JSON.stringify(config));
			if (cfg.ai?.options?.apiKey) cfg.ai.options.apiKey = "***";
			if (cfg.web?.auth) {
				cfg.web.auth.passwordHash = "";
				cfg.web.auth.salt = "";
			}
			return json(res, cfg);
		}
		if (pathname === "/api/config" && method === "PUT") {
			const body = await readBody(req);
			const newCfg = JSON.parse(body);
			fs.writeFileSync(CONFIG_PATH, JSON.stringify(newCfg, null, "\t") + "\n", "utf-8");
			reloadConfig();
			return json(res, { ok: true, message: "Config saved" });
		}

		// Auth: change password
		if (pathname === "/api/auth/change-password" && method === "POST") {
			const authToken = req.headers["x-auth-token"];
			if (!validateSession(authToken)) return json(res, { ok: false, message: "Unauthorized" }, 401);
			const body = await readBody(req);
			let payload;
			try { payload = JSON.parse(body); } catch { return json(res, { ok: false, message: "Invalid request format" }, 400); }
			const oldPassword = String(payload.oldPassword || "");
			const newPassword = String(payload.newPassword || "");
			const auth = config.web?.auth || {};
			let valid = false;
			if (auth.passwordHash && auth.salt) {
				valid = await verifyPassword(oldPassword, auth.salt, auth.passwordHash);
			} else if (auth.password) {
				valid = oldPassword === auth.password;
			}
			if (!valid) return json(res, { ok: false, message: "Incorrect old password" }, 401);
			try {
				const { salt, hash } = await hashPassword(newPassword);
				auth.password = "";
				auth.salt = salt;
				auth.passwordHash = hash;
				await writeConfig();
				sessions.delete(authToken);
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
			const body = await readBody(req);
			const perm = JSON.parse(body);
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

		// Mod import
		if (pathname === "/api/mods/import" && method === "POST") {
			try {
				const contentType = req.headers["content-type"] || "";
				if (!contentType.includes("multipart/form-data")) {
					return json(res, { ok: false, message: "Invalid content type" }, 400);
				}

				const chunks = [];
				for await (const chunk of req) chunks.push(chunk);
				const buffer = Buffer.concat(chunks);
				const parts = parseMultipartBody(buffer, contentType);
				const filePart = parts?.file;
				if (!filePart || !filePart.buffer) {
					return json(res, { ok: false, message: "No file uploaded" }, 400);
				}

				const modDir = path.join(__dirname, "..", "..", "mod");
				const tempDir = path.join(modDir, "..", "tmp", "mod_import_" + Date.now());
				fs.mkdirSync(tempDir, { recursive: true });

				const zipPath = path.join(tempDir, "upload.zip");
				fs.writeFileSync(zipPath, filePart.buffer);

				const { execAsync } = await import("child_process");
				const { promisify } = await import("util");
				const execAsyncP = promisify(execAsync);
				await execAsyncP(`unzip -q \"${zipPath}\" -d \"${tempDir}\"`);

				const manifestPath = path.join(tempDir, "manifest.json");
				if (!fs.existsSync(manifestPath)) {
					fs.rmSync(tempDir, { recursive: true, force: true });
					return json(res, { ok: false, message: "Invalid mod: missing manifest.json" }, 400);
				}

				const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
				const modName = manifest.name;
				if (!modName) {
					fs.rmSync(tempDir, { recursive: true, force: true });
					return json(res, { ok: false, message: "Invalid manifest: name is required" }, 400);
				}

				const targetDir = path.join(modDir, modName);
				if (fs.existsSync(targetDir)) {
					fs.rmSync(targetDir, { recursive: true, force: true });
				}
				fs.mkdirSync(targetDir, { recursive: true });

				const entries = fs.readdirSync(tempDir);
				for (const entry of entries) {
					const src = path.join(tempDir, entry);
					const dst = path.join(targetDir, entry);
					if (fs.statSync(src).isDirectory()) {
						fs.mkdirSync(dst, { recursive: true });
						const inner = fs.readdirSync(src);
						for (const f of inner) {
							fs.copyFileSync(path.join(src, f), path.join(dst, f));
						}
					} else {
						fs.copyFileSync(src, dst);
					}
				}

				fs.rmSync(tempDir, { recursive: true, force: true });

				if (manifest.dependencies && Array.isArray(manifest.dependencies)) {
					for (const dep of manifest.dependencies) {
						try {
							if (dep.url) {
								logger.info(`Downloading dependency: ${dep.name || dep.url}`);
								const depPath = path.join(modDir, dep.name || path.basename(dep.url));
								const depRes = await fetch(dep.url);
								if (!depRes.ok) throw new Error(`HTTP ${depRes.status}`);
								const depBuf = Buffer.from(await depRes.arrayBuffer());
								fs.writeFileSync(depPath, depBuf);
							}
						} catch (e) {
							logger.error(`Dependency download failed: ${dep.name || dep.url}: ${e.message}`);
							return json(res, { ok: false, message: `Dependency download failed: ${dep.name || dep.url}` }, 500);
						}
					}
				}

				modRegistry.scan();
				await ServerModManager.reloadAll();
				await ClientModManager.reloadAllClients();

				return json(res, { ok: true, message: "Import successful" });
			} catch (e) {
				logger.error("Mod import failed: " + e.message);
				return json(res, { ok: false, message: "Import failed: " + e.message }, 500);
			}
		}
			reloadConfig();
			const serverResult = await ServerModManager.reloadAll();
			const clientResult = await ClientModManager.reloadAllClients();
			return json(res, {
				ok: true,
				server: { success: serverResult.success, failed: serverResult.failed },
				client: { success: clientResult.success.length, failed: clientResult.failed }
			});
		}

		// Mod enable/disable
		const modEnableMatch = pathname.match(/^\/api\/mods\/(.+)\/enable$/);
		if (modEnableMatch && method === "POST") {
			const modName = decodeURIComponent(modEnableMatch[1]);
			const modEntry = modRegistry.list().find(m => m.name === modName);
			if (!modEntry) return json(res, { ok: false, message: "Mod not found" }, 404);
			const r = modRegistry.enable(modEntry.id);
			if (r.ok) {
				try {
					if (modEntry.entry.server) {
						const sm = ServerModManager._inst();
						if (sm) await sm.reload(modEntry.name);
					}
					if (modEntry.entry.client) {
						const ts = Date.now();
						const modPath = path.join(modEntry.path, modEntry.entry.client);
						const modModule = await import(`${modPath}?t=${ts}`);
						if (modModule.default) {
							modEntry.clientClass = modModule.default;
							ClientModManager.loadedMod[modEntry.name] = modModule.default;
							for (const [, mgr] of Current.clientMods) {
								if (!mgr) continue;
								if (mgr.modInstances[modEntry.name]) {
									const old = mgr.modInstances[modEntry.name];
									const dm = mgr._resolveModMethod(old, "onDestroy") || mgr._resolveModMethod(old, "destroy");
									if (dm) { try { dm.fn.apply(dm.ctx); } catch {} }
									if (mgr.sapi && typeof mgr.sapi.clearMod === "function") mgr.sapi.clearMod(modEntry.name);
									if (mgr.client.utils && typeof mgr.client.utils.removeOwner === "function") mgr.client.utils.removeOwner(modEntry.name);
									eventBus.clearMod(`client_${mgr.client?.id || "unknown"}_${modEntry.name}`);
									mgr.client[modEntry.name] = null;
									delete mgr.modInstances[modEntry.name];
								}
								try { mgr._instantiateMod(modEntry.name, modModule.default); mgr._collectCommands(); }
								catch (e) { logger.error(`Client Mod ${modEntry.name} enable instantiation failed: ${e.message}`); }
							}
						}
					}
				} catch (e) { logger.error(`Mod ${modEntry.name} hot reload failed: ${e.message}`); }
			}
			collectTerminalCommands(ServerModManager, ClientModManager);
			return json(res, r);
		}
		const modDisableMatch = pathname.match(/^\/api\/mods\/(.+)\/disable$/);
		if (modDisableMatch && method === "POST") {
			const modName = decodeURIComponent(modDisableMatch[1]);
			const modEntry = modRegistry.list().find(m => m.name === modName);
			if (!modEntry) return json(res, { ok: false, message: "Mod not found" }, 404);
			if (modEntry.entry.server) {
				const sm = ServerModManager._inst();
				if (sm?.modInstances[modEntry.name]) {
					const dm = sm._resolveMethod(sm.modInstances[modEntry.name], "onDestroy") || sm._resolveMethod(sm.modInstances[modEntry.name], "destroy");
					if (dm) { try { dm.fn.apply(dm.ctx); } catch {} }
					eventBus.clearMod(modEntry.name);
					delete sm.modInstances[modEntry.name];
					delete ServerModManager.loadedMod[modEntry.name];
				}
			}
			if (modEntry.entry.client) {
				for (const [, mgr] of Current.clientMods) {
					if (mgr?.modInstances[modEntry.name]) {
						const dm = mgr._resolveModMethod(mgr.modInstances[modEntry.name], "onDestroy") || mgr._resolveModMethod(mgr.modInstances[modEntry.name], "destroy");
						if (dm) { try { dm.fn.apply(dm.ctx); } catch {} }
						if (mgr.sapi && typeof mgr.sapi.clearMod === "function") mgr.sapi.clearMod(modEntry.name);
						if (mgr.client.utils && typeof mgr.client.utils.removeOwner === "function") mgr.client.utils.removeOwner(modEntry.name);
						delete mgr.modInstances[modEntry.name];
						delete ClientModManager.loadedMod[modEntry.name];
						mgr.client[modEntry.name] = null;
						mgr._collectCommands();
					}
				}
			}
			const r = modRegistry.disable(modEntry.id);
			collectTerminalCommands(ServerModManager, ClientModManager);
			return json(res, r);
		}

		// Mod hot reload
		const modReloadMatch = pathname.match(/^\/api\/mods\/(.+)\/reload$/);
		if (modReloadMatch && method === "POST") {
			const modName = decodeURIComponent(modReloadMatch[1]);
			const modEntry = modRegistry.list().find(m => m.name === modName);
			if (!modEntry) return json(res, { ok: false, message: "Mod not found" }, 404);
			const results = { server: null, client: null };
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

		// Mod config
		const modConfigMatch = pathname.match(/^\/api\/mods\/(.+)\/config$/);
		if (modConfigMatch && method === "GET") {
			const modName = decodeURIComponent(modConfigMatch[1]);
			const modEntry = modRegistry.list().find(m => m.name === modName);
			if (!modEntry) return json(res, { ok: false, message: "Mod not found" }, 404);
			const configPath = path.join(modEntry.path, "config.json");
			const examplePath = path.join(modEntry.path, "config.example.json");
			if (!fs.existsSync(configPath) && !fs.existsSync(examplePath)) {
				return json(res, { ok: false, message: "Mod has no config file" }, 404);
			}
			let modConfig = {};
			if (fs.existsSync(configPath)) {
				modConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
			}
			return json(res, { ok: true, config: modConfig });
		}
		if (modConfigMatch && method === "PUT") {
			const modName = decodeURIComponent(modConfigMatch[1]);
			const modEntry = modRegistry.list().find(m => m.name === modName);
			if (!modEntry) return json(res, { ok: false, message: "Mod not found" }, 404);
			const body = await readBody(req);
			const newConfig = JSON.parse(body);
			const configPath = path.join(modEntry.path, "config.json");
			fs.writeFileSync(configPath, JSON.stringify(newConfig, null, "\t") + "\n", "utf-8");
			return json(res, { ok: true, message: "Config saved" });
		}

		// Mod manifest
		const modManifestMatch = pathname.match(/^\/api\/mods\/(.+)\/manifest$/);
		if (modManifestMatch && method === "GET") {
			const modName = decodeURIComponent(modManifestMatch[1]);
			const modEntry = modRegistry.list().find(m => m.name === modName);
			if (!modEntry) return json(res, { ok: false, message: "Mod not found" }, 404);
			const manifestPath = path.join(modEntry.path, "manifest.json");
			if (!fs.existsSync(manifestPath)) return json(res, { ok: false, message: "Manifest file not found" }, 404);
			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
			return json(res, { ok: true, manifest });
		}

		// Mod README
		const modReadmeMatch = pathname.match(/^\/api\/mods\/(.+)\/readme$/);
		if (modReadmeMatch && method === "GET") {
			const modName = decodeURIComponent(modReadmeMatch[1]);
			const modEntry = modRegistry.list().find(m => m.name === modName);
			if (!modEntry) return json(res, { ok: false, message: "Mod not found" }, 404);
			const readmePath = path.join(modEntry.path, "README.md");
			if (!fs.existsSync(readmePath)) return json(res, { ok: false, message: "No README file" });
			const readme = fs.readFileSync(readmePath, "utf-8");
			return json(res, { ok: true, readme });
		}

		// Commands
		if (pathname === "/api/commands" && method === "GET") {
			const cmds = [];
			if (Current.client?.clientMod) {
				const cm = Current.client.clientMod;
				for (const level of ["normal", "user", "op", "owner"]) {
					for (const cmd of (cm.commands[level] || [])) {
						cmds.push({
							name: `${Command.commandPrefix}${cmd.name}`,
							description: cmd.description,
							level,
							params: cmd.parameters.map(p => ({ type: typeof p[0] === "object" ? "enum" : p[0], desc: p[1], optional: p[2] }))
						});
					}
				}
			}
			return json(res, cmds);
		}
		if (pathname === "/api/command" && method === "POST") {
			const body = await readBody(req);
			const { command } = JSON.parse(body);
			if (!command) throw new Error("Command cannot be empty");
			if (!Current.client) throw new Error("Main client not connected");
			const result = await Current.client.runCommand(command);
			return json(res, { ok: true, result });
		}

		// Clients
		if (pathname === "/api/clients" && method === "GET") {
			const clients = [];
			for (const [ws] of Current.clientMods) clients.push(getClientInfo(ws));
			return json(res, clients);
		}
		const clientTellMatch = pathname.match(/^\/api\/clients\/(.+)\/tell$/);
		if (clientTellMatch && method === "POST") {
			const clientId = clientTellMatch[1];
			const body = await readBody(req);
			const { message } = JSON.parse(body);
			for (const [ws] of Current.clientMods) {
				if (ws.id === clientId) { ws.tell(message); return json(res, { ok: true }); }
			}
			return json(res, { ok: false, message: "Client not found" }, 404);
		}
		const clientMoveMatch = pathname.match(/^\/api\/clients\/(.+)\/set-main$/);
		if (clientMoveMatch && method === "POST") {
			const clientId = clientMoveMatch[1];
			for (const [ws] of Current.clientMods) {
				if (ws.id === clientId) { Current.client = ws; return json(res, { ok: true }); }
			}
			return json(res, { ok: false, message: "Client not found" }, 404);
		}
		const clientDisconnectMatch = pathname.match(/^\/api\/clients\/(.+)\/disconnect$/);
		if (clientDisconnectMatch && method === "POST") {
			const clientId = clientDisconnectMatch[1];
			for (const [ws] of Current.clientMods) {
				if (ws.id === clientId) {
					if (ws === Current.client) Current.client = null;
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
				try { await destroy(); } catch {}
				const { spawn } = await import("child_process");
				spawn(process.argv[0], process.argv.slice(1), { detached: true, stdio: "inherit" }).unref();
				process.exit(0);
			}, 500);
			return;
		}

		// Logs
		if (pathname === "/api/logs" && method === "GET") {
			const logName = url.searchParams.get("name") || "app";
			const lines = parseInt(url.searchParams.get("lines") || "200", 10);
			const logPath = path.resolve(__dirname, "..", "logs", `${logName}.log`);
			if (!fs.existsSync(logPath)) return json(res, { lines: [] });
			const content = fs.readFileSync(logPath, "utf-8");
			return json(res, { lines: content.split("\n").filter(Boolean).slice(-lines) });
		}
		if (pathname === "/api/logs/live" && method === "GET") {
			return json(res, { lines: logBuffer.slice(-100) });
		}

		// Chat
		if (pathname === "/api/chat" && method === "GET") {
			const logPath = path.resolve(__dirname, "..", "logs", "message.log");
			if (!fs.existsSync(logPath)) return json(res, { lines: [] });
			const content = fs.readFileSync(logPath, "utf-8");
			return json(res, { lines: content.split("\n").filter(Boolean).slice(-100) });
		}
		if (pathname === "/api/chat" && method === "POST") {
			const body = await readBody(req);
			const { message } = JSON.parse(body);
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
		async function githubFetch(apiPath) {
			const res = await fetch(`${GITHUB_API}${apiPath}`, {
				headers: { "Accept": "application/vnd.github+json", "User-Agent": "MCWSLoader-UpdateChecker" }
			});
			if (!res.ok) throw new Error(`GitHub API request failed: HTTP ${res.status}`);
			return res.json();
		}

		if (pathname === "/api/update/check" && method === "GET") {
			try {
				const release = await githubFetch("/releases/latest");
				const latestVersion = release.tag_name?.replace(/^v/, "") || null;
				return json(res, { current: CURRENT_VERSION, latest: latestVersion, hasUpdate: latestVersion && latestVersion !== CURRENT_VERSION, releaseName: release.name || null, releaseBody: release.body || null, publishedAt: release.published_at || null });
			} catch (e) {
				return json(res, { current: CURRENT_VERSION, latest: null, hasUpdate: false, error: e.message }, 502);
			}
		}

		if (pathname === "/api/update/tags" && method === "GET") {
			try {
				const releases = await githubFetch("/releases?per_page=100");
				return json(res, { tags: releases.map(r => ({ name: r.tag_name, name: r.name || r.tag_name, commit: r.target_commitish || null })) });
			} catch (e) {
				return json(res, { tags: [], error: e.message }, 502);
			}
		}

		if (pathname === "/api/update/do" && method === "POST") {
			updating = true;
			try {
				const release = await githubFetch("/releases/latest");
				const targetTag = release.tag_name;
				if (!targetTag) throw new Error("Cannot get latest version tag");
				await execAsync("git fetch --all", { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 });
				await execAsync("git reset --hard HEAD", { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 });
				await execFileAsync("git", ["checkout", "-f", targetTag], { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 });
				await execAsync("npm install", { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024, timeout: 300000 });
				json(res, { ok: true, message: "Update complete, exiting. Please restart manually." });
				setTimeout(() => process.exit(0), 2000);
			} catch (e) {
				updating = false;
				return json(res, { ok: false, message: "Update failed: " + e.message });
			}
		}

		if (pathname === "/api/update/rollback" && method === "POST") {
			const body = await readBody(req);
			let targetTag = null;
			try { targetTag = JSON.parse(body).tag; } catch {}
			if (!targetTag) return json(res, { ok: false, message: "Please specify rollback version tag" }, 400);
			rollingBack = true;
			try {
				await execAsync("git fetch --all", { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 });
				await execAsync("git reset --hard HEAD", { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 });
				await execFileAsync("git", ["checkout", "-f", targetTag], { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 });
				await execAsync("npm install", { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024, timeout: 300000 });
				json(res, { ok: true, message: "Rollback complete, exiting. Please restart manually." });
				setTimeout(() => process.exit(0), 2000);
			} catch (e) {
				rollingBack = false;
				return json(res, { ok: false, message: "Rollback failed: " + e.message });
			}
		}

		json(res, { error: "Not Found" }, 404);
	} catch (e) {
		json(res, { ok: false, message: e.message }, 400);
	}
}

const server = http.createServer((req, res) => {
	const url = new URL(req.url, "http://127.0.0.1");
	if (url.pathname.startsWith("/api/")) {
		handleAPI(req, res, url);
		return;
	}
	let filePath = path.join(DIST_DIR, url.pathname);
	if (filePath.endsWith("/") || filePath.endsWith(path.sep)) filePath = path.join(filePath, "index.html");
	serveStatic(res, filePath);
});

export function startWebServer() {
	return new Promise((resolve) => {
		server.listen(WEB_PORT, "0.0.0.0", () => {
			const hasCustomPassword = !!(config.web?.auth?.passwordHash || config.web?.auth?.password);
			if (!hasCustomPassword) {
				temporaryPassword = crypto.randomBytes(8).toString("hex");
				logger.info(`WebUI temporary password: ${temporaryPassword}`);
			}
			const source = hasCustomPassword ? "config file" : "random";
			logger.info(`WebUI started: http://127.0.0.1:${WEB_PORT}/login [${source}]`);
			resolve();
		});
	});
}

export default { startWebServer };
