/**
 * User-facing error mapping.
 *
 * Internal errors often contain file paths, HTTP internals or stack-ish text.
 * Keep those in logs and show a short, actionable message instead.
 */

const DEFAULT_FALLBACK = "操作失败，请稍后重试";

const ERROR_MESSAGES: Array<[RegExp, string]> = [
	[/failed to write config|save config failed/i, "保存配置失败，请检查文件权限或磁盘空间"],
	[/mod not found|mod has no config|no config file/i, "未找到该模组或配置文件"],
	[/invalid request format|invalid content type/i, "请求格式不正确"],
	[/unsupported language/i, "不支持该语言"],
	[/invalid username or password/i, "用户名或密码错误"],
	[/unauthorized/i, "登录状态已失效，请重新登录"],
	[/client is pending approval/i, "客户端尚未批准，请先在客户端页面批准"],
	[/file too large/i, "文件大小超出限制"],
	[/no file uploaded/i, "没有选择文件"],
	[/unsupported file type/i, "不支持的文件类型"],
	[/missing manifest|invalid manifest/i, "manifest.json 缺失或格式不正确"],
	[/server mod manager not initialized/i, "服务端模组管理器尚未初始化"],
	[/please specify rollback/i, "请选择要回退的版本"],
	[/dependency install failed|install failed/i, "依赖安装失败，请检查网络或包名"],
	[/update failed|rollback failed/i, "更新失败，请稍后重试"],
	[/cannot get latest version/i, "无法获取最新版本信息"],
	[/too many commands|rate limit/i, "操作过于频繁，请稍后再试"],
	[/\bEACCES\b|\bEPERM\b/i, "没有访问该文件或目录的权限"],
	[/command permission error|permission denied/i, "没有执行该命令的权限"],
	[/unknown command/i, "未知命令"],
	[/unknown command/i, "未知命令"],
	[/request body too large/i, "请求内容过大，请减少数据量后重试"],
	[/unsafe archive|zip-slip|path traversal|outside the target/i, "模组压缩包包含不安全的文件路径"],
	[/symbolic links? are not allowed/i, "模组压缩包不能包含符号链接"],
	[/invalid npm package name|invalid dependency entry/i, "模组依赖的 npm 包名不合法"],
	[/too many files/i, "模组压缩包文件数量过多"],
	[/archive is too large|uncompressed size/i, "模组压缩包解压后体积过大"],
	[/internal server error/i, "服务暂时不可用，请稍后重试"],
	[/\bENOENT\b|no such file|not found/i, "文件或目录不存在"],
	[/\bENOSPC\b|no space left/i, "磁盘空间不足"],
	[/\bEADDRINUSE\b|address already in use/i, "端口已被占用，请关闭占用该端口的程序"],
	[/\bECONNREFUSED\b|\bENOTFOUND\b|\bEAI_AGAIN\b|fetch failed|network error/i, "网络连接失败，请检查网络或服务地址"],
	[/\bETIMEDOUT\b|timed? out|AbortError|aborted/i, "操作超时，请稍后重试"],
	[/HTTP\s*401|HTTP\s*403|unauthorized|forbidden/i, "认证失败或没有操作权限"],
	[/HTTP\s*404/i, "请求的资源不存在"],
	[/HTTP\s*429|too many requests|rate limit/i, "操作过于频繁，请稍后再试"],
	[/HTTP\s*5\d\d|internal server error|bad gateway|service unavailable/i, "服务暂时不可用，请稍后重试"],
	[/JSON|unexpected token|syntaxerror/i, "数据格式不正确"],
	[/invalid version tag/i, "版本号格式不正确"],
	[/command cannot be empty/i, "命令不能为空"],
	[/main client not connected/i, "主客户端未连接，请先在游戏内连接并等待批准"],
	[/client not found/i, "客户端不存在或已经断开"],
	[/message is required/i, "消息内容不能为空"],
	[/new password is required/i, "请输入新密码"],
	[/incorrect old password/i, "当前密码不正确"],
	[/password update failed/i, "密码更新失败，请稍后重试"],
	[/manifest file not found/i, "没有找到 manifest.json"],
	[/no readme file/i, "该模组没有 README 文件"],
	[/not an object/i, "请求数据格式不正确"],
	[/cannot read propert|is not a function|undefined is not|null is not/i, "程序内部处理失败，请稍后重试"]
];

function rawMessage(error: unknown): string {
	if (error instanceof Error) return error.message || "";
	if (typeof error === "string") return error;
	if (error && typeof error === "object" && "message" in error) {
		const message = (error as { message?: unknown }).message;
		return typeof message === "string" ? message : "";
	}
	return "";
}

export function errorDetail(error: unknown): string {
	if (error instanceof Error) return error.stack || error.message;
	return rawMessage(error) || String(error ?? "unknown error");
}

/**
 * Convert any thrown value into a message that can be shown to a player/WebUI.
 * Chinese domain messages are preserved; unknown technical text falls back.
 */
export function toUserError(error: unknown, fallback = DEFAULT_FALLBACK): string {
	if (error && typeof error === "object") {
		const userMessage = (error as { userMessage?: unknown }).userMessage;
		if (typeof userMessage === "string" && userMessage.trim()) return userMessage.trim();
	}

	const message = rawMessage(error).trim();
	if (!message) return fallback;

	for (const [pattern, friendly] of ERROR_MESSAGES) {
		if (pattern.test(message)) return friendly;
	}

	// Domain errors in this project are written in Chinese and are already intended
	// for users. Keep those, but never expose long stack-like strings.
	if (/[\u3400-\u9fff]/.test(message) && message.length <= 180 && !/\n\s*at\s/.test(message)) {
		return message;
	}

	return fallback;
}
