import fs from "fs";
import path from "path";
import { config } from "./mods.js";

/**
 * Log output directory
 * @type {string}
 */
const logDir = "./logs";

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
 * Get local time string (system local timezone)
 * @returns {string} ISO-like local timestamp with offset
 */
function localTime() {
	const now = new Date();
	const parts = new Intl.DateTimeFormat('sv-SE', {
		year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', second: '2-digit',
		hour12: false
	}).formatToParts(now).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
	const offset = -now.getTimezoneOffset();
	const offsetHours = Math.floor(Math.abs(offset) / 60);
	const offsetMinutes = Math.abs(offset) % 60;
	const offsetSign = offset >= 0 ? '+' : '-';
	const offsetStr = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;
	const ms = String(now.getMilliseconds()).padStart(3, '0');
	return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${ms}${offsetStr}`;
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
