import { useI18n } from "./composables/useI18n";
import { userErrorText } from "./utils/errors";

const BASE = "/api";

/** 后端响应（成功/失败字段因接口而异，边界处保持宽松） */
export type ApiResult = {
	ok?: boolean;
	message?: string;
	code?: string;
	[key: string]: any;
};

export type RequestOptions = RequestInit & { raw?: boolean };

function getToken(): string {
	return sessionStorage.getItem("auth_token") || "";
}

function timeoutSignal(ms: number): AbortSignal | undefined {
	return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
		? AbortSignal.timeout(ms)
		: undefined;
}

/**
 * 解析响应体：空响应体 / 非 JSON（网关错误页）不应让调用方抛异常。
 */
async function parseResponse(res: Response): Promise<ApiResult> {
	const text = await res.text().catch(() => "");
	if (!text) return { ok: false, code: "HTTP_ERROR", message: userErrorText(`HTTP ${res.status}`) };
	try {
		const data = JSON.parse(text) as unknown;
		if (!data || typeof data !== "object") {
			return { ok: false, code: "INVALID_RESPONSE", message: userErrorText(`HTTP ${res.status}`) };
		}
		const result = data as ApiResult;
		if (!res.ok && !result.message) result.message = userErrorText(`HTTP ${res.status}`);
		return result;
	} catch {
		return { ok: false, code: "INVALID_RESPONSE", message: userErrorText(`HTTP ${res.status}`) };
	}
}

/**
 * 带鉴权的请求。401 会清理 token 并跳回登录页。
 * @param options raw=true 时不设置 JSON Content-Type（FormData）
 */
async function request(path: string, options: RequestOptions = {}): Promise<ApiResult> {
	const { raw = false, headers, ...rest } = options;
	// Mod installs and update checkout can legitimately run much longer than a normal API call.
	const longRunning = raw || path.startsWith("/mods/") || path.startsWith("/update/");
	let res: Response;
	try {
		res = await fetch(`${BASE}${path}`, {
			headers: {
				"X-Auth-Token": getToken(),
				...(raw ? {} : { "Content-Type": "application/json" }),
				...headers
			},
			...rest,
			// Ordinary API calls should not hang forever; long-running routes opt out.
			signal: rest.signal ?? (longRunning ? undefined : timeoutSignal(30000))
		});
	} catch (e) {
		return { ok: false, code: "NETWORK", message: userErrorText(e, "common.networkError") };
	}
	if (res.status === 401) {
		sessionStorage.removeItem("auth_token");
		if (window.location.pathname !== "/login") {
			window.location.href = "/login";
		}
		return { ok: false, message: useI18n().t("common.unauthorized") };
	}
	return parseResponse(res);
}

// 登录接口不需要 token，且 401 响应体里带有锁定/剩余次数信息，不能走 request()
export async function loginWithPassword(pwd: string): Promise<ApiResult> {
	try {
		const res = await fetch(`${BASE}/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password: pwd }),
			signal: timeoutSignal(15000)
		});
		return parseResponse(res);
	} catch (e) {
		return { ok: false, code: "NETWORK", message: userErrorText(e, "common.networkError") };
	}
}

export const api = {
	getStatus: (): Promise<ApiResult> => request("/status"),
	logout: () => request("/logout", { method: "POST" }),
	getConfig: () => request("/config"),
	saveConfig: (cfg: unknown) => request("/config", { method: "PUT", body: JSON.stringify(cfg) }),
	getPermissions: () => request("/permissions"),
	savePermissions: (perm: unknown) => request("/permissions", { method: "PUT", body: JSON.stringify(perm) }),
	addPermission: (group: string, player: string) =>
		request(`/permissions/${group}/${encodeURIComponent(player)}`, { method: "POST" }),
	removePermission: (group: string, player: string) =>
		request(`/permissions/${group}/${encodeURIComponent(player)}`, { method: "DELETE" }),
	getMods: () => request("/mods"),
	reloadAllMods: () => request("/mods/reload-all", { method: "POST" }),
	enableMod: (name: string) => request(`/mods/${encodeURIComponent(name)}/enable`, { method: "POST" }),
	disableMod: (name: string) => request(`/mods/${encodeURIComponent(name)}/disable`, { method: "POST" }),
	reloadMod: (name: string) => request(`/mods/${encodeURIComponent(name)}/reload`, { method: "POST" }),
	importMod: (file: File, overwrite = false): Promise<ApiResult> => {
		const form = new FormData();
		form.append("file", file);
		return request(`/mods/import${overwrite ? "?overwrite=1" : ""}`, { method: "POST", body: form, raw: true })
			.catch((e: Error) => ({ ok: false, code: "NETWORK", message: userErrorText(e, "common.networkError") }));
	},
	deleteMod: (name: string) => request(`/mods/${encodeURIComponent(name)}/delete`, { method: "POST" }),
	getModConfig: (name: string) => request(`/mods/${encodeURIComponent(name)}/config`),
	saveModConfig: (name: string, cfg: unknown) =>
		request(`/mods/${encodeURIComponent(name)}/config`, { method: "PUT", body: JSON.stringify(cfg) }),
	getModManifest: (name: string) => request(`/mods/${encodeURIComponent(name)}/manifest`),
	getModReadme: (name: string) => request(`/mods/${encodeURIComponent(name)}/readme`),
	getCommands: () => request("/commands"),
	execCommand: (command: string) => request("/command", { method: "POST", body: JSON.stringify({ command }) }),
	getClients: () => request("/clients"),
	tellClient: (id: string, message: string) =>
		request(`/clients/${id}/tell`, { method: "POST", body: JSON.stringify({ message }) }),
	setMainClient: (id: string) => request(`/clients/${id}/set-main`, { method: "POST" }),
	approveClient: (id: string) => request(`/clients/${id}/approve`, { method: "POST" }),
	revokeClient: (id: string) => request(`/clients/${id}/revoke`, { method: "POST" }),
	disconnectClient: (id: string) => request(`/clients/${id}/disconnect`, { method: "POST" }),
	getLogs: (name = "app", lines = 200) =>
		request(`/logs?name=${encodeURIComponent(name)}&lines=${lines}`),
	getChatLog: () => request("/chat"),
	sendChat: (message: string) => request("/chat", { method: "POST", body: JSON.stringify({ message }) }),
	getProcess: () => request("/system/process"),
	killProcess: () => request("/system/kill", { method: "POST" }),
	restartServer: () => request("/system/restart", { method: "POST" }),
	startWebSocket: () => request("/system/start-websocket", { method: "POST" }),
	stopWebSocket: () => request("/system/stop-websocket", { method: "POST" }),
	checkUpdate: () => request("/update/check"),
	getTags: () => request("/update/tags"),
	doUpdate: () => request("/update/do", { method: "POST" }),
	rollback: (tag: string) => request("/update/rollback", { method: "POST", body: JSON.stringify({ tag }) }),
	changePassword: (oldPassword: string, newPassword: string) =>
		request("/auth/change-password", { method: "POST", body: JSON.stringify({ oldPassword, newPassword }) })
};
