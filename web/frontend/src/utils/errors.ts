import { useI18n } from "../composables/useI18n";

const CJK = /[\u3400-\u9fff]/;

function normalizeMessage(error: unknown): string {
	if (error instanceof Error) return error.message || "";
	if (typeof error === "string") return error;
	if (error && typeof error === "object" && "message" in error) {
		const message = (error as { message?: unknown }).message;
		return typeof message === "string" ? message : "";
	}
	return "";
}

/** Turn a low-level error into a short message suitable for the WebUI. */
export function userErrorText(error: unknown, fallbackKey = "common.requestFailed"): string {
	const { t } = useI18n();
	const message = normalizeMessage(error).trim();
	if (!message) return t(fallbackKey);
	if (/failed to fetch|networkerror|load failed|network error/i.test(message)) return t("common.networkError");
	if (/timeout|timed out|aborted|AbortError/i.test(message)) return t("common.timeout");
	if (/HTTP\s*5\d\d|internal server error|bad gateway|service unavailable/i.test(message)) return t("common.serverError");
	if (/HTTP\s*404|not found/i.test(message)) return t("common.notFound");
	if (/HTTP\s*401|unauthorized|forbidden/i.test(message)) return t("common.unauthorized");
	if (/unexpected token|invalid json|JSON/i.test(message)) return t("common.invalidResponse");
	// The API returns friendly Chinese messages; keep those and reject raw
	// technical/English internals from leaking into the UI.
	if (CJK.test(message) && message.length <= 220) return message;
	return t(fallbackKey);
}

/** Same sanitizer for an API `message` field. */
export function userMessageText(message: unknown, fallbackKey = "common.requestFailed"): string {
	return userErrorText(message, fallbackKey);
}
