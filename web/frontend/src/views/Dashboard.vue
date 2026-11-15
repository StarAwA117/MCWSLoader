<script setup lang="ts">
import { computed, ref } from "vue";
import { api } from "../api";
import { formatBytes, formatDuration } from "../utils/format";
import { useModal } from "../composables/useModal";
import { usePolling } from "../composables/usePolling";
import { useI18n } from "../composables/useI18n";
import { userErrorText } from "../utils/errors";
import type { ProcessInfo, ServerStatus } from "../types";

const { ask, notify } = useModal();
const { t } = useI18n();

const status = ref<ServerStatus | null>(null);
const process = ref<ProcessInfo | null>(null);
const startingWebSocket = ref(false);
const stoppingWebSocket = ref(false);

const wsRunning = computed(() => status.value?.server.websocketRunning !== false);

const formatUptime = (ms: number): string => formatDuration(ms, t);

async function refresh() {
	try {
		const [s, p] = await Promise.all([api.getStatus(), api.getProcess()]);
		if (s && typeof s === "object" && "server" in s) status.value = s as unknown as ServerStatus;
		if (p && typeof p === "object" && "pid" in p) process.value = p as unknown as ProcessInfo;
	} catch {}
}

async function toggleWebSocket(): Promise<void> {
	if (startingWebSocket.value || stoppingWebSocket.value) return;
	if (wsRunning.value) {
		stoppingWebSocket.value = true;
		try {
			const res = await api.stopWebSocket();
			if (!res.ok) await notify(res.message || t("dashboard.serverStopFailed"));
			await refresh();
		} catch (e) {
			await notify(userErrorText(e));
		}
		stoppingWebSocket.value = false;
		return;
	}
	startingWebSocket.value = true;
	try {
		const res = await api.startWebSocket();
		if (!res.ok) await notify(res.message || t("dashboard.serverStartFailed"));
		await refresh();
	} catch (e) {
		await notify(userErrorText(e));
	}
	startingWebSocket.value = false;
}

async function killProcess() {
	const ok = await ask(t("dashboard.confirmKill"));
	if (!ok) return;
	const res = await api.killProcess();
	if (res.ok) await notify(res.message ?? "");
}

async function restartServer() {
	const ok = await ask(t("dashboard.confirmRestart"));
	if (!ok) return;
	const res = await api.restartServer();
	if (res.ok) await notify(res.message ?? "");
}

usePolling(refresh, 3000);
</script>

<template>
	<div v-if="status">
		<div
			class="service-card"
			:class="{ running: wsRunning, busy: startingWebSocket || stoppingWebSocket }"
			role="button"
			tabindex="0"
			:aria-pressed="wsRunning"
			@click="toggleWebSocket"
			@keydown.enter.prevent="toggleWebSocket"
			@keydown.space.prevent="toggleWebSocket"
		>
			<svg class="service-petal" viewBox="0 0 120 120" aria-hidden="true">
				<g fill="currentColor">
					<path d="M60 7c12 0 22 10 22 22 0 13-10 24-22 33-12-9-22-20-22-33 0-12 10-22 22-22Z"/>
					<path d="M60 7c12 0 22 10 22 22 0 13-10 24-22 33-12-9-22-20-22-33 0-12 10-22 22-22Z" transform="rotate(90 60 60)"/>
					<path d="M60 7c12 0 22 10 22 22 0 13-10 24-22 33-12-9-22-20-22-33 0-12 10-22 22-22Z" transform="rotate(180 60 60)"/>
					<path d="M60 7c12 0 22 10 22 22 0 13-10 24-22 33-12-9-22-20-22-33 0-12 10-22 22-22Z" transform="rotate(270 60 60)"/>
				</g>
			</svg>
			<div class="service-copy">
				<div class="service-label"><span class="service-dot"></span>{{ t('dashboard.serverStatus') }}</div>
				<div class="service-value">
					{{ wsRunning ? t('dashboard.running') : startingWebSocket ? t('dashboard.serverStarting') : stoppingWebSocket ? t('dashboard.serverStopping') : t('dashboard.serverStopped') }}
				</div>
				<div class="service-meta">
					<span v-if="wsRunning">WebSocket {{ status.server.wsPort }}</span>
					<span>WebUI {{ status.server.webPort }}</span>
				</div>
			</div>
			<div class="service-action" aria-hidden="true">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
					<line x1="12" y1="2" x2="12" y2="12"/>
				</svg>
			</div>
		</div>

		<div v-if="wsRunning" class="stats-grid">
			<div class="stat-card">
				<div class="label">{{ t('dashboard.uptime') }}</div>
				<div class="value blue">{{ formatUptime(status.server.uptime) }}</div>
			</div>
			<div class="stat-card">
				<div class="label">{{ t('dashboard.connectedClients') }}</div>
				<div class="value">{{ status.connections.count }}</div>
			</div>
			<div class="stat-card">
				<div class="label">{{ t('dashboard.wsPort') }}</div>
				<div class="value">{{ status.server.wsPort }}</div>
			</div>
		</div>

		<div v-if="wsRunning" class="card">
			<div class="card-header">
				<h2>{{ t('dashboard.connectedClientsTitle') }}</h2>
				<span class="badge">{{ status.connections.count }} {{ t('dashboard.count') }}</span>
			</div>
			<div v-if="status.connections.clients.length === 0" class="empty-state">
				<p>{{ t('dashboard.noClients') }}</p>
			</div>
			<div v-else class="table-wrap">
				<table>
					<thead>
						<tr>
							<th>{{ t('dashboard.id') }}</th>
							<th>{{ t('dashboard.ip') }}</th>
							<th>{{ t('dashboard.role') }}</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="c in status.connections.clients" :key="c.id">
							<td style="font-family: monospace; font-size: 12px;">{{ c.id.slice(0, 8) }}...</td>
							<td>{{ c.ip }}</td>
							<td>
								<span v-if="!c.trusted" class="tag tag-blocker">{{ t('clients.pending') }}</span>
								<span v-else :class="c.isMain ? 'badge' : 'tag tag-user'">
									{{ c.isMain ? t('dashboard.mainClient') : t('dashboard.normal') }}
								</span>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>

		<div class="card">
			<div class="card-header">
				<h2>{{ t('dashboard.loadedMods') }}</h2>
			</div>
			<div class="form-row">
				<div>
					<label style="color: var(--text-muted); font-size: 12px; margin-bottom: 6px; display: block;">{{ t('dashboard.serverMods') }}</label>
					<div v-if="status.mods.server.length === 0" style="color: var(--text-muted); font-size: 13px;">{{ t('dashboard.none') }}</div>
					<div v-else style="display: flex; flex-wrap: wrap; gap: 6px;">
						<span v-for="m in status.mods.server" :key="m" class="tag tag-op">{{ m }}</span>
					</div>
				</div>
				<div>
					<label style="color: var(--text-muted); font-size: 12px; margin-bottom: 6px; display: block;">{{ t('dashboard.clientMods') }}</label>
					<div v-if="status.mods.client.length === 0" style="color: var(--text-muted); font-size: 13px;">{{ t('dashboard.none') }}</div>
					<div v-else style="display: flex; flex-wrap: wrap; gap: 6px;">
						<span v-for="m in status.mods.client" :key="m" class="tag tag-user">{{ m }}</span>
					</div>
				</div>
			</div>
		</div>

		<div v-if="process" class="card">
			<div class="card-header">
				<h2>{{ t('dashboard.processInfo') }}</h2>
			</div>
			<div class="stats-grid">
				<div class="stat-card">
					<div class="label">{{ t('dashboard.pid') }}</div>
					<div class="value">{{ process.pid }}</div>
				</div>
				<div class="stat-card">
					<div class="label">{{ t('dashboard.memoryUsage') }}</div>
					<div class="value blue">{{ formatBytes(process.memory.rss) }}</div>
				</div>
				<div class="stat-card">
					<div class="label">{{ t('dashboard.heapMemory') }}</div>
					<div class="value">{{ formatBytes(process.memory.heapUsed) }}</div>
				</div>
				<div class="stat-card">
					<div class="label">{{ t('dashboard.nodeJs') }}</div>
					<div class="value" style="font-size: 16px;">{{ process.nodeVersion }}</div>
				</div>
			</div>
		</div>

		<div class="card">
			<div class="card-header">
				<h2>{{ t('dashboard.serverControl') }}</h2>
			</div>
			<div style="display: flex; gap: 8px;">
				<button class="btn btn-primary btn-sm" @click="restartServer">{{ t('dashboard.restartServer') }}</button>
				<button class="btn btn-primary btn-sm" @click="killProcess">{{ t('dashboard.killProcess') }}</button>
			</div>
		</div>
	</div>
	<div v-else class="empty-state">
		<p>{{ t('dashboard.loading') }}</p>
	</div>
