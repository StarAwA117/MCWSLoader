<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api";
import ConfigField from "../components/ConfigField.vue";
import { useI18n } from "../composables/useI18n";
import { useModal } from "../composables/useModal";
import { renderMarkdown } from "../utils/markdown";

const { t } = useI18n();
const { alert: showAlert, confirm: showConfirm } = useModal();

const mods = ref([]);
const loading = ref(false);
const reloading = ref({});
const importing = ref(false);
const modal = ref({ open: false, type: "", modName: "", mod: null, config: null, fields: [], manifest: null, readme: "", saving: false, message: "" });

const sortedMods = computed(() => [...mods.value].sort((a, b) => {
	if (a.enabled !== b.enabled) return b.enabled - a.enabled;
	return a.name.localeCompare(b.name);
}));

// README 只在内容变化时解析一次，避免无关状态更新触发重复渲染
const readmeHtml = computed(() => renderMarkdown(modal.value.readme));

async function refresh() {
	const data = await api.getMods();
	// 接口异常时返回的是 { ok:false, message }，这里要容错，否则整个页面会崩
	const server = Array.isArray(data?.server) ? data.server : [];
	const client = Array.isArray(data?.client) ? data.client : [];
	const map = new Map();
	for (const m of [...server, ...client]) {
		const existing = map.get(m.name);
		if (existing) {
			if (server.some(s => s.name === m.name)) existing.entry.server = true;
			if (client.some(c => c.name === m.name)) existing.entry.client = true;
		} else {
			map.set(m.name, { ...m, entry: { server: server.some(s => s.name === m.name), client: client.some(c => c.name === m.name) } });
		}
	}
	mods.value = [...map.values()];
}

async function reloadAll() {
	const ok = await showConfirm(t("mods.reloadConfirm"), t("mods.reloadTitle"));
	if (!ok) return;
	loading.value = true;
	try { await api.reloadAllMods(); await refresh(); } catch {}
	loading.value = false;
}

async function toggleMod(mod) {
	const target = !mod.enabled;
	// 乐观切换：请求失败时再改回来（否则开关会与后端状态不一致）
	mod.enabled = target;
	try {
		const res = target ? await api.enableMod(mod.name) : await api.disableMod(mod.name);
		if (!res || !res.ok) {
			mod.enabled = !target;
			await showAlert(t("mods.toggleFailed") + "：" + ((res && res.message) || `HTTP ${target ? "enable" : "disable"}`), t("mods.title"));
		}
	} catch (e) {
		mod.enabled = !target;
		await showAlert(t("mods.toggleFailed") + "：" + e.message, t("mods.title"));
	}
}

async function reloadMod(mod) {
	const ok = await showConfirm(t("mods.reloadOneConfirm", { name: mod.name }), t("mods.reloadTitle"));
	if (!ok) return;
	reloading.value[mod.name] = true;
	try { await api.reloadMod(mod.name); } catch {}
	reloading.value[mod.name] = false;
}

function importErrorText(res) {
	switch (res && res.code) {
		case "INVALID_FORMAT": return t("mods.errInvalidFormat");
		case "DEPENDENCY_FAILED": return t("mods.errDependency");
		case "INSTALL_FAILED": return t("mods.errInstall");
		default: return (res && res.message) || t("mods.importFailed");
	}
}

async function importMod(event) {
	const input = event.target;
	const file = input.files && input.files[0];
	input.value = "";
	if (!file || importing.value) return;

	const lower = file.name.toLowerCase();
	if (!lower.endsWith(".wsmod") && !lower.endsWith(".zip")) {
		await showAlert(t("mods.importFailed") + "：" + t("mods.errInvalidFormat"), t("mods.importTitle"));
		return;
	}

	importing.value = true;
	try {
		let res = await api.importMod(file, false);

		// 模组已存在 -> 询问是否覆盖，确认后重新上传并覆盖
		if (res && res.code === "CONFLICT") {
			const ok = await showConfirm(t("mods.overwriteConfirm", { name: res.name || file.name }), t("mods.overwriteTitle"));
			if (!ok) return;
			res = await api.importMod(file, true);
		}

		if (res && res.ok) {
			await refresh();
			await showAlert(t("mods.importSuccess"), t("mods.importTitle"));
		} else {
			// 失败时后端已回滚/清理，这里刷新一次列表
			await refresh().catch(() => {});
			await showAlert(t("mods.importFailed") + "：" + importErrorText(res), t("mods.importTitle"));
		}
	} catch (e) {
		await refresh().catch(() => {});
		await showAlert(t("mods.importFailed") + "：" + e.message, t("mods.importTitle"));
	} finally {
		// 无论成功失败都要复位，否则导入按钮会永久禁用
		importing.value = false;
	}
}

