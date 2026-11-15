import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT_TEXTS = path.join(ROOT, "texts");

const FILE_BY_LANGUAGE: Record<string, string> = {
	"zh-CN": "zh_CN.lang",
	"zh-TW": "zh_TW.lang",
	en: "en_US.lang"
};

export type LanguageId = "zh-CN" | "zh-TW" | "en";

/** A manifest value is treated as a translation key only when it looks like one. */
export function isTranslationKey(value: unknown): value is string {
	return typeof value === "string" && /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(value.trim());
}

export function normalizeLanguage(value: unknown): LanguageId {
	const language = String(value ?? "").trim().replace(/_/g, "-").toLowerCase();
	if (language === "zh-tw" || language === "zh-hk" || language === "zh-mo") return "zh-TW";
	if (language === "zh" || language.startsWith("zh-")) return "zh-CN";
	return "en";
}

/** Parse a Minecraft-style .lang file (`key=value`, # comments). */
export function parseLangText(text: string): Map<string, string> {
	const result = new Map<string, string>();
	for (const rawLine of String(text ?? "").split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#") || line.startsWith("!")) continue;
		const separator = line.indexOf("=");
		if (separator <= 0) continue;
		const key = line.slice(0, separator).trim();
		const value = line
			.slice(separator + 1)
			.trim()
			.replace(/\\n/g, "\n")
			.replace(/\\r/g, "\r")
			.replace(/\\\\/g, "\\");
		if (key) result.set(key, value);
	}
	return result;
}

const cache = new Map<string, { mtimeMs: number; texts: Map<string, string> }>();

function readTextsFile(filePath: string): Map<string, string> {
	try {
		const stat = fs.statSync(filePath);
		const cached = cache.get(filePath);
		if (cached && cached.mtimeMs === stat.mtimeMs) return cached.texts;
		const texts = parseLangText(fs.readFileSync(filePath, "utf-8"));
		cache.set(filePath, { mtimeMs: stat.mtimeMs, texts });
		return texts;
	} catch {
		return new Map();
	}
}

function textsFor(dir: string, language: LanguageId): Map<string, string> {
	const file = FILE_BY_LANGUAGE[language] ?? FILE_BY_LANGUAGE.en;
	return readTextsFile(path.join(dir, file!));
}

export function interpolate(text: string, params?: Record<string, unknown>): string {
	if (!params) return text;
	let result = text;
	for (const [key, value] of Object.entries(params)) {
		result = result.split(`{${key}}`).join(String(value));
	}
	return result;
}

function lookup(key: string, language: LanguageId, modDir?: string): string {
	const languages: LanguageId[] = language === "en" ? ["en"] : [language, "en"];
	for (const current of languages) {
		if (modDir) {
			const value = textsFor(path.join(modDir, "texts"), current).get(key);
			if (value !== undefined) return value;
		}
		const value = textsFor(ROOT_TEXTS, current).get(key);
		if (value !== undefined) return value;
	}
	return key;
}

/** Translate a key using the Mod's texts first, then the root texts. */
export function tForMod(
	modDir: string | null | undefined,
	language: unknown,
	key: string,
	params?: Record<string, unknown>
): string {
	return interpolate(lookup(key, normalizeLanguage(language), modDir ?? undefined), params);
}

/**
 * Labels for the WebUI Mod config editor.
 * A Mod can localize config paths via keys prefixed with `config.`.
 */
export function modConfigLabels(modDir: string | null | undefined, language: unknown): Record<string, string> {
	const lang = normalizeLanguage(language);
	const labels: Record<string, string> = {};
	const languages: LanguageId[] = lang === "en" ? ["en"] : [lang, "en"];
	for (let i = 0; i < languages.length; i++) {
		const current = languages[i]!;
		const override = i === 0;
		const modTexts = modDir ? textsFor(path.join(modDir, "texts"), current) : new Map<string, string>();
		const rootTexts = textsFor(ROOT_TEXTS, current);
		for (const texts of [rootTexts, modTexts]) {
			for (const [key, value] of texts) {
				if (!key.startsWith("config.")) continue;
				if (override || labels[key] === undefined) labels[key] = value;
			}
		}
	}
	return labels;
}
