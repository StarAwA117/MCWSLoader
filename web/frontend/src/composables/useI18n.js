import { reactive, computed } from "vue";
import zhCN from "../locales/zh-CN.json";
import en from "../locales/en.json";

const locales = {
	"zh-CN": zhCN,
	"zh-TW": zhCN,
	en
};

function detectLocale() {
	if (typeof navigator === "undefined") return "en";
	const lang = (navigator.language || navigator.userLanguage || "en").toLowerCase();
	if (lang === "zh" || lang === "zh-cn" || lang === "zh-sg" || lang === "zh-tw" || lang === "zh-hk" || lang === "zh-my") {
		return "zh-CN";
	}
	return "en";
}

function getStoredLocale() {
	if (typeof window === "undefined") return null;
	return window.localStorage.getItem("locale") || null;
}

function getInjectedLocale() {
	if (typeof window === "undefined") return null;
	return window.__LANGUAGE__ || null;
}

function getInitialLocale() {
	const stored = getStoredLocale();
	if (stored && locales[stored]) return stored;
	const injected = getInjectedLocale();
	if (injected && locales[injected]) return injected;
	return detectLocale();
}

const state = reactive({
	locale: getInitialLocale(),
	messages: locales[getInitialLocale()] || en
});

export function useI18n() {
	const t = (key, params = {}) => {
		const keys = key.split(".");
		let value = state.messages;
		for (const k of keys) {
			if (value && typeof value === "object" && k in value) {
				value = value[k];
			} else {
				value = key;
				break;
			}
		}
		if (typeof value !== "string") return key;
		let text = value;
		Object.keys(params).forEach((k) => {
			text = text.replace(new RegExp(`\\{${k}\\}`, "g"), params[k]);
		});
		return text;
	};

	const setLocale = (locale) => {
		if (locales[locale]) {
			state.locale = locale;
			state.messages = locales[locale];
			if (typeof window !== "undefined") {
				window.localStorage.setItem("locale", locale);
			}
			if (typeof window !== "undefined" && window.__LANGUAGE__ !== locale) {
				fetch("/api/language", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ language: locale })
				}).catch(() => {});
			}
		}
	};

	return {
		locale: computed(() => state.locale),
		messages: computed(() => state.messages),
		t,
		setLocale,
		availableLocales: ["zh-CN", "en"]
	};
}
