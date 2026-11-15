import { WebSocketServer, WebSocket } from "ws";
import type { RawData } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { BlockList, isIP } from "node:net";
import { logger, closeLogStreams } from "./lib/logger.js";
import { config, ClientModManager, ServerModManager, modRegistry, checkModDependencies } from "./lib/mods.js";
import Utils from "./lib/utils.js";
import Current from "./lib/current.js";
import { startWebServer } from "./web/server.js";
import { tForMod } from "./lib/texts.js";
import { errorDetail } from "./lib/errors.js";
import type { Client } from "./lib/types/client.js";
import type { CommandResponse, ConnectionConfig } from "./lib/types/config.js";

// WebSocket server instance
let server: WebSocketServer | null = null;

function tr(key: string, params?: Record<string, unknown>): string {
	return tForMod(null, config.language, key, params);
}

// Connection tracking for rate limiting
const connectionAttempts = new Map<string, number[]>();
const connCfg: ConnectionConfig = config.ws.connection ?? {};
const RATE_LIMIT_WINDOW = connCfg.rateLimitWindow ?? 60000;
const RATE_LIMIT_MAX = connCfg.rateLimitMax ?? 10;
// WebUI 的开关此前没有生效，始终按 rateLimitMax 限流
const ENABLE_RATE_LIMIT = connCfg.enableConnectionRateLimit !== false;

// 原生 MCBE 的 /connect 无法携带 token/header，因此用 IP 白名单 + 人工批准
// 作为握手认证的替代方案。
const IP_ALLOWLIST = new BlockList();
let IP_ALLOWLIST_SIZE = 0;
for (const raw of connCfg.allowedIPs ?? []) {
	const text = String(raw).trim();
	if (!text) continue;
	const [address, prefixText] = text.split("/");
	const family = isIP(address ?? "");
	if (!family) {
		logger.warning(tr("terminal.ws.invalidIp", { value: text }));
		continue;
	}
	const type = family === 6 ? "ipv6" : "ipv4";
	try {
		if (prefixText !== undefined) {
			const prefix = Number(prefixText);
			const max = family === 6 ? 128 : 32;
			if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) throw new Error("invalid prefix");
			IP_ALLOWLIST.addSubnet(address ?? "", prefix, type);
		} else {
			IP_ALLOWLIST.addAddress(address ?? "", type);
		}
		IP_ALLOWLIST_SIZE++;
	} catch {
		logger.warning(tr("terminal.ws.invalidIp", { value: text }));
	}
}

