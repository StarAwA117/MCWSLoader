/**
 * Theme registry.
 *
 * Add a theme by registering it here and adding its palette block to
 * assets/main.css (`:root[data-theme="<id>"]`). No other component needs
 * to know about theme-specific colors.
 */
import { postNativeTheme } from "./utils/nativeBridge";

export class Theme {
	constructor(
		public readonly id: string,
		public readonly labelKey: string,
		public readonly swatch: string
	) {}

	apply(): void {
		if (typeof document !== "undefined") {
			document.documentElement.dataset.theme = this.id;
			postNativeTheme();
		}
	}
}

export const THEME_DEFINITIONS: readonly Theme[] = [
	new Theme(
		"star",
		"settings.themeStar",
		"linear-gradient(135deg, #f0f7ff 0 50%, #60a5fa 50%)"
	),
	new Theme(
		"catppuccin-mocha",
		"settings.themeMocha",
		"linear-gradient(135deg, #1e1e2e 0 30%, #89b4fa 30% 50%, #a6e3a1 50% 65%, #f9e2af 65% 80%, #cba6f7 80%)"
	)
];

export const DEFAULT_THEME = THEME_DEFINITIONS[0]!;

export function findTheme(id: string): Theme | null {
	return THEME_DEFINITIONS.find((theme) => theme.id === id) ?? null;
}

export function isThemeId(id: unknown): id is string {
	return typeof id === "string" && findTheme(id) !== null;
}
