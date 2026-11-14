import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkForUpdate } from "./lib/update.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NM = path.join(__dirname, "node_modules");

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
	console.log("< 正在安装依赖...");
	try {
		execSync("npm install", { cwd: __dirname, stdio: "inherit" });
		console.log("< 依赖安装完成");
	} catch (e) {
		console.error("< 依赖安装失败:", (e as Error).message);
		process.exit(1);
	}
}

const configPath = path.join(__dirname, "config.json");
const configExamplePath = path.join(__dirname, "config.example.json");
if (!fs.existsSync(configPath) && fs.existsSync(configExamplePath)) {
	fs.copyFileSync(configExamplePath, configPath);
	console.log("< 已从 config.example.json 初始化 config.json");
}

if (fs.existsSync(configPath)) {
	const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
		language?: string;
		update?: { autoCheck?: boolean; allowPrerelease?: boolean };
	};
	if (!cfg.language) {
		const lang = (process.env.LANG ?? process.env.LC_ALL ?? "").toLowerCase();
		cfg.language = (lang.includes("hant") || /zh[_-](tw|hk|mo)/.test(lang))
			? "zh-TW"
			: lang.startsWith("zh") ? "zh-CN" : "en";
		fs.writeFileSync(configPath, `${JSON.stringify(cfg, null, "\t")}\n`, "utf-8");
		console.log("< 已写入默认语言设置:", cfg.language);
	}
	if (cfg.update?.autoCheck) {
		void checkForUpdate(cfg.update.allowPrerelease === true)
			.then((result) => {
				if (result.hasUpdate) {
					console.log(`< 发现新版本 v${result.latest}（当前 v${result.current}）`);
					console.log("< 可在 WebUI -> 设置 -> 系统 -> 更新 中处理");
				}
			})
			.catch((e) => {
				console.warn("< 更新检查失败:", (e as Error).message);
			});
	}
}

await import("./ws.js");
