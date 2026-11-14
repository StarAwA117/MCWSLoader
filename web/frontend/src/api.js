import { useI18n } from "./composables/useI18n";

const BASE = "/api";

function getToken() {
	return sessionStorage.getItem("auth_token") || "";
}

/**
 * 解析响应体：空响应体 / 非 JSON（网关错误页）不应让调用方抛异常。
 * @param {Response} res
 * @returns {Promise<Object>}
 */
async function parseResponse(res) {
	const text = await res.text().catch(() => "");
	if (!text) return { ok: false, message: `HTTP ${res.status}` };
	try {
		return JSON.parse(text);
	} catch {
		return { ok: false, message: `HTTP ${res.status}` };
	}
}

/**
 * 带鉴权的请求。401 会清理 token 并跳回登录页。
 * @param {string} path
 * @param {RequestInit & { raw?: boolean }} options - raw=true 时不设置 JSON Content-Type（FormData）
 */
async function request(path, options = {}) {
	const { raw = false, headers, ...rest } = options;
	const res = await fetch(`${BASE}${path}`, {
		headers: {
			"X-Auth-Token": getToken(),
			...(raw ? {} : { "Content-Type": "application/json" }),
			...headers
		},
		...rest
	});
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
export async function loginWithPassword(pwd) {
	const res = await fetch(`${BASE}/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ password: pwd })
	});
	return parseResponse(res);
}

export const api = {
	getStatus: () => request("/status"),
	getConfig: () => request("/config"),
	saveConfig: (cfg) => request("/config", { method: "PUT", body: JSON.stringify(cfg) }),
	getPermissions: () => request("/permissions"),
	savePermissions: (perm) => request("/permissions", { method: "PUT", body: JSON.stringify(perm) }),
	addPermission: (group, player) => request(`/permissions/${group}/${encodeURIComponent(player)}`, { method: "POST" }),
	removePermission: (group, player) => request(`/permissions/${group}/${encodeURIComponent(player)}`, { method: "DELETE" }),
	getMods: () => request("/mods"),
	reloadAllMods: () => request("/mods/reload-all", { method: "POST" }),
	enableMod: (name) => request(`/mods/${encodeURIComponent(name)}/enable`, { method: "POST" }),
	disableMod: (name) => request(`/mods/${encodeURIComponent(name)}/disable`, { method: "POST" }),
	reloadMod: (name) => request(`/mods/${encodeURIComponent(name)}/reload`, { method: "POST" }),
	importMod: (file, overwrite = false) => {
		const form = new FormData();
		form.append("file", file);
		return request(`/mods/import${overwrite ? "?overwrite=1" : ""}`, { method: "POST", body: form, raw: true })
			.catch(e => ({ ok: false, code: "NETWORK", message: e.message }));
	},
	deleteMod: (name) => request(`/mods/${encodeURIComponent(name)}/delete`, { method: "POST" }),
	getModConfig: (name) => request(`/mods/${encodeURIComponent(name)}/config`),
	saveModConfig: (name, cfg) => request(`/mods/${encodeURIComponent(name)}/config`, { method: "PUT", body: JSON.stringify(cfg) }),
	getModManifest: (name) => request(`/mods/${encodeURIComponent(name)}/manifest`),
	getModReadme: (name) => request(`/mods/${encodeURIComponent(name)}/readme`),
	getCommands: () => request("/commands"),
	execCommand: (command) => request("/command", { method: "POST", body: JSON.stringify({ command }) }),
	getClients: () => request("/clients"),
	tellClient: (id, message) => request(`/clients/${id}/tell`, { method: "POST", body: JSON.stringify({ message }) }),
	setMainClient: (id) => request(`/clients/${id}/set-main`, { method: "POST" }),
	disconnectClient: (id) => request(`/clients/${id}/disconnect`, { method: "POST" }),
	getLogs: (name = "app", lines = 200) => request(`/logs?name=${encodeURIComponent(name)}&lines=${lines}`),
	getChatLog: () => request("/chat"),
	sendChat: (message) => request("/chat", { method: "POST", body: JSON.stringify({ message }) }),
	getProcess: () => request("/system/process"),
	killProcess: () => request("/system/kill", { method: "POST" }),
	restartServer: () => request("/system/restart", { method: "POST" }),
	checkUpdate: () => request("/update/check"),
	getTags: () => request("/update/tags"),
	doUpdate: () => request("/update/do", { method: "POST" }),
	rollback: (tag) => request("/update/rollback", { method: "POST", body: JSON.stringify({ tag }) }),
	changePassword: (oldPassword, newPassword) => request("/auth/change-password", { method: "POST", body: JSON.stringify({ oldPassword, newPassword }) }),
};
