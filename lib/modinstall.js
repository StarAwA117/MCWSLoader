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

export async function downloadToFile(url, destPath) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	fs.mkdirSync(path.dirname(destPath), { recursive: true });
	fs.writeFileSync(destPath, buf);
	return buf.length;
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

// 安装单个依赖（依赖本身也是一个模组压缩包）。
// 已存在则跳过；缺少 url 或安装失败时抛出带 code 的错误。
export async function installDependency(dep, modDir, opts = {}) {
	const depName = typeof dep === "string" ? dep : dep?.name;
	const depUrl = dep && typeof dep === "object" ? dep.url : null;
	if (!depName) {
		const err = new Error("Invalid dependency entry (name is required)");
		err.code = "DEPENDENCY_FAILED";
		throw err;
	}
	const folder = sanitizeFolderName(depName);
	const depDir = path.join(modDir, folder);
	if (fs.existsSync(path.join(depDir, "manifest.json"))) {
		return { name: folder, skipped: true };
	}
	if (!depUrl) {
		const err = new Error(`Dependency "${depName}" is missing and has no download url`);
		err.code = "DEPENDENCY_MISSING";
		throw err;
	}
	const tmpBase = opts.tmpBase || path.join(modDir, "..", "tmp");
	const tmp = makeTempDir(tmpBase, "dep_");
	try {
		const zipPath = path.join(tmp, "dep.zip");
		await downloadToFile(depUrl, zipPath);
		const extractDir = path.join(tmp, "extract");
		await extractZip(zipPath, extractDir);
		const resolved = resolveModRoot(extractDir);
		if (!resolved) {
			const err = new Error(`Dependency "${depName}" archive has no manifest.json`);
			err.code = "DEPENDENCY_FAILED";
			throw err;
		}
		const manifest = readManifest(resolved.root);
		if (!manifest || !manifest.name) {
			const err = new Error(`Dependency "${depName}" has an invalid manifest.json`);
			err.code = "DEPENDENCY_FAILED";
			throw err;
		}
		removeDir(depDir);
		copyMerge(resolved.root, depDir);
		return { name: folder, skipped: false };
	} finally {
		removeDir(tmp);
	}
}

// 依次安装 manifest.dependencies（不递归处理依赖的依赖）
export async function installDependencies(manifest, modDir, opts = {}) {
	const deps = Array.isArray(manifest?.dependencies) ? manifest.dependencies : [];
	const installed = [];
	for (const dep of deps) {
		installed.push(await installDependency(dep, modDir, opts));
	}
	return installed;
}

export { makeTempDir };