</template>

<style scoped>
.service-card {
	position: relative;
	display: flex;
	align-items: center;
	gap: 18px;
	padding: 20px 22px;
	margin-bottom: 16px;
	border: 1px solid var(--glass-border);
	border-radius: 18px;
	background: var(--glass-bg);
	box-shadow: var(--glass-shadow);
	backdrop-filter: blur(var(--glass-blur)) saturate(1.35);
	-webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.35);
	overflow: hidden;
	isolation: isolate;
	cursor: pointer;
	transition: transform var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out);
}

.service-card::before {
	content: "";
	position: absolute;
	inset: 0;
	background: radial-gradient(circle at 18% 0%, var(--glass-border), transparent 58%);
	opacity: 0.55;
	pointer-events: none;
	z-index: -1;
}

.service-card:hover {
	transform: translateY(-2px);
	box-shadow: 0 18px 42px rgba(0, 0, 0, 0.10);
}

.service-card.running:hover {
	box-shadow: 0 22px 55px rgba(96, 165, 250, 0.18);
}

.service-card:focus-visible {
	outline: 2px solid var(--primary);
	outline-offset: 2px;
}

.service-petal {
	position: absolute;
	top: -44px;
	left: -36px;
	width: 142px;
	height: 142px;
	color: var(--petal);
	pointer-events: none;
	z-index: -1;
}

.service-copy {
	flex: 1;
	min-width: 0;
}

.service-label {
	display: flex;
	align-items: center;
	gap: 7px;
	font-size: 11px;
	font-weight: 650;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--text-muted);
}

.service-dot {
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: var(--text-muted);
}

.service-card.running .service-dot {
	background: var(--primary);
}

.service-value {
	margin-top: 2px;
	font-size: 1.35rem;
	font-weight: 700;
	letter-spacing: -0.03em;
	color: var(--text);
}

.service-card.running .service-value {
	color: var(--primary);
}

.service-meta {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	margin-top: 4px;
	font-size: 12px;
	color: var(--text-muted);
}

.service-action {
	width: 42px;
	height: 42px;
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 50%;
	border: 1px solid var(--glass-border);
	background: rgba(255, 255, 255, 0.32);
	color: var(--text-muted);
	transition: color var(--dur-base), background var(--dur-base);
}

.service-card.running .service-action {
	color: var(--primary);
	background: var(--primary-glow);
}

.service-action svg {
	width: 18px;
	height: 18px;
}

@media (prefers-reduced-motion: reduce) {
	.service-card { transition: none; }
}
</style>
