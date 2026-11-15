import { reactive, computed } from "vue";
import type { ComputedRef } from "vue";
import zhCNSource from "../../../../texts/zh_CN.lang?raw";
import zhTWSource from "../../../../texts/zh_TW.lang?raw";
import enSource from "../../../../texts/en_US.lang?raw";
import { parseLang } from "../utils/lang";

type Messages = Record<string, string>;
type Locale = "zh-CN" | "zh-TW" | "en";

const locales: Record<string, Messages> = {
	"zh-CN": parseLang(zhCNSource),
	"zh-TW": parseLang(zhTWSource),
	en: parseLang(enSource)
};

function detectLocale(): Locale {
	if (typeof navigator === "undefined") return "en";
	const nav = navigator as Navigator & { userLanguage?: string };
	const lang = (nav.language || nav.userLanguage || "en").toLowerCase();
	if (lang.includes("hant") || /^zh-(tw|hk|mo)\b/.test(lang)) return "zh-TW";
	if (lang === "zh" || lang.startsWith("zh-")) return "zh-CN";
	return "en";
}

function getStoredLocale(): string | null {
	if (typeof window === "undefined") return null;
	return window.localStorage.getItem("locale");
}

function getInjectedLocale(): string | null {
	if (typeof document === "undefined") return null;
	return document.documentElement.dataset.language ?? null;
}

function getInitialLocale(): Locale {
	const stored = getStoredLocale();
	if (stored && locales[stored]) return stored as Locale;
	const injected = getInjectedLocale();
	if (injected && locales[injected]) return injected as Locale;
	return detectLocale();
}

const state = reactive<{ locale: Locale; messages: Messages }>({
	locale: getInitialLocale(),
	messages: locales[getInitialLocale()] ?? locales.en!
});

export interface I18n {
	locale: ComputedRef<Locale>;
	messages: ComputedRef<Messages>;
	t: (key: string, params?: Record<string, unknown>) => string;
	setLocale: (locale: string) => void;
	applyLocale: (locale: string) => void;
	availableLocales: Locale[];
}

export function useI18n(): I18n {
	const t = (key: string, params: Record<string, unknown> = {}): string => {
		let text = state.messages[key];
		if (text === undefined) {
			// Backward-compatible lookup for any nested keys still passed by mods.
			const keys = key.split(".");
			let value: unknown = state.messages;
			for (const k of keys) {
				if (value && typeof value === "object" && k in value) value = (value as Record<string, unknown>)[k];
				else { value = undefined; break; }
			}
			if (typeof value === "string") text = value;
		}
		if (text === undefined) return key;
		Object.keys(params).forEach((k) => {
			text = text!.split(`{${k}}`).join(String(params[k]));
		});
		return text;
	};

	const applyLocale = (locale: string): void => {
		const messages = locales[locale];
		if (!messages) return;

		state.locale = locale as Locale;
		state.messages = messages;
		if (typeof window === "undefined") return;

		window.localStorage.setItem("locale", locale);
		document.documentElement.dataset.language = locale;
	};

	const setLocale = (locale: string): void => {
		if (!locales[locale]) return;
		const previousLanguage = typeof document !== "undefined" ? document.documentElement.dataset.language : null;
		applyLocale(locale);
		if (typeof window === "undefined" || previousLanguage === locale) return;

		fetch("/api/language", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Auth-Token": window.sessionStorage.getItem("auth_token") || ""
			},
			body: JSON.stringify({ language: locale })
		})
			.then((res) => {
				if (res.ok) document.documentElement.dataset.language = locale;
			})
			.catch(() => {});
	};

	return {
		locale: computed(() => state.locale),
		messages: computed(() => state.messages),
		t,
		setLocale,
		applyLocale,
		availableLocales: ["zh-CN", "zh-TW", "en"]
	};
}
