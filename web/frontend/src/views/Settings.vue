<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute } from "vue-router";
import { api } from "../api";
import { useModal } from "../composables/useModal";
import { useI18n } from "../composables/useI18n";
import SettingsCard from "../components/SettingsCard.vue";
import SwitchToggle from "../components/SwitchToggle.vue";
import UpdatePanel from "../components/UpdatePanel.vue";
import { useTheme } from "../composables/useTheme";

const { t, setLocale, locale, availableLocales } = useI18n();
const { setTheme } = useTheme();
const { resetPassword } = useModal();
const route = useRoute();

const config = ref<Record<string, any> | null>(null);
const saving = ref(false);
const message = ref("");
const resetSaving = ref(false);
const resetMessage = ref("");
const activeTab = ref<"server" | "webui" | "system">(route.query.tab === "system" ? "system" : "server");

const listToText = (items: unknown): string => Array.isArray(items) ? items.join("\n") : "";
const textToList = (value: string): string[] => value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);

const allowedIPsText = computed({
	get: () => listToText(config.value?.ws?.connection?.allowedIPs),
	set: (value: string) => {
		if (!config.value) return;
		config.value.ws.connection.allowedIPs = textToList(value);
	}
});
const allowedOriginsText = computed({
	get: () => listToText(config.value?.web?.ui?.allowedOrigins),
	set: (value: string) => {
		if (!config.value) return;
		config.value.web.ui.allowedOrigins = textToList(value);
	}
});

