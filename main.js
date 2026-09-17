import fs from "fs";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NM = path.join(__dirname, "node_modules");

function needInstall() {
	if (!fs.existsSync(NM)) return true;
	const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"));
	const deps = Object.keys(pkg.dependencies || {});
	return deps.some(d => !fs.existsSync(path.join(NM, d)));
}

if (needInstall()) {
	console.log("< 正在安装依赖...");
	try {
		execSync("npm install", { cwd: __dirname, stdio: "inherit" });
		console.log("< 依赖安装完成");
	} catch (e) {
		console.error("< 依赖安装失败:", e.message);
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
	const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
	if (!cfg.language) {
		const lang = (process.env.LANG || process.env.LC_ALL || "").toLowerCase();
		cfg.language = lang.startsWith("zh") ? "zh-CN" : "en";
		fs.writeFileSync(configPath, JSON.stringify(cfg, null, "\t") + "\n", "utf-8");
		console.log("< 已写入默认语言设置:", cfg.language);
	}
}

await import("./ws.js");