function isLoopbackHost(host: string): boolean {
	return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

const REQUIRE_APPROVAL = connCfg.requireApproval ?? !isLoopbackHost(config.ws.host ?? "127.0.0.1");

function normalizeIP(ip: string): string {
	return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

function isLoopbackIP(ip: string): boolean {
	const value = normalizeIP(ip);
	return value === "::1" || value.startsWith("127.");
}

function isIPAllowed(ip: string): boolean {
	if (IP_ALLOWLIST_SIZE === 0) return true;
	const value = normalizeIP(ip);
	const family = isIP(value);
	if (!family) return false;
	return IP_ALLOWLIST.check(value, family === 6 ? "ipv6" : "ipv4");
}

function isRateLimited(ip: string): boolean {
	if (!ENABLE_RATE_LIMIT || RATE_LIMIT_MAX <= 0) return false;
	const now = Date.now();
	const attempts = connectionAttempts.get(ip) ?? [];
	const recentAttempts = attempts.filter((time) => now - time < RATE_LIMIT_WINDOW);
	connectionAttempts.set(ip, recentAttempts);
	return recentAttempts.length >= RATE_LIMIT_MAX;
}

function recordConnectionAttempt(ip: string): void {
	const now = Date.now();
	const attempts = connectionAttempts.get(ip) ?? [];
	attempts.push(now);
	connectionAttempts.set(ip, attempts);
}

// Periodic cleanup of stale rate-limit entries
const cleanupTimer = setInterval(() => {
	const now = Date.now();
	for (const [ip, attempts] of connectionAttempts) {
		const recent = attempts.filter((time) => now - time < RATE_LIMIT_WINDOW);
		if (recent.length === 0) connectionAttempts.delete(ip);
		else connectionAttempts.set(ip, recent);
	}
}, Math.max(1000, RATE_LIMIT_WINDOW));

// Active connection tracking for max connections limit
const currentConnections = new Set<Client>();

function createServer(): WebSocketServer {
	// 游戏客户端不带 Origin；浏览器必须显式允许，防止任意网页连接本地 WS
	// 并伪造 PlayerMessage / 发送命令。
	const allowedOrigins = config.web?.ui?.allowedOrigins ?? [];

	const wsServer = new WebSocketServer({
		port: config.ws.port,
		// 默认只监听本机；局域网连接需在 config.ws.host 设置 0.0.0.0
		host: config.ws.host ?? "127.0.0.1",
		perMessageDeflate: connCfg.perMessageDeflate === true,
		clientTracking: true,
		// 0/未设置时使用 8MB 上限，避免无限 payload 占用内存
		maxPayload: connCfg.maxPayload && connCfg.maxPayload > 0 ? connCfg.maxPayload : 8 * 1024 * 1024,
		verifyClient: (info, done) => {
			const origin = info.origin;
			if (!origin) return done(true);
			let host = "";
			try {
				host = new URL(origin).host;
			} catch {
				// invalid origin
			}
			if (allowedOrigins.includes(origin) || (host && allowedOrigins.includes(host))) {
				return done(true);
			}
			logger.warning(tr("terminal.ws.originRejected", { origin }));
			done(false, 403, "Forbidden");
		}
	});

	wsServer.on("error", (error: Error) => {
		logger.error(tr("terminal.ws.serverError"));
		logger.debug(errorDetail(error));
	});
	wsServer.on("close", () => {
		if (server === wsServer) server = null;
	});

	return wsServer;
}

const MODE = config.mode ?? "both";
let startingServer: Promise<void> | null = null;
let stoppingServer: Promise<void> | null = null;

async function startWebSocketServer(): Promise<void> {
	if (server) return;
	if (stoppingServer) await stoppingServer;
	if (server) return;
	if (startingServer) return startingServer;

	const task = (async (): Promise<void> => {
		const wsServer = createServer();
		wsServer.on("connection", handleConnection);
		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error): void => {
				wsServer.off("listening", onListening);
				try { wsServer.close(); } catch { /* ignore */ }
				reject(error);
			};
			const onListening = (): void => {
				wsServer.off("error", onError);
				server = wsServer;
				logger.info(tr("terminal.ws.started", { port: config.ws.port }));
				resolve();
			};
			wsServer.once("error", onError);
			wsServer.once("listening", onListening);
		});
	})();

	startingServer = task;
	try {
		await task;
	} finally {
		if (startingServer === task) startingServer = null;
	}
}

async function stopWebSocketServer(): Promise<void> {
	if (stoppingServer) return stoppingServer;
	const task = (async (): Promise<void> => {
		if (startingServer) {
			try { await startingServer; } catch { /* start failed; nothing to stop */ }
		}
		const current = server;
		if (!current) return;
		server = null;
		for (const client of current.clients) {
			try { client.terminate(); } catch { /* ignore */ }
		}
		await new Promise<void>((resolve) => {
			const timer = setTimeout(resolve, 1500);
			current.close(() => {
				clearTimeout(timer);
				resolve();
			});
		});
	})();

	stoppingServer = task;
	try {
		await task;
	} finally {
		if (stoppingServer === task) stoppingServer = null;
	}
}

function isWebSocketRunning(): boolean {
	return server !== null;
}

// Scan first so dependency checks only apply to enabled mods
modRegistry.scan();
await checkModDependencies();
await ServerModManager.load();
await ClientModManager.load();

if (MODE !== "webui" && MODE !== "gui") {
	await startWebSocketServer();
}

if (MODE !== "websocket") {
	startWebServer(destroy, { startWebSocket: startWebSocketServer, stopWebSocket: stopWebSocketServer, isWebSocketRunning }).catch((e: Error) => {
		logger.error(tr("terminal.ws.webuiFailed"));
		logger.debug(errorDetail(e));
	});
}

