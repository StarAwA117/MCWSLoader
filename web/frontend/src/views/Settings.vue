<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api";
import { useModal } from "../composables/useModal";
import { useI18n } from "../composables/useI18n";

const { t, setLocale, locale, availableLocales } = useI18n();
const { openResetPassword } = useModal();

const config = ref(null);
const saving = ref(false);
const message = ref("");
const resetSaving = ref(false);
const resetMessage = ref("");
const activeTab = ref("server");

const tabs = [
	{ key: "server", label: "服务器", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>` },
	{ key: "webui", label: "WebUI", icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>` }
];

async function refresh() {
	config.value = await api.getConfig();
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
		message.value = e.message;
	}
	saving.value = false;
	setTimeout(() => message.value = "", 3000);
}

async function handleResetPassword() {
	resetMessage.value = "";
	const result = await openResetPassword();
	if (!result) return;
	const [oldPwd, newPwd] = result;
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
		resetMessage.value = e.message;
	}
	resetSaving.value = false;
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
				:title="tab.label"
			>
				<span class="tab-icon" v-html="tab.icon"></span>
			</button>
		</div>

		<div class="tab-content">
			<div v-if="activeTab === 'server'" class="tab-panel">
				<div class="card">
					<div class="card-header">
						<h2>{{ t('settings.server') }}</h2>
					</div>
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
				</div>

				<div class="card">
					<div class="card-header">
						<h2>{{ t('settings.commandPrefix') }}</h2>
					</div>
					<div class="form-group">
						<label>{{ t('settings.commandPrefix') }}</label>
						<input v-model="config.commandPrefix" type="text" maxlength="4" />
					</div>
				</div>

				<div class="card">
					<div class="card-header">
						<h2>{{ t('settings.connectionSettings') }}</h2>
					</div>
					<div class="switch-row">
						<span class="switch-label">{{ t('settings.enableMaxConnections') }}</span>
						<label class="switch">
							<input id="enableMaxConnections" type="checkbox" v-model="config.safety.enableMaxConnections" />
							<span class="slider"></span>
						</label>
					</div>
					<div class="form-row">
						<div class="form-group">
							<label>{{ t('settings.maxConnections') }}</label>
							<input v-model.number="config.safety.maxConnections" type="number" />
						</div>
					</div>
					<div class="switch-row" style="margin-top: 10px;">
						<span class="switch-label">{{ t('settings.enableConnectionRateLimit') }}</span>
						<label class="switch">
							<input id="enableConnectionRateLimit" type="checkbox" v-model="config.safety.enableConnectionRateLimit" />
							<span class="slider"></span>
						</label>
					</div>
					<div class="form-row">
						<div class="form-group">
							<label>{{ t('settings.connectionWindowMs') }}</label>
							<input v-model.number="config.safety.rateLimitWindow" type="number" />
						</div>
						<div class="form-group">
							<label>{{ t('settings.maxConnectionsPerWindow') }}</label>
							<input v-model.number="config.safety.rateLimitMax" type="number" />
						</div>
					</div>
				</div>

				<div class="card">
					<div class="card-header">
						<h2>{{ t('settings.commandSettings') }}</h2>
					</div>
					<div class="switch-row">
						<span class="switch-label">{{ t('settings.enableRateLimit') }}</span>
						<label class="switch">
							<input id="enableRateLimit" type="checkbox" v-model="config.rateLimit.command.enabled" />
							<span class="slider"></span>
						</label>
					</div>
					<div class="form-row">
						<div class="form-group">
							<label>{{ t('settings.windowMsRate') }}</label>
							<input v-model.number="config.rateLimit.command.windowMs" type="number" />
						</div>
						<div class="form-group">
							<label>{{ t('settings.maxPerWindow') }}</label>
							<input v-model.number="config.rateLimit.command.maxPerWindow" type="number" />
						</div>
					</div>
					<div class="form-group" style="margin-top: 10px;">
						<label>{{ t('settings.commandMaxLength') }}</label>
						<input v-model.number="config.safety.commandMaxLength" type="number" />
					</div>
				</div>
			</div>

			<div v-if="activeTab === 'webui'" class="tab-panel">
				<div class="card">
					<div class="card-header">
						<h2>{{ t('settings.webui') }}</h2>
					</div>
					<div class="form-group">
						<label>{{ t('settings.httpPort') }}</label>
						<input v-model.number="config.web.port" type="number" />
					</div>
				</div>

				<div class="card">
					<div class="card-header">
						<h2>{{ t('settings.auth') }}</h2>
					</div>
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
						<span v-if="resetMessage" style="margin-left: 10px; font-size: 13px; color: #f87171;">{{ resetMessage }}</span>
					</div>
				</div>

				<div class="card">
					<div class="card-header">
						<h2>{{ t('settings.language') }}</h2>
					</div>
					<div class="form-row">
						<div class="form-group">
							<label>{{ t('settings.languageLabel') }}</label>
							<div style="display: flex; gap: 8px; margin-top: 4px;">
								<button
									v-for="loc in availableLocales"
									:key="loc"
									class="locale-btn"
									:class="{ active: locale === loc }"
									@click="setLocale(loc)"
								>
									{{ loc === 'zh-CN' ? '中文' : 'EN' }}
								</button>
							</div>
						</div>
					</div>
				</div>

				<div class="card">
					<div class="card-header">
						<h2>{{ t('settings.logs') }}</h2>
					</div>
					<div class="form-group">
						<label>{{ t('settings.logLevel') }}</label>
						<select v-model="config.logLevel">
							<option value="debug">{{ t('settings.debug') }}</option>
							<option value="info">{{ t('settings.info') }}</option>
							<option value="warning">{{ t('settings.warning') }}</option>
							<option value="error">{{ t('settings.error') }}</option>
						</select>
					</div>
				</div>
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

.switch {
	position: relative;
	display: inline-block;
	width: 42px;
	height: 24px;
	flex-shrink: 0;
	cursor: pointer;
}

.switch input {
	opacity: 0;
	width: 0;
	height: 0;
}

.slider {
	position: absolute;
	cursor: pointer;
	inset: 0;
	background: var(--border);
	transition: 0.2s;
	border-radius: 24px;
}

.slider::before {
	position: absolute;
	content: "";
	height: 18px;
	width: 18px;
	left: 3px;
	bottom: 3px;
	background: white;
	transition: 0.2s;
	border-radius: 50%;
}

input:checked + .slider {
	background: var(--primary);
}

input:checked + .slider::before {
	transform: translateX(18px);
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
	color: #fff;
}
</style>
