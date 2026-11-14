import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./mods.js";

/** 日志级别（数值越大越严重） */
const LOG_LEVELS: Record<string, number> = {
	debug: 0,
	info: 1,
	warning: 2,
	error: 3
};

/** 相对模块定位，避免从其他工作目录启动时日志落到别处（WebUI 读取同目录） */
const logDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "logs");

if (!fs.existsSync(logDir)) {
	fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
}
// 日志可能包含临时密码/聊天内容，尽量只允许当前用户读取
try { fs.chmodSync(logDir, 0o700); } catch { /* ignore */ }

/** 单个日志上限与保留的轮转文件数 */
const MAX_LOG_BYTES = Number(process.env.MCWS_LOG_MAX_BYTES) || 10 * 1024 * 1024;
const LOG_BACKUPS = 3;

interface LogSink {
	stream: fs.WriteStream;
	bytes: number;
	rotating: boolean;
	pending: string[];
}

/** 日志文件流缓存 */
const logStreams: Record<string, LogSink> = {};

function getMinLevel(): number {
	const level = config.logLevel ?? "";
	return LOG_LEVELS[level] ?? LOG_LEVELS.info ?? 1;
}

/**
 * 把 Date 格式化为本地时间（带时区偏移）。
 * 直接使用 Date getter：早期每个日志都构造 Intl.DateTimeFormat 开销很大。
 */
function formatTime(now: Date): string {
	const pad = (n: number, len = 2): string => String(n).padStart(len, "0");
	const offset = -now.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	const abs = Math.abs(offset);
	return (
		`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
		`T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
		`.${pad(now.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
	);
}

function localTime(): string {
	return formatTime(new Date());
}

function logPath(name: string): string {
	return path.join(logDir, `${name}.log`);
}

function openLogSink(name: string): LogSink {
	const file = logPath(name);
	let bytes = 0;
	try {
		if (fs.existsSync(file)) {
			fs.chmodSync(file, 0o600);
			bytes = fs.statSync(file).size;
		}
	} catch { /* ignore */ }
	const stream = fs.createWriteStream(file, { flags: "a", mode: 0o600 });
	const sink: LogSink = { stream, bytes, rotating: false, pending: [] };
	logStreams[name] = sink;
	return sink;
}

function getLogStream(name: string): LogSink {
	return logStreams[name] ?? openLogSink(name);
}

/** app.log -> app.log.1 -> app.log.2 -> app.log.3 */
function startRotation(name: string, oldSink: LogSink): void {
	if (oldSink.rotating) return;
	oldSink.rotating = true;

	// 等 end 回调（数据已 flush、fd 即将关闭）后再重命名，避免文件还没创建/仍在写
	oldSink.stream.end(() => {
		const base = logPath(name);
		try { fs.rmSync(`${base}.${LOG_BACKUPS}`, { force: true }); } catch (e) {
			console.error(`[logger] remove old log failed: ${(e as Error).message}`);
		}
		for (let index = LOG_BACKUPS - 1; index >= 1; index--) {
			const from = `${base}.${index}`;
			const to = `${base}.${index + 1}`;
			try { if (fs.existsSync(from)) fs.renameSync(from, to); } catch (e) {
				console.error(`[logger] rotate ${from} failed: ${(e as Error).message}`);
			}
		}
		try { if (fs.existsSync(base)) fs.renameSync(base, `${base}.1`); } catch (e) {
			console.error(`[logger] rotate ${base} failed: ${(e as Error).message}`);
		}

		const fresh = openLogSink(name);
		const queued = oldSink.pending;
		oldSink.pending = [];
		for (const data of queued) {
			fresh.stream.write(data);
			fresh.bytes += Buffer.byteLength(data, "utf8");
		}
		// 轮转期间积压较多时，新文件可能再次超限；触发下一轮
		if (fresh.bytes > MAX_LOG_BYTES) startRotation(name, fresh);
	});
}

function writeLog(name: string, message: string): void {
	const data = `${message}\n`;
	const sink = getLogStream(name);

	// 正在轮转：先排队，完成后由 startRotation 写入新文件
	if (sink.rotating) {
		sink.pending.push(data);
		return;
	}

	const bytes = Buffer.byteLength(data, "utf8");
	if (sink.bytes > 0 && sink.bytes + bytes > MAX_LOG_BYTES) {
		sink.pending.push(data);
		startRotation(name, sink);
		return;
	}

	sink.stream.write(data);
	sink.bytes += bytes;
}

/** 关闭所有日志文件流 */
export function closeLogStreams(): void {
	for (const name of Object.keys(logStreams)) {
		try {
			logStreams[name]?.stream.end();
		} catch {
			// ignore
		}
		delete logStreams[name];
	}
}

/** Logger utility class */
export default class Logger {
	name: string;
	print: boolean;
	file: boolean;

	constructor(name = "app", ifprint = true, ifile = true) {
		this.name = name;
		this.print = ifprint;
		this.file = ifile;
	}

	/** 核心日志方法 */
	log(message: string, type = "def"): void {
		const allowTypes = ["info", "warning", "error", "debug"];
		let logMessage: string;

		if (allowTypes.includes(type)) {
			if ((LOG_LEVELS[type] ?? 0) < getMinLevel()) return;
			logMessage = `[${localTime()}] [${type}] ${this.name} - ${message}`;
		} else {
			logMessage = message;
		}

		if (this.print) {
			const colors: Record<string, string> = {
				info: "\x1b[32m",
				warning: "\x1b[33m",
				error: "\x1b[31m",
				debug: "\x1b[35m",
				reset: "\x1b[0m"
			};
			console.log(`${colors[type] ?? ""}${logMessage}${colors.reset ?? ""}`);
		}

		if (this.file) {
			try {
				writeLog(this.name, logMessage);
			} catch (error) {
				console.log("Log Error: ", error);
			}
		}
	}

	info(message: string): void {
		this.log(message, "info");
	}

	warning(message: string): void {
		this.log(message, "warning");
	}

	error(message: string): void {
		this.log(message, "error");
	}

	debug(message: string): void {
		this.log(message, "debug");
	}
}

export const logger = new Logger();
export const messageLogger = new Logger("message");
