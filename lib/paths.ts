import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 大小写不敏感地拼接路径并返回实际存在的路径。
 * 用于兼容 Windows / Android 等文件系统差异（manifest.json 可能被写成 Manifest.json）。
 * @param baseDir 基准目录
 * @param relativePath 相对路径（允许使用反斜杠）
 * @returns 实际路径；找不到时返回 null
 */
export function resolveCaseInsensitivePath(
	baseDir: string,
	relativePath: string | null | undefined
): string | null {
	if (!baseDir || !relativePath) return null;

	const normalized = relativePath.replace(/\\/g, "/");
	const direct = path.resolve(baseDir, normalized);
	if (fs.existsSync(direct)) return direct;

	try {
		let current = baseDir;
		for (const segment of normalized.split("/").filter(Boolean)) {
			if (!fs.existsSync(current)) return null;
			const lower = segment.toLowerCase();
			const matched = fs.readdirSync(current).find((entry) => entry.toLowerCase() === lower);
			if (!matched) return null;
			current = path.join(current, matched);
		}
		return current;
	} catch {
		return null;
	}
}

/**
 * 把文件路径转换为 ESM dynamic import 可用的 file:// URL。
 * 同时处理 Windows 反斜杠与缓存刷新参数。
 */
export function resolveModuleUrl(filePath: string, timestamp?: number | string): string {
	let urlStr: string;

	if (
		filePath.startsWith("file://") ||
		filePath.startsWith("file:/") ||
		filePath.startsWith("data:") ||
		filePath.startsWith("node:")
	) {
		urlStr =
			filePath.startsWith("file:/") && !filePath.startsWith("file://")
				? `file://${filePath.slice(5)}`
				: filePath;
	} else {
		const normalized = process.platform === "win32" ? filePath : filePath.replace(/\\/g, "/");
		const absPath = path.isAbsolute(normalized) ? normalized : path.resolve(normalized);
		urlStr = pathToFileURL(absPath).href;
	}

	if (timestamp) {
		const parsed = new URL(urlStr);
		parsed.searchParams.set("t", String(timestamp));
		return parsed.href;
	}
	return urlStr;
}