const localeLabels: Record<string, string> = {
	"zh-CN": "简体中文",
	"zh-TW": "繁體中文",
	en: "English"
};
const themeOptions = [
	{ id: "star", labelKey: "settings.themeStar", swatch: "linear-gradient(135deg, #f0f7ff 0 50%, #60a5fa 50%)" },
	{ id: "catppuccin-mocha", labelKey: "settings.themeMocha", swatch: "linear-gradient(135deg, #1e1e2e 0 30%, #89b4fa 30% 50%, #a6e3a1 50% 65%, #f9e2af 65% 80%, #cba6f7 80%)" }
];
const tabs: Array<{ key: "server" | "webui" | "system"; labelKey: string; icon: string }> = [
	{ key: "server", labelKey: "settings.server", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>` },
	{ key: "webui", labelKey: "settings.webui", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>` },
	{ key: "system", labelKey: "settings.system", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h.09a1.65 1.65 0 0 0-1.51 1z"/></svg>` }
];

async function refresh() {
	const data = await api.getConfig();
	config.value = data && typeof data === "object" && "ws" in data ? data : null;
	if (config.value) setTheme(config.value.web?.ui?.theme ?? "star");
}

function selectTheme(theme: string): void {
	if (!config.value) return;
	config.value.web.ui.theme = theme;
	setTheme(theme);
}

async function save() {
	saving.value = true;
	message.value = "";
	try {
		const res = await api.saveConfig(config.value);
		if (res.ok) {
			message.value = t("common.saveSuccess");
		} else {
			message.value = res.message || t("common.saveFailed");
		}
	} catch (e) {
		message.value = (e as Error).message;
	}
	saving.value = false;
	setTimeout(() => message.value = "", 3000);
}

async function handleResetPassword() {
	resetMessage.value = "";
	const result = await resetPassword();
	if (!Array.isArray(result) || result.length < 2) return;
	const [oldPwd, newPwd] = result as [string, string];
	resetSaving.value = true;
	try {
		const res = await api.changePassword(oldPwd, newPwd);
		if (res.ok) {
			resetMessage.value = t("settings.changePasswordSuccess");
			sessionStorage.removeItem("auth_token");
			setTimeout(() => { window.location.href = "/login"; }, 800);
		} else {
			resetMessage.value = res.message || t("settings.changePasswordFailed");
		}
	} catch (e) {
		resetMessage.value = (e as Error).message;
	}
	resetSaving.value = false;
}

function selectLocale(loc: string): void {
	setLocale(loc);
	if (config.value) config.value.language = loc;
}

onMounted(refresh);
</script>

<template>
	<div v-if="config" class="settings-page">
		<div class="settings-header">
			<h1 class="settings-title">{{ t('settings.title') }}</h1>
			<div class="settings-actions">
				<span v-if="message" class="settings-message">{{ message }}</span>
				<button class="btn btn-primary" @click="save" :disabled="saving">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
						<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
						<polyline points="17 21 17 13 7 13 7 21"/>
						<polyline points="7 3 7 8 15 8"/>
					</svg>
					{{ saving ? t('settings.saving') : t('settings.saveButton') }}
				</button>
			</div>
		</div>

		<div class="tab-bar">
			<button
				v-for="tab in tabs"
				:key="tab.key"
				class="tab-btn"
				:class="{ active: activeTab === tab.key }"
				@click="activeTab = tab.key"
				:title="t(tab.labelKey)"
			>
				<span class="tab-icon" v-html="tab.icon"></span>
			</button>
		</div>

		<div class="tab-content">
			<div v-if="activeTab === 'server'" class="tab-panel">
				<SettingsCard :title="t('settings.server')">
					<div class="form-row">
						<div class="form-group">
							<label>{{ t('settings.serverName') }}</label>
							<input v-model="config.ws.name" type="text" />
						</div>
						<div class="form-group">
							<label>{{ t('settings.wsPort') }}</label>
							<input v-model.number="config.ws.port" type="number" />
						</div>
					</div>
					<div class="form-group">
						<label>{{ t('settings.serverHost') }}</label>
						<input v-model="config.ws.host" type="text" placeholder="127.0.0.1" />
						<p class="field-hint">{{ t('settings.serverHostHint') }}</p>
					</div>
				</SettingsCard>


				<SettingsCard :title="t('settings.connectionSettings')">
					<div class="switch-row">
						<span class="switch-label">{{ t('settings.enableMaxConnections') }}</span>
						<SwitchToggle id="enableMaxConnections" v-model="config.ws.connection.enableMaxConnections" />
					</div>
					<div class="form-row">
						<div class="form-group">
							<label>{{ t('settings.maxConnections') }}</label>
							<input v-model.number="config.ws.connection.maxConnections" type="number" />
						</div>
					</div>
					<div class="switch-row" style="margin-top: 10px;">
						<span class="switch-label">{{ t('settings.enableConnectionRateLimit') }}</span>
						<SwitchToggle id="enableConnectionRateLimit" v-model="config.ws.connection.enableConnectionRateLimit" />
					</div>
					<div class="form-row">
						<div class="form-group">
							<label>{{ t('settings.connectionWindowMs') }}</label>
							<input v-model.number="config.ws.connection.rateLimitWindow" type="number" />
						</div>
						<div class="form-group">
							<label>{{ t('settings.maxConnectionsPerWindow') }}</label>
							<input v-model.number="config.ws.connection.rateLimitMax" type="number" />
						</div>
					</div>
					<div class="switch-row" style="margin-top: 10px;">
						<span class="switch-label">{{ t('settings.requireApproval') }}</span>
						<SwitchToggle id="requireApproval" v-model="config.ws.connection.requireApproval" />
					</div>
					<p class="field-hint">{{ t('settings.requireApprovalHint') }}</p>
					<div class="form-group" style="margin-top: 10px;">
						<label>{{ t('settings.allowedIPs') }}</label>
						<textarea v-model="allowedIPsText" rows="3" placeholder="127.0.0.1&#10;192.168.1.0/24"></textarea>
						<p class="field-hint">{{ t('settings.allowedIPsHint') }}</p>
					</div>
					<div class="switch-row" style="margin-top: 10px;">
						<span class="switch-label">{{ t('settings.perMessageDeflate') }}</span>
						<SwitchToggle id="perMessageDeflate" v-model="config.ws.connection.perMessageDeflate" />
					</div>
					<div class="form-group" style="margin-top: 10px;">
						<label>{{ t('settings.maxPayload') }}</label>
						<input v-model.number="config.ws.connection.maxPayload" type="number" />
						<p class="field-hint">{{ t('settings.maxPayloadHint') }}</p>
					</div>
				</SettingsCard>

				<SettingsCard :title="t('settings.commandSettings')">
					<div class="switch-row">
						<span class="switch-label">{{ t('settings.enableRateLimit') }}</span>
						<SwitchToggle id="enableRateLimit" v-model="config.command.rateLimit.enabled" />
					</div>
					<div class="form-row">
						<div class="form-group">
							<label>{{ t('settings.windowMsRate') }}</label>
							<input v-model.number="config.command.rateLimit.windowMs" type="number" />
						</div>
						<div class="form-group">
							<label>{{ t('settings.maxPerWindow') }}</label>
							<input v-model.number="config.command.rateLimit.maxPerWindow" type="number" />
						</div>
					</div>
					<div class="form-group" style="margin-top: 10px;">
						<label>{{ t('settings.commandMaxLength') }}</label>
						<input v-model.number="config.command.maxLength" type="number" />
					</div>
					<div class="switch-row" style="margin-top: 10px;">
						<span class="switch-label">{{ t('settings.allowShellExec') }}</span>
						<SwitchToggle id="allowShellExec" v-model="config.command.allowShellExec" />
					</div>
					<p class="field-hint">{{ t('settings.allowShellExecHint') }}</p>
					<div class="switch-row" style="margin-top: 10px;">
						<span class="switch-label">{{ t('settings.playerRateLimit') }}</span>
						<SwitchToggle id="playerRateLimit" v-model="config.command.playerRateLimit.enabled" />
					</div>
					<p class="field-hint">{{ t('settings.playerRateLimitHint') }}</p>
					<div class="form-row">
						<div class="form-group">
							<label>{{ t('settings.playerWindowMs') }}</label>
							<input v-model.number="config.command.playerRateLimit.windowMs" type="number" />
						</div>
						<div class="form-group">
							<label>{{ t('settings.playerMaxPerWindow') }}</label>
							<input v-model.number="config.command.playerRateLimit.maxPerWindow" type="number" />
						</div>
					</div>
				</SettingsCard>

				<SettingsCard :title="t('settings.sapi')">
					<div class="form-row">
						<div class="form-group">
							<label>{{ t('settings.getMessageCommand') }}</label>
							<input v-model="config.sapi.gmsg" type="text" />
						</div>
						<div class="form-group">
							<label>{{ t('settings.sendMessageCommand') }}</label>
							<input v-model="config.sapi.smsg" type="text" />
						</div>
					</div>
				</SettingsCard>

				<SettingsCard :title="t('settings.tools')">
					<div class="switch-row">
						<span class="switch-label">{{ t('settings.tellAllToTell') }}</span>
						<SwitchToggle id="tellAllToTell" v-model="config.utils.tellAllToTell" />
					</div>
					<div class="switch-row" style="margin-top: 10px;">
						<span class="switch-label">{{ t('settings.enablePolling') }}</span>
						<SwitchToggle id="enablePolling" v-model="config.utils.enablePolling" />
					</div>
				</SettingsCard>
			</div>

			<div v-if="activeTab === 'webui'" class="tab-panel">
				<SettingsCard :title="t('settings.theme')">
					<div class="theme-grid">
						<button
							v-for="option in themeOptions"
							:key="option.id"
							class="theme-option"
							:class="{ active: config.web.ui.theme === option.id }"
							@click="selectTheme(option.id)"
						>
							<span class="theme-swatch" :style="{ background: option.swatch }"></span>
							<span>{{ t(option.labelKey) }}</span>
						</button>
					</div>
					<p class="field-hint">{{ t('settings.themeHint') }}</p>
				</SettingsCard>

				<SettingsCard :title="t('settings.webui')">
					<div class="form-group">
						<label>{{ t('settings.httpPort') }}</label>
						<input v-model.number="config.web.port" type="number" />
					</div>
					<div class="form-group" style="margin-top: 10px;">
						<label>{{ t('settings.allowedOrigins') }}</label>
						<textarea v-model="allowedOriginsText" rows="3" placeholder="https://example.com"></textarea>
						<p class="field-hint">{{ t('settings.allowedOriginsHint') }}</p>
					</div>
				</SettingsCard>

				<SettingsCard :title="t('settings.auth')">
					<div class="form-row">
						<div class="form-group">
							<label>{{ t('settings.maxAttempts') }}</label>
							<input v-model.number="config.web.auth.maxAttempts" type="number" />
						</div>
						<div class="form-group">
							<label>{{ t('settings.windowMs') }}</label>
							<input v-model.number="config.web.auth.windowMs" type="number" />
						</div>
					</div>
					<div class="form-group">
						<label>{{ t('settings.lockoutMs') }}</label>
						<input v-model.number="config.web.auth.lockoutMs" type="number" />
					</div>
					<div style="margin-top: 10px;">
						<button class="btn btn-danger" @click="handleResetPassword" :disabled="saving || resetSaving">
							{{ t('settings.resetPassword') }}
						</button>
						<span v-if="resetMessage" style="margin-left: 10px; font-size: 13px; color: var(--danger);">{{ resetMessage }}</span>
					</div>
				</SettingsCard>


			</div>
			<div v-if="activeTab === 'system'" class="tab-panel">
				<SettingsCard :title="t('update.title')">
					<UpdatePanel />
					<div class="switch-row" style="margin-top: 16px;">
						<span class="switch-label">{{ t('settings.updateAutoCheck') }}</span>
						<SwitchToggle id="updateAutoCheck" v-model="config.update.autoCheck" />
					</div>
					<p class="field-hint">{{ t('settings.updateAutoCheckHint') }}</p>
					<div class="switch-row" style="margin-top: 10px;">
						<span class="switch-label">{{ t('settings.updatePrerelease') }}</span>
						<SwitchToggle id="updatePrerelease" v-model="config.update.allowPrerelease" />
					</div>
					<p class="field-hint">{{ t('settings.updatePrereleaseHint') }}</p>
				</SettingsCard>

				<SettingsCard :title="t('settings.general')">
					<div class="form-group">
						<label>{{ t('settings.commandPrefix') }}</label>
						<input v-model="config.commandPrefix" type="text" maxlength="4" />
					</div>
					<div class="form-group" style="margin-top: 10px;">
						<label>{{ t('settings.languageLabel') }}</label>
						<div style="display: flex; gap: 8px; margin-top: 4px;">
							<button
								v-for="loc in availableLocales"
								:key="loc"
								class="locale-btn"
								:class="{ active: locale === loc }"
								@click="selectLocale(loc)"
							>
								{{ localeLabels[loc] ?? loc }}
							</button>
						</div>
					</div>
					<div class="form-group" style="margin-top: 10px;">
						<label>{{ t('settings.logLevel') }}</label>
						<select v-model="config.logLevel">
							<option value="debug">{{ t('settings.debug') }}</option>
							<option value="info">{{ t('settings.info') }}</option>
							<option value="warning">{{ t('settings.warning') }}</option>
							<option value="error">{{ t('settings.error') }}</option>
						</select>
					</div>
				</SettingsCard>



				<SettingsCard :title="t('settings.dependencySettings')">
					<div class="switch-row">
						<span class="switch-label">{{ t('settings.checkDependenciesOnLoad') }}</span>
						<SwitchToggle id="checkDependenciesOnLoad" v-model="config.ws.checkDependenciesOnLoad" />
					</div>
				</SettingsCard>
			</div>

		</div>
	</div>

	<div v-else class="empty-state">
		<p>{{ t('settings.loading') }}</p>
	</div>
</template>

<style scoped>
.settings-page {
	max-width: 900px;
	margin: 0 auto;
}

.settings-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 16px;
}

