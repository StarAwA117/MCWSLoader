import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import { logger } from "./lib/logger.js";
import { closeLogStreams } from "./lib/logger.js";
import { config, ClientModManager, ServerModManager, modRegistry, checkModDependencies } from "./lib/mods.js";
import Utils from "./lib/utils.js";
import Current from "./lib/current.js";
import { startWebServer } from "./web/server.js";

// WebSocket server instance
let server = null;

// Connection tracking for rate limiting
const connectionAttempts = new Map();
const connCfg = (config.ws && config.ws.connection) || {};
const RATE_LIMIT_WINDOW = (connCfg.rateLimitWindow !== undefined) ? connCfg.rateLimitWindow : 60000;
const RATE_LIMIT_MAX = (connCfg.rateLimitMax !== undefined) ? connCfg.rateLimitMax : 10;

function isRateLimited(ip) {
	if (RATE_LIMIT_MAX === 0) return false;
	const now = Date.now();
	const attempts = connectionAttempts.get(ip) || [];
	const recentAttempts = attempts.filter((time) => now - time < RATE_LIMIT_WINDOW);
	connectionAttempts.set(ip, recentAttempts);
	return recentAttempts.length >= RATE_LIMIT_MAX;
}

function recordConnectionAttempt(ip) {
	const now = Date.now();
	const attempts = connectionAttempts.get(ip) || [];
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
}, RATE_LIMIT_WINDOW);

// Active connection tracking for max connections limit
const currentConnections = new Set();

function createServer() {
	const server = new WebSocketServer({
		port: config.ws.port,
		perMessageDeflate: (connCfg.perMessageDeflate) === true,
		clientTracking: true,
		maxPayload: (connCfg.maxPayload !== undefined) ? connCfg.maxPayload : 0
	});

	server.on("error", (error) => {
		logger.error("WebSocket server error: " + error.message);
		logger.debug(error.stack);
	});

	// Origin check
	const allowedOrigins = (config.web?.ui?.allowedOrigins || []);
	if (allowedOrigins.length > 0) {
		server.on("upgrade", (req, socket, head) => {
			const origin = req.headers.origin;
			if (origin) {
				let host = "";
				try { host = new URL(origin).host; } catch {}
				if (host && !allowedOrigins.includes(host) && !allowedOrigins.includes(origin)) {
					logger.warning("WebSocket connection rejected: Origin=" + origin);
					socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
					socket.destroy();
					return;
				}
			}
		});
	}

	return server;
}

// Scan and load mods
modRegistry.scan();
await checkModDependencies();
await ServerModManager.load();
await ClientModManager.load();

// Create WebSocket server
server = createServer();
logger.info("WebSocket server started on port " + config.ws.port);

// Start WebUI server
startWebServer().catch((e) => {
	logger.error("WebUI start failed: " + e.message);
});

// Handle client connections
server.on("connection", (ws) => {
	const clientIP = ws._socket?.remoteAddress || "unknown";

	if (isRateLimited(clientIP)) {
		logger.warning("Connection rate limited: " + clientIP);
		ws.close(1008, "Rate limited");
		return;
	}

	// Max connections check
	const MAX_CONNECTIONS = (connCfg.maxConnections !== undefined) ? connCfg.maxConnections : 0;
	const ENABLE_MAX_CONNECTIONS = (connCfg.enableMaxConnections === true);

	if (ENABLE_MAX_CONNECTIONS && MAX_CONNECTIONS > 0 && currentConnections.size >= MAX_CONNECTIONS) {
		logger.warning('Connection rejected: max connections reached');
		ws.close(1013, 'Max connections reached');
		return;
	}
	currentConnections.add(ws);
	recordConnectionAttempt(clientIP);

	logger.info("Client connected: " + clientIP);

	ws.id = uuidv4();
	ws.utils = new Utils(ws);

	const isMainClient = !Current.client;
	if (isMainClient) {
		Current.client = ws;
		logger.info("Main client connected");
	}

	const clientMod = new ClientModManager(ws);
	ws.clientMod = clientMod;
	ws.localPlayerName = null;
	ws._connectedAt = Date.now();
	Current.clientMods.set(ws, clientMod);

	setTimeout(async () => {
		try {
			const name = await ws.getLocalPlayer();
			if (name) ws.localPlayerName = name;
		} catch {}
	}, 3000);

	ServerModManager.onClientConnect(ws, isMainClient);

	ws.on("message", (message) => {
		let data;
		try {
			data = JSON.parse(String(message));
		} catch {
			return;
		}

		ws.utils.onMessage(data);
		clientMod.callModMethod("onPocket", data);
		ServerModManager.onMessage(ws, data);
	});

	ws.on("close", () => {
		logger.info("Client disconnected: " + clientIP);
		ServerModManager.onClientDisconnect(ws, ws === Current.client);
		if (ws === Current.client) {
			Current.reset();
			logger.info("Main client disconnected");
		}
		currentConnections.delete(ws);
		Current.clientMods.delete(ws);
		clientMod.destroy();
		if (ws.utils && typeof ws.utils.destroy === "function") {
			ws.utils.destroy();
		}
		ws.removeAllListeners();
	});

	ws.on("error", (error) => {
		if (ws === Current.client) {
			logger.error("Main client error: " + error.message);
			logger.debug(error.stack);
		} else {
			logger.warning("Client error from " + clientIP + ": " + error.message);
		}
	});
});

// Shutdown function
let destroying = false;
async function destroy() {
	if (destroying) return;
	destroying = true;

	clearInterval(cleanupTimer);

	logger.info("Shutting down server mods...");
	ServerModManager.destroy();
	logger.info("Server mods closed");

	logger.info("Notifying clients to disconnect...");
	if (server) {
		server.clients.forEach((client) => {
			client.runCommand("/closewebsocket").catch(() => {});
			client.close();
		});
	}
	logger.info("Client notifications completed");

	logger.info("Shutting down server...");

	const hardTimeout = new Promise((_, reject) => {
		setTimeout(() => {
			logger.warning("Server shutdown timeout, force exit");
			reject(new Error("Server shutdown timeout"));
		}, 10000);
	});

	const close = new Promise((resolve) => {
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
process.on("SIGINT", async () => {
	logger.info("Performing graceful shutdown...");
	await destroy();
	closeLogStreams();
	logger.info("Process ended");
	process.exit(0);
});
