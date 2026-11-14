import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "./logger.js";
import { resolveCaseInsensitivePath } from "./paths.js";
import type { ModManifest } from "../types/mod.js";

const execFileAsync = promisify(execFile);

export interface InstallError extends Error {
	code: string;
}

export interface DependencySpec {
	kind: "npm";
	name: string;
}

export interface InstallResult {
	kind: "npm";
	name: string;
	skipped: boolean;
}

export interface InstallOptions {
	timeout?: number;
	projectRoot?: string;
}

function installError(message: string, code = "DEPENDENCY_FAILED"): InstallError {
	return Object.assign(new Error(message), { code });
}

/** 递归删除目录（不抛错） */
export function removeDir(dir: string | null | undefined): void {
	if (!dir) return;
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch (e) {
		logger.warning(`removeDir failed: ${dir}: ${(e as Error).message}`);
	}
}

/** 清理文件夹名，避免路径穿越 / 非法字符 */
export function sanitizeFolderName(name: unknown): string {
	const cleaned = String(name ?? "")
		.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
		.replace(/\.\.+/g, "_")
		.trim();
	return cleaned || "mod";
}

const MAX_ZIP_ENTRIES = 5000;
const MAX_EXTRACTED_BYTES = 256 * 1024 * 1024;

function unsafeArchive(message: string): InstallError {
	return installError(message, "INVALID_FORMAT");
}

/** 拒绝绝对路径、盘符、`..` 等会逃出解压目录的条目（zip-slip） */
export function isSafeArchiveEntry(entry: string): boolean {
	if (!entry || entry.includes("\0")) return false;
	const normalized = entry.replace(/\\/g, "/");
	if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) return false;
	return !normalized.split("/").includes("..");
}

/** 解压前检查条目名，解压后检查符号链接与解压体积（防 zip-slip / 解压炸弹） */
async function listArchiveEntries(zipPath: string): Promise<string[]> {
	const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath], { maxBuffer: 64 * 1024 * 1024 });
	return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function assertSafeEntries(entries: string[]): void {
	if (entries.length > MAX_ZIP_ENTRIES) throw unsafeArchive("Archive contains too many entries");
	for (const entry of entries) {
		if (!isSafeArchiveEntry(entry)) throw unsafeArchive(`Unsafe archive entry: ${entry}`);
	}
}

function assertExtractedTree(destDir: string): void {
	let files = 0;
	let bytes = 0;
	const walk = (dir: string): void => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			const stat = fs.lstatSync(full);
			if (stat.isSymbolicLink()) throw unsafeArchive(`Symbolic links are not allowed: ${entry.name}`);
			files++;
			if (stat.isDirectory()) walk(full);
			else {
				bytes += stat.size;
				if (bytes > MAX_EXTRACTED_BYTES) throw unsafeArchive("Archive is too large after extraction");
			}
		}
	};
	walk(destDir);
	if (files > MAX_ZIP_ENTRIES) throw unsafeArchive("Archive contains too many files");
}

/** 解压 zip/wsmod 到目标目录 */
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
	fs.mkdirSync(destDir, { recursive: true });
	// 先校验条目名，避免 zip-slip 在解压阶段写出目标目录
	assertSafeEntries(await listArchiveEntries(zipPath));
	try {
		await execFileAsync("unzip", ["-oq", zipPath, "-d", destDir], { maxBuffer: 64 * 1024 * 1024 });
		assertExtractedTree(destDir);
	} catch (e) {
		removeDir(destDir);
		throw e;
	}
}

/** 读取目录下的 manifest.json，不存在或解析失败返回 null */
export function readManifest(dir: string): ModManifest | null {
	const manifestPath = resolveCaseInsensitivePath(dir, "manifest.json");
	if (!manifestPath) return null;
	return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as ModManifest;
}

/**
 * 在解压结果中定位直接包含 manifest.json 的根目录。
 * 支持两种打包方式：manifest.json 在压缩包根目录，或包在一层文件夹内。
 */
export function resolveModRoot(
	tempDir: string
): { root: string; folderName: string | null; nested: boolean } | null {
	const isDir = (p: string): boolean => {
		try {
			return fs.statSync(p).isDirectory();
		} catch {
			return false;
		}
	};

	if (resolveCaseInsensitivePath(tempDir, "manifest.json")) {
		return { root: tempDir, folderName: null, nested: false };
	}
	const entries = fs.readdirSync(tempDir).filter((e) => e !== "__MACOSX" && !e.startsWith("."));
	const dirs = entries.filter((e) => isDir(path.join(tempDir, e)));
	const nestedDir = dirs[0];
	if (dirs.length === 1 && nestedDir && resolveCaseInsensitivePath(path.join(tempDir, nestedDir), "manifest.json")) {
		return { root: path.join(tempDir, nestedDir), folderName: nestedDir, nested: true };
	}
	return null;
}