.settings-title {
	font-size: 20px;
	font-weight: 700;
	margin: 0;
}

.settings-actions {
	display: flex;
	align-items: center;
	gap: 10px;
}

.settings-message {
	font-size: 13px;
	color: var(--text-secondary);
}

.field-hint {
	font-size: 12px;
	color: var(--text-muted);
	margin-top: 5px;
	line-height: 1.5;
}

.tab-bar {
	display: flex;
	gap: 6px;
	flex-wrap: nowrap;
	overflow-x: auto;
	margin-bottom: 16px;
	padding: 6px;
	background: var(--bg-card-solid);
	border-radius: 10px;
	border: 1px solid var(--border);
}

.tab-btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 40px;
	height: 40px;
	border-radius: 8px;
	font-size: 13px;
	color: var(--text-secondary);
	background: transparent;
	border: 1px solid transparent;
	cursor: pointer;
	font-family: inherit;
	transition: all 0.15s;
	white-space: nowrap;
	flex-shrink: 0;
}

.tab-btn:hover {
	background: var(--primary-glow);
	color: var(--text);
}

.tab-btn.active {
	background: var(--primary-dim);
	color: var(--primary);
	border-color: var(--primary);
}

.tab-icon {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 20px;
	height: 20px;
}

.tab-icon svg {
	width: 20px;
	height: 20px;
}

