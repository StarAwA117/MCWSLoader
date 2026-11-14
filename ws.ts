import { WebSocketServer, WebSocket } from "ws";
import type { RawData } from "ws";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { logger, closeLogStreams } from "./lib/logger.js";
import { config, ClientModManager, ServerModManager, modRegistry, checkModDependencies } from "./lib/mods.js";
import Utils from "./lib/utils.js";
import Current from "./lib/current.js";
import { startWebServer } from "./web/server.js";
import type { Client } from "./types/client.js";
import type { CommandResponse, ConnectionConfig } from "./types/config.js";

// WebSocket server instance
let server: WebSocketServer | null = null;

// Connection tracking for rate limiting
const connectionAttempts = new Map<string, number[]>();
const connCfg: ConnectionConfig = config.ws.connection ?? {};
const RATE_LIMIT_WINDOW = connCfg.rateLimitWindow ?? 60000;
const RATE_LIMIT_MAX = connCfg.rateLimitMax ?? 10;
// WebUI 的开关此前没有生效，始终按 rateLimitMax 限流
const ENABLE_RATE_LIMIT = connCfg.enableConnectionRateLimit !== false;

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
			logger.warning(`WebSocket connection rejected: Origin=${origin}`);
			done(false, 403, "Forbidden");
		}
	});

	wsServer.on("error", (error: Error) => {
		logger.error(`WebSocket server error: ${error.message}`);
		logger.debug(error.stack ?? error.message);
	});

	return wsServer;
}

// Scan first so dependency checks only apply to enabled mods
modRegistry.scan();
await checkModDependencies();
await ServerModManager.load();
await ClientModManager.load();

// Create WebSocket server
server = createServer();
logger.info(`WebSocket server started on port ${config.ws.port}`);

// Start WebUI server (传入关闭钩子，供 WebUI 的重启接口复用)
startWebServer(destroy).catch((e: Error) => {
	logger.error(`WebUI start failed: ${e.message}`);
});

// Handle client connections
server.on("connection", (socket: WebSocket) => {
	const ws = socket as unknown as Client & WebSocket;
	const clientIP = ws._socket?.remoteAddress ?? "unknown";

	if (isRateLimited(clientIP)) {
		logger.warning(`Connection rate limited: ${clientIP}`);
		ws.close(1008, "Rate limited");
		return;
	}

	// Max connections check
	const MAX_CONNECTIONS = connCfg.maxConnections ?? 0;
	const ENABLE_MAX_CONNECTIONS = connCfg.enableMaxConnections === true;

	if (ENABLE_MAX_CONNECTIONS && MAX_CONNECTIONS > 0 && currentConnections.size >= MAX_CONNECTIONS) {
		logger.warning("Connection rejected: max connections reached");
		ws.close(1013, "Max connections reached");
		return;
	}
	currentConnections.add(ws);
	if (ENABLE_RATE_LIMIT && RATE_LIMIT_MAX > 0) recordConnectionAttempt(clientIP);

	logger.info(`Client connected: ${clientIP}`);

	ws.id = randomUUID();
	ws.utils = new Utils(ws);

	const isMainClient = !Current.client;
	const clientMod = new ClientModManager(ws);
	ws.clientMod = clientMod;
	ws.localPlayerName = null;
	ws._connectedAt = Date.now();
	Current.addClient(ws, clientMod);
	if (isMainClient) logger.info("Main client connected");

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
		logger.info(`Client disconnected: ${clientIP}`);
		const wasMain = ws === Current.client;
		ServerModManager.onClientDisconnect(ws, wasMain);

		currentConnections.delete(ws);
		// 只移除当前连接；若它是主客户端，则从剩余连接中选举新的主客户端
		const newMain = Current.removeClient(ws);
		if (wasMain) {
			if (newMain) {
				logger.info(`Main client switched to ${newMain._socket?.remoteAddress ?? "unknown"}`);
				ServerModManager.onMainClientSwitch(ws, newMain);
				ServerModManager.attachMainClient(newMain);
			} else {
				logger.info("Main client disconnected");
			}
		}
		clientMod.destroy();
		ws.utils?.destroy();
		ws.removeAllListeners();
	});

	ws.on("error", (error: Error) => {
		if (ws === Current.client) {
			logger.error(`Main client error: ${error.message}`);
			logger.debug(error.stack ?? error.message);
		} else {
			logger.warning(`Client error from ${clientIP}: ${error.message}`);
		}
	});
});

// Shutdown function
let destroying = false;
async function destroy(): Promise<void> {
	if (destroying) return;
	destroying = true;

	clearInterval(cleanupTimer);

	logger.info("Shutting down server mods...");
	ServerModManager.destroy();
	logger.info("Server mods closed");

	logger.info("Notifying clients to disconnect...");
	if (server) {
		server.clients.forEach((client) => {
			const c = client as unknown as Client;
			c.runCommand("/closewebsocket").catch(() => undefined);
			client.close();
		});
	}
	logger.info("Client notifications completed");

	logger.info("Shutting down server...");

	const hardTimeout = new Promise<never>((_, reject) => {
		setTimeout(() => {
			logger.warning("Server shutdown timeout, force exit");
			reject(new Error("Server shutdown timeout"));
		}, 10000);
	});

	const close = new Promise<void>((resolve) => {
		if (server) {
			server.close(() => {
				logger.info("Server closed");
				resolve();
			});
		} else {
			resolve();
		}
	});

	try {
		await Promise.race([close, hardTimeout]);
	} catch {
		logger.warning("Server shutdown abnormal, forcing exit");
	}
}

// Signal handling
async function shutdown(signal: string): Promise<void> {
	logger.info(`Performing graceful shutdown... (${signal})`);
	await destroy();
	closeLogStreams();
	logger.info("Process ended");
	process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