/** 将 srcDir 合并拷贝到 destDir：覆盖同名文件，但保留 src 中不存在的旧文件 */
export function copyMerge(srcDir: string, destDir: string): void {
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

function makeTempDir(baseDir: string, prefix: string): string {
	fs.mkdirSync(baseDir, { recursive: true });
	return fs.mkdtempSync(path.join(baseDir, prefix));
}

/** 返回 baseDir 下一个尚不存在的唯一路径（不创建它） */
export function makeTempPath(baseDir: string, prefix: string): string {
	fs.mkdirSync(baseDir, { recursive: true });
	let p: string;
	do {
		p = path.join(baseDir, `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
	} while (fs.existsSync(p));
	return p;
}

/** 移动目录；跨设备时退化为拷贝 + 删除 */
export function moveDir(src: string, dest: string): void {
	try {
		fs.renameSync(src, dest);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === "EXDEV") {
			copyMerge(src, dest);
			removeDir(src);
		} else {
			throw e;
		}
	}
}

/**
 * 解析一条依赖声明。dependencies 只接受 npm 包名：
 *   "pkg-name" / "@scope/pkg" -> npm 包
 * 其他任何形式（如 { name, url }）都视为非法，调用方应报 DEPENDENCY_FAILED
 */
export function parseDependency(dep: unknown): DependencySpec | null {
	if (typeof dep !== "string") return null;
	const name = dep.trim();
	return name ? { kind: "npm", name } : null;
}

/** npm 包是否已安装（支持 @scope/pkg） */
export function isNpmInstalled(name: string, projectRoot: string): boolean {
	return fs.existsSync(path.join(projectRoot, "node_modules", ...name.split("/")));
}

/** npm 包名校验（先拦下明显非法的名字，避免白白等一次 npm 网络请求） */
export function isValidNpmName(name: unknown): boolean {
	const n = String(name ?? "").trim();
	if (!n || /\s/.test(n)) return false;
	const parts = n.startsWith("@") ? n.slice(1).split("/") : [n];
	if (n.startsWith("@") ? parts.length !== 2 : parts.length !== 1) return false;
	return parts.every((p) => /^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(p));
}

/**
 * 安装 npm 包。使用 --no-save：依赖的“真实来源”是各模组的 manifest.json，
 * 而不是项目的 package.json。
 */
export async function installNpmDependency(
	name: string,
	projectRoot: string,
	opts: InstallOptions = {}
): Promise<InstallResult> {
	if (!isValidNpmName(name)) {
		throw installError(`Invalid npm package name: ${JSON.stringify(name)}`);
	}
	if (isNpmInstalled(name, projectRoot)) return { kind: "npm", name, skipped: true };
	try {
		await execFileAsync("npm", ["install", name, "--no-save", "--no-package-lock", "--ignore-scripts", "--no-audit", "--no-fund"], {
			cwd: projectRoot,
			maxBuffer: 16 * 1024 * 1024,
			timeout: opts.timeout ?? 300000
		});
	} catch (e) {
		throw installError(`npm install ${name} failed: ${(e as Error).message}`);
	}
	if (!isNpmInstalled(name, projectRoot)) {
		throw installError(`npm install ${name} finished but node_modules/${name} is missing`);
	}
	return { kind: "npm", name, skipped: false };
}

/** 安装单条依赖（只支持 npm 包名；其他写法一律非法） */
export async function installDependency(
	dep: unknown,
	projectRoot: string,
	opts: InstallOptions = {}
): Promise<InstallResult> {
	const parsed = parseDependency(dep);
	if (!parsed) {
		throw installError(`Invalid dependency entry (npm package name expected): ${JSON.stringify(dep)}`);
	}
	return installNpmDependency(parsed.name, opts.projectRoot ?? projectRoot, opts);
}

/** 依次安装 manifest.dependencies（不递归处理依赖的依赖） */
export async function installDependencies(
	manifest: ModManifest | null | undefined,
	projectRoot: string,
	opts: InstallOptions = {}
): Promise<InstallResult[]> {
	const deps = Array.isArray(manifest?.dependencies) ? manifest.dependencies : [];
	const installed: InstallResult[] = [];
	for (const dep of deps) {
		installed.push(await installDependency(dep, projectRoot, opts));
	}
	return installed;
}

export { makeTempDir };