// Handle client connections
function handleConnection(socket: WebSocket): void {
	const ws = socket as unknown as Client & WebSocket;
	const clientIP = normalizeIP(ws._socket?.remoteAddress ?? "unknown");

	if (!isIPAllowed(clientIP)) {
		logger.warning(tr("terminal.ws.ipRejected", { ip: clientIP }));
		ws.close(1008, "Forbidden");
		return;
	}

	if (isRateLimited(clientIP)) {
		logger.warning(tr("terminal.ws.rateLimited", { ip: clientIP }));
		ws.close(1008, "Rate limited");
		return;
	}

	// Max connections check
	const MAX_CONNECTIONS = connCfg.maxConnections ?? 0;
	const ENABLE_MAX_CONNECTIONS = connCfg.enableMaxConnections === true;

	if (ENABLE_MAX_CONNECTIONS && MAX_CONNECTIONS > 0 && currentConnections.size >= MAX_CONNECTIONS) {
		logger.warning(tr("terminal.ws.maxConnections"));
		ws.close(1013, "Max connections reached");
		return;
	}
	currentConnections.add(ws);
	if (ENABLE_RATE_LIMIT && RATE_LIMIT_MAX > 0) recordConnectionAttempt(clientIP);

	logger.info(tr("terminal.ws.clientConnected", { ip: clientIP }));

	ws.id = randomUUID();
	ws.trusted = !REQUIRE_APPROVAL || isLoopbackIP(clientIP);
	ws.utils = new Utils(ws);

	const isMainClient = !Current.client && ws.trusted;
	const clientMod = new ClientModManager(ws);
	ws.clientMod = clientMod;
	ws.localPlayerName = null;
	ws._connectedAt = Date.now();
	Current.addClient(ws, clientMod);
	if (!ws.trusted) clientMod.sapi?.stop();
	if (isMainClient) logger.info(tr("terminal.ws.mainConnected"));
	else if (!ws.trusted) logger.warning(tr("terminal.ws.pendingApproval", { ip: clientIP }));

	setTimeout(async () => {
		try {
			// 客户端可能在 3 秒内就断开，回调前先确认连接仍然有效
			if (ws.readyState !== WebSocket.OPEN) return;
			const name = await ws.getLocalPlayer();
			if (name && ws.readyState === WebSocket.OPEN) ws.localPlayerName = name;
		} catch {
			// ignore
		}
	}, 3000);

	ServerModManager.onClientConnect(ws, isMainClient);

	ws.on("message", (message: RawData) => {
		// 原生 MCBE 无法在握手时认证，未批准连接的所有包直接丢弃
		if (ws.trusted === false) return;

		let data: unknown;
		try {
			data = JSON.parse(String(message));
		} catch {
			return;
		}

		ws.utils?.onMessage(data as CommandResponse);
		clientMod.callModMethod("onPocket", data);
		ServerModManager.onMessage(ws, data as CommandResponse);
	});

	ws.on("close", () => {
		logger.info(tr("terminal.ws.clientDisconnected", { ip: clientIP }));
		const wasMain = ws === Current.client;
		ServerModManager.onClientDisconnect(ws, wasMain);

		currentConnections.delete(ws);
		// 只移除当前连接；若它是主客户端，则从剩余连接中选举新的主客户端
		const newMain = Current.removeClient(ws);
		if (wasMain) {
			if (newMain) {
				logger.info(tr("terminal.ws.mainSwitched", { ip: newMain._socket?.remoteAddress ?? tr("terminal.list.unknownIp") }));
				ServerModManager.onMainClientSwitch(ws, newMain);
				ServerModManager.attachMainClient(newMain);
			} else {
				logger.info(tr("terminal.ws.mainDisconnected"));
			}
		}
		clientMod.destroy();
		ws.utils?.destroy();
		ws.removeAllListeners();
	});

	ws.on("error", (error: Error) => {
		if (ws === Current.client) {
			logger.error(tr("terminal.ws.mainError"));
			logger.debug(error.stack ?? error.message);
		} else {
			logger.warning(tr("terminal.ws.clientError", { ip: clientIP }));
			logger.debug(errorDetail(error));
		}
	});
}

// Shutdown function
let destroying = false;
async function destroy(): Promise<void> {
	if (destroying) return;
	destroying = true;

	clearInterval(cleanupTimer);

	logger.info(tr("terminal.ws.shutdownMods"));
	ServerModManager.destroy();
	logger.info(tr("terminal.ws.modsClosed"));

	logger.info(tr("terminal.ws.notifying"));
	if (server) {
		server.clients.forEach((client) => {
			const c = client as unknown as Client;
			c.runCommand("/closewebsocket").catch(() => undefined);
			client.close();
		});
	}
	logger.info(tr("terminal.ws.notified"));

	logger.info(tr("terminal.ws.shuttingDown"));

	const hardTimeout = new Promise<never>((_, reject) => {
		setTimeout(() => {
			logger.warning(tr("terminal.ws.shutdownTimeout"));
			reject(new Error("Server shutdown timeout"));
		}, 10000);
	});

	const close = new Promise<void>((resolve) => {
		if (server) {
			server.close(() => {
				server = null;
				logger.info(tr("terminal.ws.closed"));
				resolve();
			});
		} else {
			resolve();
		}
	});

	try {
		await Promise.race([close, hardTimeout]);
	} catch {
		logger.warning(tr("terminal.ws.shutdownAbnormal"));
	}
}

// Signal handling
async function shutdown(signal: string): Promise<void> {
	logger.info(tr("terminal.ws.graceful", { signal }));
	await destroy();
	logger.info(tr("terminal.ws.processEnded"));
	await closeLogStreams();
	process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
