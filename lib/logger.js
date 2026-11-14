import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./mods.js";

/**
 * Log output directory
 * @type {string}
 */
// 相对模块定位，避免从其他工作目录启动时日志落到别处（WebUI 读取同目录）
const logDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "logs");

/**
 * Log level numeric mapping (higher = more severe)
 * @type {Object<string, number>}
 */
const LOG_LEVELS = {
	debug: 0,
	info: 1,
	warning: 2,
	error: 3
};

/**
 * Minimum log level from config
 * @returns {number}
 */
function getMinLevel() {
	return LOG_LEVELS[config?.logLevel] ?? LOG_LEVELS.info;
}

/**
 * Format a Date as local ISO-like timestamp with offset.
 * Uses Date getters directly: constructing Intl.DateTimeFormat per log call
 * dominated the cost of debug-level logging.
 * @param {Date} now
 * @returns {string} e.g. 2024-05-01T12:34:56.789+08:00
 */
function formatTime(now) {
	const pad = (n, len = 2) => String(n).padStart(len, "0");
	const offset = -now.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	const abs = Math.abs(offset);
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
		`T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}` +
		`.${pad(now.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function localTime() {
	return formatTime(new Date());
}

if (!fs.existsSync(logDir)) {
	fs.mkdirSync(logDir, {
		recursive: true
	});
}

/**
 * Log file stream cache
 * @type {Object<string, fs.WriteStream>}
 */
const logStreams = {};

/**
 * Get or create log file stream
 * @param {string} name - Log name
 * @returns {fs.WriteStream} Log file write stream
 */
function getLogStream(name) {
	if (!logStreams[name]) {
		const logPath = path.join(logDir, `${name}.log`);
		logStreams[name] = fs.createWriteStream(logPath, { flags: 'a' });
	}
	return logStreams[name];
}

/**
 * Close all log file streams
 */
export function closeLogStreams() {
	for (const name of Object.keys(logStreams)) {
		try {
			logStreams[name].end();
		} catch {}
		delete logStreams[name];
	}
}

/**
 * Logger utility class
 */
export default class Logger {
	/**
	 * @param {string} name - Logger name
	 * @param {boolean} ifprint - Print to console
	 * @param {boolean} ifile - Write to file
	 */
	constructor(name = "app", ifprint = true, ifile = true) {
		this.name = name;
		this.print = ifprint;
		this.file = ifile;
	}

	/**
	 * Core log method
	 * @param {string} message - Log message
	 * @param {string} type - Log type
	 */
	log(message, type = "def") {
		const allowTypes = ["info", "warning", "error", "debug"];
		let logMessage;

		if (allowTypes.includes(type)) {
			if ((LOG_LEVELS[type] ?? 0) < getMinLevel()) return;
			logMessage = `[${localTime()}] [${type}] ${this.name} - ${message}`;
		} else {
			logMessage = `${message}`;
		}

		if (this.print) {
			const colors = {
				info: "\x1b[32m",
				warning: "\x1b[33m",
				error: "\x1b[31m",
				debug: "\x1b[35m",
				reset: "\x1b[0m"
			}

			console.log(`${colors[type] || ""}${logMessage}${colors.reset}`);
		}

		if (this.file) {
			try {
				const stream = getLogStream(this.name);
				stream.write(logMessage + "\n");
			} catch (error) {
				console.log("Log Error: ", error);
			}
		}
	}

	info(message) { this.log(message, "info"); }
	warning(message) { this.log(message, "warning"); }
	error(message) { this.log(message, "error"); }
	debug(message) { this.log(message, "debug"); }
}

export const logger = new Logger();
export const messageLogger = new Logger("message");
