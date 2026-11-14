import { computed, reactive } from "vue";

export const THEMES = ["star", "catppuccin-mocha"] as const;
export type ThemeId = (typeof THEMES)[number];

function isTheme(value: unknown): value is ThemeId {
	return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

function initialTheme(): ThemeId {
	if (typeof document === "undefined") return "star";
	const theme = document.documentElement.dataset.theme;
	return isTheme(theme) ? theme : "star";
}

const state = reactive<{ theme: ThemeId }>({ theme: initialTheme() });

export function applyTheme(theme: string): void {
	if (!isTheme(theme)) return;
	state.theme = theme;
	if (typeof document !== "undefined") {
		document.documentElement.dataset.theme = theme;
	}
}

export function useTheme() {
	return {
		theme: computed(() => state.theme),
		availableThemes: THEMES,
		setTheme: applyTheme
	};
}
