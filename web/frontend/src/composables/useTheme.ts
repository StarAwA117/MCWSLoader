import { computed, reactive } from "vue";
import { DEFAULT_THEME, THEME_DEFINITIONS, findTheme, isThemeId, type Theme } from "../theme";

function initialTheme(): string {
	if (typeof document === "undefined") return DEFAULT_THEME.id;
	const id = document.documentElement.dataset.theme;
	return isThemeId(id) ? id : DEFAULT_THEME.id;
}

const state = reactive<{ theme: string }>({ theme: initialTheme() });

export function applyTheme(themeId: string): void {
	const theme = findTheme(themeId);
	if (!theme) return;
	state.theme = theme.id;
	theme.apply();
}

export function useTheme() {
	return {
		theme: computed(() => state.theme),
		availableThemes: THEME_DEFINITIONS,
		setTheme: applyTheme
	};
}

export type { Theme };
