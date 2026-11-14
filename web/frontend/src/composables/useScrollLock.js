/**
 * 全局滚动锁：弹窗/抽屉打开时禁止背景滚动。
 * 统一在一个模块里维护，避免各视图重复实现导致引用计数错误。
 */
let lockCount = 0;

export function lockScroll() {
	lockCount += 1;
	document.body.classList.add("modal-open");
}

export function unlockScroll() {
	lockCount = Math.max(0, lockCount - 1);
	if (lockCount === 0) document.body.classList.remove("modal-open");
}

// 强制复位（路由切换/组件异常卸载时的兜底）
export function resetScrollLock() {
	lockCount = 0;
	document.body.classList.remove("modal-open");
}

/**
 * 组件级滚动锁：重复 lock/unlock 不会重复计数，卸载时不会误减别人的锁。
 */
export function useScrollLock() {
	let locked = false;
	return {
		lock() {
			if (locked) return;
			locked = true;
			lockScroll();
		},
		unlock() {
			if (!locked) return;
			locked = false;
			unlockScroll();
		}
	};
}