async function deleteMod(mod) {
	const ok = await showConfirm(t("mods.deleteConfirm"), t("mods.deleteTitle"));
	if (!ok) return;
	try {
		const res = await api.deleteMod(mod.name);
		if (res && res.ok) {
			await refresh();
			await showAlert(t("mods.deleteSuccess"), t("mods.deleteTitle"));
		} else {
			await showAlert(t("mods.deleteFailed") + "：" + ((res && res.message) || t("mods.deleteNotFound")), t("mods.deleteTitle"));
		}
	} catch (e) {
		await showAlert(t("mods.deleteFailed") + "：" + e.message, t("mods.deleteTitle"));
	}
}

function lockScroll() { document.body.classList.add("modal-open"); }
function unlockScroll() { document.body.classList.remove("modal-open"); }
function closeModal() { modal.value.open = false; unlockScroll(); }

function buildFields(obj, prefix) {
	if (!obj || typeof obj !== "object") return [];
	return Object.entries(obj).map(([key, val]) => {
		const path = prefix ? prefix + "." + key : key;
		if (val === null) return { path, key, type: "string" };
		if (typeof val === "boolean") return { path, key, type: "boolean" };
		if (typeof val === "number") return { path, key, type: "number" };
		if (typeof val === "string") return { path, key, type: "string" };
		if (Array.isArray(val)) {
			if (val.length > 0 && typeof val[0] === "object") return { path, key, type: "json" };
			return { path, key, type: "array" };
		}
		if (typeof val === "object") {
			const children = buildFields(val, path);
			const hasNested = children.some(c => c.type === "group");
			const childCount = Object.keys(val).length;
			if (!hasNested && childCount <= 4 && children.every(c => c.type !== "json" && c.type !== "array")) {
				return { path, key, type: "row", children };
			}
			return { path, key, type: "group", children };
		}
		return { path, key, type: "string" };
	});
}

async function openSettings(mod) {
	modal.value = { open: true, type: "settings", modName: mod.name, mod, config: null, fields: [], manifest: null, readme: "", saving: false, message: "" };
	lockScroll();
	try {
		const res = await api.getModConfig(mod.name);
		if (res.ok) {
			modal.value.config = JSON.parse(JSON.stringify(res.config));
			modal.value.fields = buildFields(res.config, "");
		}
	} catch { modal.value.message = t("mods.loadFailed"); }
}

async function openManifest(mod) {
	modal.value = { open: true, type: "manifest", modName: mod.name, mod, config: null, fields: [], manifest: null, readme: "", saving: false, message: "" };
	lockScroll();
	try {
		const res = await api.getModManifest(mod.name);
		if (res.ok) modal.value.manifest = res.manifest;
	} catch { modal.value.message = t("mods.loadFailed"); }
}

async function openReadme(mod) {
	modal.value = { open: true, type: "readme", modName: mod.name, mod, config: null, fields: [], manifest: null, readme: "", saving: false, message: "" };
	lockScroll();
	try {
		const res = await api.getModReadme(mod.name);
		if (res.ok) modal.value.readme = res.readme || t("mods.noReadme");
		else modal.value.readme = res.message || t("mods.noReadme");
	} catch { modal.value.readme = t("mods.loadFailed"); }
}

async function saveConfig() {
	modal.value.saving = true;
	modal.value.message = "";
	try {
		const res = await api.saveModConfig(modal.value.modName, modal.value.config);
		if (res.ok) { modal.value.message = t("common.saveSuccess"); setTimeout(closeModal, 800); }
		else { modal.value.message = res.message || t("common.saveFailed"); }
	} catch (e) { modal.value.message = e.message; }
	modal.value.saving = false;
}

function modType(m) {
	if (m.entry?.server && m.entry?.client) return t("mods.typeBoth");
	if (m.entry?.server) return t("mods.typeServer");
	return t("mods.typeClient");
}

onMounted(() => { refresh().catch(() => {}); });
onBeforeUnmount(unlockScroll);
</script>

