import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkForUpdate } from "./lib/update.js";
import { normalizeLanguage, tForMod } from "./lib/texts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NM = path.join(__dirname, "node_modules");

// Standalone app: Mod path fields use "./" for the writable data root.
const dataRoot = process.env.MCWS_DATA_ROOT;
if (dataRoot) {
	try {
		fs.mkdirSync(dataRoot, { recursive: true });
		process.chdir(dataRoot);
		console.log(`< data root: ${dataRoot}`);
	} catch (e) {
		console.error(`< data root unavailable: ${(e as Error).message}`);
	}
}

function envLanguage() {
	const lang = (process.env.LANG ?? process.env.LC_ALL ?? "").toLowerCase();
	return normalizeLanguage(lang.includes("hant") || /zh[_-](tw|hk|mo)/.test(lang) ? "zh-TW" : lang.startsWith("zh") ? "zh-CN" : "en");
}

const bootLanguage = envLanguage();
const tr = (key: string, params?: Record<string, unknown>, language: unknown = bootLanguage): string =>
	tForMod(null, language, key, params);

interface PackageJson {
	dependencies?: Record<string, string>;
}

function needInstall(): boolean {
	if (!fs.existsSync(NM)) return true;
	const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8")) as PackageJson;
	const deps = Object.keys(pkg.dependencies ?? {});
	return deps.some((dep) => !fs.existsSync(path.join(NM, dep)));
}

if (needInstall()) {
	console.log(`< ${tr("terminal.installingDeps")}`);
	try {
		execSync("npm install", { cwd: __dirname, stdio: "inherit" });
		console.log(`< ${tr("terminal.depsInstalled")}`);
	} catch {
		console.error(`< ${tr("terminal.depsFailed")}`);
		process.exit(1);
	}
}

const configPath = path.join(__dirname, "config.json");
const configExamplePath = path.join(__dirname, "config.example.json");
if (!fs.existsSync(configPath) && fs.existsSync(configExamplePath)) {
	fs.copyFileSync(configExamplePath, configPath);
	try { fs.chmodSync(configPath, 0o600); } catch { /* ignore */ }
	console.log(`< ${tr("terminal.configCreated")}`);
}

if (fs.existsSync(configPath)) {
	let cfg: {
		language?: string;
		update?: { autoCheck?: boolean; allowPrerelease?: boolean };
	};
	try {
		const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
		cfg = parsed as typeof cfg;
	} catch {
		console.error(`< ${tr("terminal.configInvalid")}`);
		process.exit(1);
	}
	if (!cfg.language) {
		cfg.language = bootLanguage;
		fs.writeFileSync(configPath, `${JSON.stringify(cfg, null, "\t")}\n`, { encoding: "utf-8", mode: 0o600 });
		try { fs.chmodSync(configPath, 0o600); } catch { /* ignore */ }
		console.log(`< ${tr("terminal.languageDefault", { language: cfg.language })}`);
	}
	if (cfg.update?.autoCheck) {
		void checkForUpdate(cfg.update.allowPrerelease === true)
			.then((result) => {
				if (result.hasUpdate) {
					console.log(`< ${tr("terminal.updateAvailable", { latest: result.latest, current: result.current }, cfg.language)}`);
					console.log(`< ${tr("terminal.updateHint", {}, cfg.language)}`);
				}
			})
			.catch(() => {
				console.warn(`< ${tr("terminal.updateCheckFailed", {}, cfg.language)}`);
			});
	}
}

await import("./ws.js");