.tab-content {
	min-height: 200px;
}

.tab-panel {
	display: flex;
	flex-direction: column;
	gap: 12px;
}

.switch-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.switch-label {
	font-size: 13px;
	color: var(--text-secondary);
	font-weight: 500;
}

.theme-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 8px;
}

.theme-option {
	display: flex;
	align-items: center;
	gap: 10px;
	padding: 10px 12px;
	border: 1px solid var(--border);
	border-radius: var(--radius);
	background: var(--bg-input);
	color: var(--text-secondary);
	cursor: pointer;
	font-family: inherit;
	font-size: 13px;
	text-align: left;
	transition: border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.theme-option:hover {
	border-color: var(--primary);
	color: var(--text);
}

.theme-option.active {
	border-color: var(--primary);
	background: var(--primary-dim);
	color: var(--text);
}

.theme-swatch {
	width: 26px;
	height: 26px;
	border-radius: 7px;
	border: 1px solid var(--border);
	flex-shrink: 0;
}

@media (max-width: 480px) {
	.theme-grid { grid-template-columns: 1fr; }
}

.locale-btn {
	background: transparent;
	border: 1px solid var(--border);
	color: var(--text-muted);
	border-radius: var(--radius);
	padding: 6px 14px;
	font-size: 13px;
	cursor: pointer;
	transition: all 0.2s;
	font-family: inherit;
}
.locale-btn:hover {
	background: var(--primary-glow);
	color: var(--text);
	border-color: var(--primary);
}
.locale-btn.active {
	background: var(--primary);
	border-color: var(--primary);
	color: var(--on-primary);
}
</style>
