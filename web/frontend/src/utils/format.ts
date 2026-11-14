/**
 * 统一的时长格式化（天/时/分/秒）。
 * @param ms 毫秒
 * @param t i18n 函数（用于取 time.* 文案）
 */
export function formatDuration(ms: number, t: (key: string) => string): string {
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	const h = Math.floor(m / 60);
	const d = Math.floor(h / 24);
	if (d > 0) return `${d}${t("time.day")} ${h % 24}${t("time.hour")}`;
	if (h > 0) return `${h}${t("time.hour")} ${m % 60}${t("time.minute")}`;
	if (m > 0) return `${m}${t("time.minute")} ${s % 60}${t("time.second")}`;
	return `${s}${t("time.second")}`;
}

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return bytes + " B";
	if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
	return (bytes / 1048576).toFixed(1) + " MB";
}
