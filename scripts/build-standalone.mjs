#!/usr/bin/env node
/**
 * Build a self-contained server tree for the Flutter apps.
 *
 * Usage:
 *   node scripts/build-standalone.mjs --target desktop [--node path/to/node]
 *   node scripts/build-standalone.mjs --target android
 *
 * The desktop target writes flutter/assets/server.tar.gz and optionally a
 * platform Node binary. The Android target writes build/standalone/android/
 * nodejs-project for node_flutter to copy into the APK.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "build", "standalone");
const SERVER = path.join(BUILD, "server");
const MODS_OUT = path.join(BUILD, "modsout", "mods");
const FLUTTER = path.join(ROOT, "flutter");
const ASSETS = path.join(FLUTTER, "assets");
const DEFAULT_PASSWORD = "mcwsloader";
const WEB_PORT = 50100;

function parseArgs() {
	const args = process.argv.slice(2);
	const result = { target: "desktop", node: null };
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--target") result.target = args[++i] ?? result.target;
		if (args[i] === "--node") result.node = args[++i] ?? null;
	}
	if (result.target !== "desktop" && result.target !== "android") {
		throw new Error("--target must be desktop or android");
	}
	return result;
}

function run(command, args, options = {}) {
	console.log(`> ${command} ${args.join(" ")}`);
	execFileSync(command, args, { stdio: "inherit", cwd: ROOT, ...options });
}

function copyDir(src, dest, filter = null) {
	if (!fs.existsSync(src)) return;
	fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const from = path.join(src, entry.name);
		const to = path.join(dest, entry.name);
		if (filter && !filter(from, entry)) continue;
		if (entry.isDirectory()) copyDir(from, to, filter);
		else if (entry.isFile()) {
			fs.mkdirSync(path.dirname(to), { recursive: true });
			fs.copyFileSync(from, to);
		}
	}
}

function sha256File(file) {
	return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function writeDefaultConfig() {
	const salt = crypto.randomBytes(16).toString("hex");
	const hash = crypto.scryptSync(DEFAULT_PASSWORD, salt, 64).toString("hex");
	const config = {
		ws: {
			name: "MCWSLoader",
			port: 8080,
			connection: {
				maxConnections: 100,
				enableMaxConnections: false,
				enableConnectionRateLimit: true,
				rateLimitWindow: 60000,
				rateLimitMax: 10,
				perMessageDeflate: false,
				maxPayload: 8388608,
				requireApproval: true,
				allowedIPs: []
			},
			checkDependenciesOnLoad: false,
			host: "127.0.0.1"
		},
		command: {
			maxLength: 461,
			rateLimit: { enabled: true, windowMs: 50, maxPerWindow: 1024 },
			allowShellExec: false,
			playerRateLimit: { enabled: true, windowMs: 5000, maxPerWindow: 10 }
		},
		web: {
			host: "127.0.0.1",
			port: WEB_PORT,
			auth: { maxAttempts: 5, windowMs: 60000, lockoutMs: 60000, salt, passwordHash: hash },
			ui: { theme: "star", allowedOrigins: [] }
		},
		logLevel: "info",
		commandPrefix: "$",
		sapi: { gmsg: "gmsg", smsg: "smsg" },
		utils: { tellAllToTell: false, enablePolling: true },
		language: "zh-CN",
		update: { autoCheck: false, allowPrerelease: false },
		mode: "webui",
		standalone: true
	};
	fs.writeFileSync(path.join(SERVER, "config.json"), JSON.stringify(config, null, "\t") + "\n", { encoding: "utf-8", mode: 0o600 });
	fs.writeFileSync(path.join(SERVER, "permission.json"), JSON.stringify({ owner: "", op: [], user: [], blocker: [] }, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
	fs.mkdirSync(path.join(SERVER, "mods"), { recursive: true });
	fs.writeFileSync(path.join(SERVER, "mods", "mods_config.json"), "[]\n", { encoding: "utf-8", mode: 0o600 });
}

function prepareServer() {
	fs.rmSync(BUILD, { recursive: true, force: true });
	fs.mkdirSync(SERVER, { recursive: true });

	run(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "-p", "tsconfig.standalone.json"]);
	run(process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "-p", "tsconfig.standalone.mods.json"]);

	copyDir(path.join(MODS_OUT), path.join(SERVER, "mods"));
	// Copy non-TypeScript Mod assets while skipping local secrets and build output.
	copyDir(path.join(ROOT, "mods"), path.join(SERVER, "mods"), (from, entry) => {
		if (entry.isDirectory()) return entry.name !== "node_modules" && entry.name !== "scripts";
		if (entry.name === "config.json" || entry.name === "mods_config.json") return false;
		return !entry.name.endsWith(".ts") && !entry.name.endsWith(".map");
	});
	copyDir(path.join(ROOT, "texts"), path.join(SERVER, "texts"));
	copyDir(path.join(ROOT, "web", "frontend", "dist"), path.join(SERVER, "web", "frontend", "dist"));
	for (const file of ["package.json", "package-lock.json", "config.example.json", "permission.example.json"]) {
		const src = path.join(ROOT, file);
		if (fs.existsSync(src)) fs.copyFileSync(src, path.join(SERVER, file));
	}
	fs.mkdirSync(path.join(SERVER, "logs"), { recursive: true });
	fs.mkdirSync(path.join(SERVER, "tmp"), { recursive: true });

	// Rewrite compiled Mod manifest entries from .ts to .js.
	const modsDir = path.join(SERVER, "mods");
	for (const entry of fs.readdirSync(modsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const manifestPath = path.join(modsDir, entry.name, "manifest.json");
		if (!fs.existsSync(manifestPath)) continue;
		const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
		for (const side of ["server", "client"]) {
			const value = manifest.entry?.[side];
			if (typeof value === "string" && value.endsWith(".ts")) manifest.entry[side] = value.slice(0, -3) + ".js";
		}
		fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");
	}

	writeDefaultConfig();
	const pkg = JSON.parse(fs.readFileSync(path.join(SERVER, "package.json"), "utf-8"));
	pkg.type = "module";
	fs.writeFileSync(path.join(SERVER, "package.json"), JSON.stringify(pkg, null, "\t") + "\n");

	console.log("> npm ci --omit=dev");
	run(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: SERVER });
}

function createDesktopAssets(nodePath) {
	fs.mkdirSync(ASSETS, { recursive: true });
	const tarPath = path.join(ASSETS, "server.tar.gz");
	run("tar", ["-czf", tarPath, "-C", BUILD, "server"]);
	console.log(`server asset: ${(fs.statSync(tarPath).size / 1024 / 1024).toFixed(1)} MB`);
	if (nodePath) {
		const nodeDir = path.join(ASSETS, "node");
		fs.mkdirSync(nodeDir, { recursive: true });
		const dest = path.join(nodeDir, process.platform === "win32" ? "node.exe" : "node");
		fs.copyFileSync(nodePath, dest);
		if (process.platform !== "win32") fs.chmodSync(dest, 0o755);
		console.log(`node asset: ${dest}`);
	}
	fs.writeFileSync(path.join(ASSETS, ".gitkeep"), "");
}

function createAndroidProject() {
	const project = path.join(BUILD, "android", "nodejs-project");
	fs.rmSync(path.dirname(project), { recursive: true, force: true });
	fs.rmSync(ASSETS, { recursive: true, force: true });
	copyDir(SERVER, project);
	// The Android build uses nodejs-project directly; keep declared Flutter assets present.
	fs.mkdirSync(path.join(ASSETS, "node"), { recursive: true });
	fs.writeFileSync(path.join(ASSETS, ".gitkeep"), "");
	fs.writeFileSync(path.join(ASSETS, "node", ".gitkeep"), "");
	if (!fs.existsSync(path.join(ASSETS, "server.tar.gz"))) {
		fs.writeFileSync(path.join(ASSETS, "server.tar.gz"), "");
	}
	console.log(`Android Node project: ${project}`);
}

const args = parseArgs();
prepareServer();
if (args.target === "android") createAndroidProject();
else createDesktopAssets(args.node);
console.log("Standalone server build complete.");