<template>
	<div>
		<div class="card-header">
			<h2>{{ t('mods.title') }}</h2>
			<button class="btn btn-sm btn-ghost reload-btn" @click="reloadAll" :disabled="loading">{{ loading ? "..." : t('mods.reloadAll') }}</button>
			<label class="icon-btn import-btn" :title="t('mods.importTooltip')" :class="{ busy: importing }">
				<input type="file" accept=".wsmod,.zip" @change="importMod" :disabled="importing" />
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
			</label>
		</div>
		<div v-if="!sortedMods.length" class="empty-state"><p>{{ t('mods.none') }}</p></div>
		<div v-for="m in sortedMods" :key="m.name" class="card mod-card" :class="{ disabled: !m.enabled }">
			<div class="mod-top">
				<div class="mod-info">
					<div class="mod-name">{{ m.name }}</div>
					<div v-if="m.description" class="mod-desc">{{ m.description }}</div>
				</div>
				<label class="switch" @click.stop>
					<input type="checkbox" :checked="m.enabled" @change="toggleMod(m)" />
					<span class="slider"></span>
				</label>
			</div>
			<div class="mod-bottom">
				<button class="icon-btn delete-btn" :title="t('mods.delete')" @click="deleteMod(m)">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
				</button>
				<div class="mod-actions">
					<button v-if="m.enabled" class="icon-btn" :title="t('mods.reload')" @click="reloadMod(m)" :disabled="reloading[m.name]">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
					</button>
					<button class="icon-btn" :title="t('mods.manifest')" @click="openManifest(m)">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
					</button>
					<button v-if="m.hasReadme" class="icon-btn" :title="t('mods.readme')" @click="openReadme(m)">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
					</button>
					<button v-if="m.hasConfig" class="icon-btn" :title="t('mods.config')" @click="openSettings(m)">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82.48V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15H4.59a1.65 1.65 0 0 0-1.51 1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68V4.59a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9H19.41a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
					</button>
				</div>
			</div>
		</div>
	</div>

	<div v-if="modal.open" class="modal-overlay" @click.self="closeModal">
		<div class="modal">
			<div class="modal-header">
				<h3>{{ modal.modName }}{{ modal.type === "settings" ? " - " + t('mods.config') : modal.type === "manifest" ? " - " + t('mods.manifest') : " - " + t('mods.readme') }}</h3>
				<button class="modal-close" @click="closeModal">&times;</button>
			</div>
			<div class="modal-body">
				<div v-if="modal.type === 'settings'">
					<div v-if="!modal.config" class="empty-state"><p>{{ modal.message || t('common.loading') }}</p></div>
					<ConfigField v-else v-for="f in modal.fields" :key="f.path" :field="f" :config="modal.config" :depth="0" />
				</div>

				<div v-if="modal.type === 'manifest'">
					<div v-if="modal.manifest" class="manifest-info">
						<p><b>{{ t('mods.name') }}：</b>{{ modal.manifest.name || modal.modName }}</p>
						<p><b>{{ t('mods.version') }}：</b>{{ modal.manifest.version || t('mods.unknown') }}</p>
						<p><b>{{ t('mods.description') }}：</b>{{ modal.manifest.description || t('mods.notSet') }}</p>
						<p><b>{{ t('mods.author') }}：</b>{{ modal.manifest.author || t('mods.unknown') }}</p>
						<p><b>{{ t('mods.type') }}：</b>{{ modType(modal.mod) }}</p>
					</div>
					<div v-else class="empty-state"><p>{{ modal.message || t('mods.noManifest') }}</p></div>
				</div>

				<div v-if="modal.type === 'readme'" class="modal-markdown" v-html="readmeHtml"></div>
			</div>
			<div v-if="modal.type === 'settings' && modal.config" class="modal-footer">
				<span v-if="modal.message" class="modal-msg">{{ modal.message }}</span>
				<button class="btn btn-ghost" @click="closeModal">{{ t('modal.cancel') }}</button>
				<button class="btn btn-primary" @click="saveConfig" :disabled="modal.saving">{{ modal.saving ? t('common.saving') : t('common.save') }}</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.mod-card { margin-bottom: 10px; transition: opacity 0.2s; }
.mod-card.disabled { opacity: 0.5; }
.mod-top { display: flex; align-items: flex-start; gap: 14px; }
.mod-info { flex: 1; min-width: 0; }
.mod-name { font-weight: 600; font-size: 15px; color: var(--text); }
.mod-desc { font-size: 13px; color: var(--text-secondary); margin-top: 4px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mod-bottom { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; }
.mod-actions { display: flex; gap: 2px; }

.icon-btn {
	display: inline-flex; align-items: center; justify-content: center;
	width: 30px; height: 30px; border-radius: 6px; border: none;
	background: transparent; color: var(--text-secondary); cursor: pointer;
	transition: all 0.15s;
}
.icon-btn:hover { background: var(--primary-dim); color: var(--primary); }
.icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.icon-btn:disabled:hover { background: transparent; color: var(--text-secondary); }
.icon-btn svg { width: 16px; height: 16px; }
.delete-btn:hover { background: rgba(239, 68, 68, 0.15); color: #ef4444; }

.card-header { display: flex; flex-direction: row; align-items: center; flex-wrap: nowrap; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border); gap: 8px; }

.import-btn { background: var(--primary-dim); color: var(--primary); cursor: pointer; }
.import-btn input[type="file"] { display: none; }
.import-btn.busy { opacity: 0.5; cursor: wait; pointer-events: none; }

.card-header h2 { font-size: 15px; color: var(--text); font-weight: 600; margin: 0; white-space: nowrap; flex-shrink: 0; }
.reload-btn { margin-left: auto; white-space: nowrap; flex-shrink: 0; }

.switch { position: relative; display: inline-block; width: 42px; height: 24px; flex-shrink: 0; cursor: pointer; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; inset: 0; background: var(--border); border-radius: 24px; transition: background 0.25s; }
.slider::before { content: ""; position: absolute; width: 18px; height: 18px; left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: transform 0.25s; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
.switch input:checked + .slider { background: var(--primary); }
.switch input:checked + .slider::before { transform: translateX(18px); }

.manifest-info p { margin: 6px 0; font-size: 14px; }
.manifest-info b { color: var(--text-secondary); }
</style>
