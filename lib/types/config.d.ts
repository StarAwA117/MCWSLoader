/**
 * 全局配置结构（config.json）
 *
 * 允许额外字段：Mod 自身配置会与全局配置合并，第三方 Mod 可自由扩展。
 */

export interface RateLimitConfig {
	enabled?: boolean;
	windowMs?: number;
	maxPerWindow?: number;
}

export interface CommandConfig {
	maxLength?: number;
	rateLimit?: RateLimitConfig;
	/** 单个玩家聊天命令限流（默认 10 条 / 5 秒） */
	playerRateLimit?: RateLimitConfig;
	/** 是否允许 owner 通过 t:exec 执行服务器 shell 命令（默认 false） */
	allowShellExec?: boolean;
}

export interface ConnectionConfig {
	maxConnections?: number;
	enableMaxConnections?: boolean;
	enableConnectionRateLimit?: boolean;
	rateLimitWindow?: number;
	rateLimitMax?: number;
	perMessageDeflate?: boolean;
	maxPayload?: number;
	/** 非本机连接是否需要 WebUI 人工批准（默认在非 loopback 监听时为 true） */
	requireApproval?: boolean;
	/** 允许连接的 IP / CIDR；为空表示不限制 */
	allowedIPs?: string[];
}

export interface WsConfig {
	name: string;
	port: number;
	/** 监听地址；默认 127.0.0.1，局域网连接需设为 0.0.0.0 */
	host?: string;
	connection?: ConnectionConfig;
	checkDependenciesOnLoad?: boolean;
}

export interface AuthConfig {
	maxAttempts?: number;
	windowMs?: number;
	lockoutMs?: number;
	password?: string;
	salt?: string;
	passwordHash?: string;
}

export interface WebConfig {
	port?: number;
	auth?: AuthConfig;
	ui?: { allowedOrigins?: string[] };
}

export interface SapiConfig {
	gmsg: string;
	smsg: string;
}

export interface UtilsConfig {
	tellAllToTell?: boolean;
	enablePolling?: boolean;
}

export interface UpdateConfig {
	/** 仅在脚本启动时检查一次更新；不会自动安装 */
	autoCheck?: boolean;
	/** 检查 GitHub Pre-release（如 2.0.0-beta.1） */
	allowPrerelease?: boolean;
}


export interface AppConfig {
	ws: WsConfig;
	command?: CommandConfig;
	web?: WebConfig;
	sapi: SapiConfig;
	utils?: UtilsConfig;
	update?: UpdateConfig;
	logLevel?: string;
	commandPrefix?: string;
	language?: string;
	/** Mod 可扩展的任意字段 */
	[key: string]: unknown;
}

/** 一条 SAPI 消息 */
export interface SapiMessage {
	mod?: string;
	type?: string;
	data?: unknown;
}

/** Mod 收到的 PlayerMessage 包 */
export interface PlayerMessageBody {
	sender?: string;
	message?: string;
	type?: string;
}

/** Minecraft WebSocket 返回包（只声明使用到的字段） */
export interface CommandResponse {
	header?: {
		requestId?: string;
		messagePurpose?: string;
		eventName?: string;
	};
	body?: {
		statusCode?: number;
		statusMessage?: string;
		details?: unknown;
		players?: string;
		localplayername?: string;
		inventory?: unknown;
		sender?: string;
		message?: string;
		type?: string;
		[key: string]: unknown;
	};
}
