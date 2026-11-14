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
	fs.mkdirSync(logDir, { recursive: true });
}

/** 日志文件流缓存 */
const logStreams: Record<string, fs.WriteStream> = {};

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

function getLogStream(name: string): fs.WriteStream {
	let stream = logStreams[name];
	if (!stream) {
		stream = fs.createWriteStream(path.join(logDir, `${name}.log`), { flags: "a" });
		logStreams[name] = stream;
	}
	return stream;
}

/** 关闭所有日志文件流 */
export function closeLogStreams(): void {
	for (const name of Object.keys(logStreams)) {
		try {
			logStreams[name]?.end();
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
				getLogStream(this.name).write(`${logMessage}\n`);
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
