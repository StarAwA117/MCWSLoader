import { reactive, computed } from "vue";
import type { ComputedRef } from "vue";
import zhCN from "../locales/zh-CN.json";
import en from "../locales/en.json";

type Messages = Record<string, any>;
type Locale = "zh-CN" | "zh-TW" | "en";

const locales: Record<string, Messages> = {
	"zh-CN": zhCN as Messages,
	"zh-TW": zhCN as Messages,
	en: en as Messages
};

function detectLocale(): Locale {
	if (typeof navigator === "undefined") return "en";
	const nav = navigator as Navigator & { userLanguage?: string };
	const lang = (nav.language || nav.userLanguage || "en").toLowerCase();
	if (["zh", "zh-cn", "zh-sg", "zh-tw", "zh-hk", "zh-my"].includes(lang)) return "zh-CN";
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
	messages: locales[getInitialLocale()] ?? (en as Messages)
});

export interface I18n {
	locale: ComputedRef<Locale>;
	messages: ComputedRef<Messages>;
	t: (key: string, params?: Record<string, unknown>) => string;
	setLocale: (locale: string) => void;
	availableLocales: Locale[];
}

export function useI18n(): I18n {
	const t = (key: string, params: Record<string, unknown> = {}): string => {
		const keys = key.split(".");
		let value: unknown = state.messages;
		for (const k of keys) {
			if (value && typeof value === "object" && k in value) {
				value = (value as Record<string, unknown>)[k];
			} else {
				value = key;
				break;
			}
		}
		if (typeof value !== "string") return key;
		let text = value;
		Object.keys(params).forEach((k) => {
			text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(params[k]));
		});
		return text;
	};

	const setLocale = (locale: string): void => {
		const messages = locales[locale];
		if (!messages) return;

		state.locale = locale as Locale;
		state.messages = messages;
		if (typeof window === "undefined") return;

		window.localStorage.setItem("locale", locale);
		const previousLanguage = document.documentElement.dataset.language;
		document.documentElement.dataset.language = locale;
		if (previousLanguage === locale) return;

		fetch("/api/language", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				// 语言切换接口需要登录态
				"X-Auth-Token": window.sessionStorage.getItem("auth_token") || ""
			},
			body: JSON.stringify({ language: locale })
		})
			.then((res) => {
				if (res.ok) document.documentElement.dataset.language = locale;
			})
			.catch(() => {
				// 离线或未登录时忽略
			});
	};

	return {
		locale: computed(() => state.locale),
		messages: computed(() => state.messages),
		t,
		setLocale,
		availableLocales: ["zh-CN", "en"]
	};
}
