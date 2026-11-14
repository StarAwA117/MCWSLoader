import { onMounted, onUnmounted } from "vue";

/**
 * 按固定间隔轮询，组件卸载时自动清理。
 * @param {Function} fn - 轮询执行的函数（可为 async）
 * @param {number} interval - 间隔毫秒
 * @param {{ immediate?: boolean }} options - immediate=false 时不在挂载时立即执行
 */
export function usePolling(fn, interval, options = {}) {
	const { immediate = true } = options;
	let timer = null;

	async function tick() {
		try {
			await fn();
		} catch {}
	}

	onMounted(() => {
		if (immediate) tick();
		timer = setInterval(tick, interval);
	});

	onUnmounted(() => {
		if (timer) clearInterval(timer);
		timer = null;
	});

	return { refresh: tick };
}
