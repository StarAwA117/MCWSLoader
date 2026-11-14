import { onMounted, onUnmounted } from "vue";

export interface PollingOptions {
	/** false 时不在挂载时立即执行 */
	immediate?: boolean;
}

/**
 * 按固定间隔轮询，组件卸载时自动清理。
 * @param fn 轮询执行的函数（可为 async）
 * @param interval 间隔毫秒
 */
export function usePolling(
	fn: () => unknown | Promise<unknown>,
	interval: number,
	options: PollingOptions = {}
): { refresh: () => Promise<void> } {
	const { immediate = true } = options;
	let timer: ReturnType<typeof setInterval> | null = null;

	async function tick(): Promise<void> {
		try {
			await fn();
		} catch {
			// 忽略单次轮询错误，等待下一轮
		}
	}

	onMounted(() => {
		if (immediate) void tick();
		timer = setInterval(() => void tick(), interval);
	});

	onUnmounted(() => {
		if (timer) clearInterval(timer);
		timer = null;
	});

	return { refresh: tick };
}
