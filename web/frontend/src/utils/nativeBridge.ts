type NativeBridge = { postMessage: (message: string) => void };

function bridge(): NativeBridge | undefined {
	return (window as unknown as { MCWSStandalone?: NativeBridge }).MCWSStandalone;
}

/** Notify the Flutter shell so the Android status/navigation bars match the theme. */
export function postNativeTheme(): void {
	const target = bridge();
	if (!target || typeof document === "undefined") return;
	const style = getComputedStyle(document.documentElement);
	const color = style.getPropertyValue("--bg").trim();
	const dark = document.documentElement.dataset.theme === "catppuccin-mocha";
	target.postMessage(JSON.stringify({ type: "theme", color, dark }));
}

export function requestBackgroundPermissions(): void {
	bridge()?.postMessage("requestBackgroundPermissions");
}
