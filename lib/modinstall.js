import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

// 递归删除目录（不抛错）
export function removeDir(dir) {
	if (!dir) return;
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch (e) {
		logger.warning(`removeDir failed: ${dir}: ${e.message}`);
	}
}

// 清理文件夹名，避免路径穿越 / 非法字符
export function sanitizeFolderName(name) {
	const cleaned = String(name ?? "")
		.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
		.replace(/\.\.+/g, "_")
		.trim();
	return cleaned || "mod";
}

// 解压 zip/wsmod 到目标目录
export async function extractZip(zipPath, destDir) {
	fs.mkdirSync(destDir, { recursive: true });
	await execFileAsync("unzip", ["-oq", zipPath, "-d", destDir], { maxBuffer: 64 * 1024 * 1024 });
}

// 读取目录下的 manifest.json，不存在返回 null
export function readManifest(dir) {
	const manifestPath = path.join(dir, "manifest.json");
	if (!fs.existsSync(manifestPath)) return null;
	return JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
}

// 在解压结果中定位直接包含 manifest.json 的根目录
// 支持两种打包方式：manifest.json 在压缩包根目录，或包在一层文件夹内
export function resolveModRoot(tempDir) {
	const isDir = (p) => {
		try { return fs.statSync(p).isDirectory(); } catch { return false; }
	};
	if (fs.existsSync(path.join(tempDir, "manifest.json"))) {
		return { root: tempDir, folderName: null, nested: false };
	}
	const entries = fs.readdirSync(tempDir).filter((e) => e !== "__MACOSX" && !e.startsWith("."));
	const dirs = entries.filter((e) => isDir(path.join(tempDir, e)));
	if (dirs.length === 1 && fs.existsSync(path.join(tempDir, dirs[0], "manifest.json"))) {
		return { root: path.join(tempDir, dirs[0]), folderName: dirs[0], nested: true };
	}
	return null;
}

// 将 srcDir 合并拷贝到 destDir：覆盖同名文件，但保留 src 中不存在的旧文件
export function copyMerge(srcDir, destDir) {
	fs.mkdirSync(destDir, { recursive: true });
	for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
		const src = path.join(srcDir, entry.name);
		const dest = path.join(destDir, entry.name);
		if (entry.isDirectory()) {
			copyMerge(src, dest);
		} else if (entry.isFile()) {
			fs.copyFileSync(src, dest);
		}
	}
}

function makeTempDir(baseDir, prefix) {
	fs.mkdirSync(baseDir, { recursive: true });
	return fs.mkdtempSync(path.join(baseDir, prefix));
}

// 返回 baseDir 下一个尚不存在的唯一路径（不创建它）
export function makeTempPath(baseDir, prefix) {
	fs.mkdirSync(baseDir, { recursive: true });
	let p;
	do {
		p = path.join(baseDir, `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
	} while (fs.existsSync(p));
	return p;
}

// 移动目录；跨设备时退化为拷贝 + 删除
export function moveDir(src, dest) {
	try {
		fs.renameSync(src, dest);
	} catch (e) {
		if (e.code === "EXDEV") {
			copyMerge(src, dest);
			removeDir(src);
		} else {
			throw e;
		}
	}
}

// 解析一条依赖声明。dependencies 只接受 npm 包名：
//   "pkg-name" / "@scope/pkg" -> npm 包
// 其他任何形式（如 { name, url }）都视为非法，调用方应报 DEPENDENCY_FAILED
export function parseDependency(dep) {
	if (typeof dep !== "string") return null;
	const name = dep.trim();
	return name ? { kind: "npm", name } : null;
}

// npm 包是否已安装（支持 @scope/pkg）
export function isNpmInstalled(name, projectRoot) {
	return fs.existsSync(path.join(projectRoot, "node_modules", ...String(name).split("/")));
}

// npm 包名校验（先拦下明显非法的名字，避免白白等一次 npm 网络请求）
export function isValidNpmName(name) {
	const n = String(name || "").trim();
	if (!n || /\s/.test(n)) return false;
	const parts = n.startsWith("@") ? n.slice(1).split("/") : [n];
	if (n.startsWith("@") ? parts.length !== 2 : parts.length !== 1) return false;
	return parts.every((p) => /^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(p));
}

// 安装 npm 包。使用 --no-save：依赖的“真实来源”是各模组的 manifest.json，
// 而不是项目的 package.json。
export async function installNpmDependency(name, projectRoot, opts = {}) {
	if (!isValidNpmName(name)) {
		const err = new Error(`Invalid npm package name: ${JSON.stringify(name)}`);
		err.code = "DEPENDENCY_FAILED";
		throw err;
	}
	if (isNpmInstalled(name, projectRoot)) return { kind: "npm", name, skipped: true };
	try {
		await execFileAsync("npm", ["install", name, "--no-save", "--no-audit", "--no-fund"], {
			cwd: projectRoot,
			maxBuffer: 16 * 1024 * 1024,
			timeout: opts.timeout || 300000,
		});
	} catch (e) {
		const err = new Error(`npm install ${name} failed: ${e.message}`);
		err.code = "DEPENDENCY_FAILED";
		throw err;
	}
	if (!isNpmInstalled(name, projectRoot)) {
		const err = new Error(`npm install ${name} finished but node_modules/${name} is missing`);
		err.code = "DEPENDENCY_FAILED";
		throw err;
	}
	return { kind: "npm", name, skipped: false };
}

// 安装单条依赖（只支持 npm 包名；其他写法一律非法）
export async function installDependency(dep, projectRoot, opts = {}) {
	const parsed = parseDependency(dep);
	if (!parsed) {
		const err = new Error(`Invalid dependency entry (npm package name expected): ${JSON.stringify(dep)}`);
		err.code = "DEPENDENCY_FAILED";
		throw err;
	}
	return await installNpmDependency(parsed.name, opts.projectRoot || projectRoot, opts);
}

// 依次安装 manifest.dependencies（不递归处理依赖的依赖）
export async function installDependencies(manifest, projectRoot, opts = {}) {
	const deps = Array.isArray(manifest?.dependencies) ? manifest.dependencies : [];
	const installed = [];
	for (const dep of deps) {
		installed.push(await installDependency(dep, projectRoot, opts));
	}
	return installed;
}

export { makeTempDir };
