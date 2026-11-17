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

usePolling(refresh, 5000);
</script>

<template>
	<div v-if="status">
		<div
			class="service-card"
			:class="{ running: wsRunning, busy: startingWebSocket || stoppingWebSocket }"
			role="button"
			tabindex="0"
			:aria-pressed="wsRunning"
			:aria-busy="startingWebSocket || stoppingWebSocket"
			@click="toggleWebSocket"
			@keydown.enter.prevent="toggleWebSocket"
			@keydown.space.prevent="toggleWebSocket"
		>
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
			<div class="service-toggle" aria-hidden="true">
				<svg class="service-badge" viewBox="0 0 100 100">
					<path fill="currentColor" d="M 50 4.8 C 51.27 4.8 52.63 5.66 53.8 6.57 C 54.97 7.47 55.98 9.22 57.02 10.21 C 58.06 11.21 58.91 12.22 60.04 12.52 C 61.18 12.83 62.42 12.38 63.82 12.04 C 65.21 11.7 66.96 10.68 68.43 10.48 C 69.89 10.29 71.5 10.22 72.6 10.86 C 73.7 11.49 74.45 12.92 75.01 14.28 C 75.57 15.65 75.56 17.67 75.97 19.05 C 76.37 20.43 76.61 21.73 77.44 22.56 C 78.27 23.39 79.57 23.63 80.95 24.03 C 82.33 24.44 84.35 24.43 85.72 24.99 C 87.08 25.55 88.51 26.3 89.14 27.4 C 89.78 28.5 89.71 30.11 89.52 31.57 C 89.32 33.04 88.3 34.79 87.96 36.18 C 87.62 37.58 87.17 38.82 87.48 39.96 C 87.78 41.09 88.79 41.94 89.79 42.98 C 90.78 44.02 92.53 45.03 93.43 46.2 C 94.34 47.37 95.2 48.73 95.2 50 C 95.2 51.27 94.34 52.63 93.43 53.8 C 92.53 54.97 90.78 55.98 89.79 57.02 C 88.79 58.06 87.78 58.91 87.48 60.04 C 87.17 61.18 87.62 62.42 87.96 63.82 C 88.3 65.21 89.32 66.96 89.52 68.43 C 89.71 69.89 89.78 71.5 89.14 72.6 C 88.51 73.7 87.08 74.45 85.72 75.01 C 84.35 75.57 82.33 75.56 80.95 75.97 C 79.57 76.37 78.27 76.61 77.44 77.44 C 76.61 78.27 76.37 79.57 75.97 80.95 C 75.56 82.33 75.57 84.35 75.01 85.72 C 74.45 87.08 73.7 88.51 72.6 89.14 C 71.5 89.78 69.89 89.71 68.43 89.52 C 66.96 89.32 65.21 88.3 63.82 87.96 C 62.42 87.62 61.18 87.17 60.04 87.48 C 58.91 87.78 58.06 88.79 57.02 89.79 C 55.98 90.78 54.97 92.53 53.8 93.43 C 52.63 94.34 51.27 95.2 50 95.2 C 48.73 95.2 47.37 94.34 46.2 93.43 C 45.03 92.53 44.02 90.78 42.98 89.79 C 41.94 88.79 41.09 87.78 39.96 87.48 C 38.82 87.17 37.58 87.62 36.18 87.96 C 34.79 88.3 33.04 89.32 31.57 89.52 C 30.11 89.71 28.5 89.78 27.4 89.14 C 26.3 88.51 25.55 87.08 24.99 85.72 C 24.43 84.35 24.44 82.33 24.03 80.95 C 23.63 79.57 23.39 78.27 22.56 77.44 C 21.73 76.61 20.43 76.37 19.05 75.97 C 17.67 75.56 15.65 75.57 14.28 75.01 C 12.92 74.45 11.49 73.7 10.86 72.6 C 10.22 71.5 10.29 69.89 10.48 68.43 C 10.68 66.96 11.7 65.21 12.04 63.82 C 12.38 62.42 12.83 61.18 12.52 60.04 C 12.22 58.91 11.21 58.06 10.21 57.02 C 9.22 55.98 7.47 54.97 6.57 53.8 C 5.66 52.63 4.8 51.27 4.8 50 C 4.8 48.73 5.66 47.37 6.57 46.2 C 7.47 45.03 9.22 44.02 10.21 42.98 C 11.21 41.94 12.22 41.09 12.52 39.96 C 12.83 38.82 12.38 37.58 12.04 36.18 C 11.7 34.79 10.68 33.04 10.48 31.57 C 10.29 30.11 10.22 28.5 10.86 27.4 C 11.49 26.3 12.92 25.55 14.28 24.99 C 15.65 24.43 17.67 24.44 19.05 24.03 C 20.43 23.63 21.73 23.39 22.56 22.56 C 23.39 21.73 23.63 20.43 24.03 19.05 C 24.44 17.67 24.43 15.65 24.99 14.28 C 25.55 12.92 26.3 11.49 27.4 10.86 C 28.5 10.22 30.11 10.29 31.57 10.48 C 33.04 10.68 34.79 11.7 36.18 12.04 C 37.58 12.38 38.82 12.83 39.96 12.52 C 41.09 12.22 41.94 11.21 42.98 10.21 C 44.02 9.22 45.03 7.47 46.2 6.57 C 47.37 5.66 48.73 4.8 50 4.8 Z"/>
				</svg>
				<div class="service-action">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/>
						<line x1="12" y1="2" x2="12" y2="12"/>
					</svg>
				</div>
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

		<div v-if="!status.server.standalone" class="card">
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
	padding: 24px 122px 24px 24px;
	min-height: 132px;
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
	-webkit-tap-highlight-color: transparent;
	user-select: none;
	touch-action: manipulation;
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

.service-card.busy {
	cursor: wait;
	opacity: 0.85;
}

.service-card:active {
	transform: scale(0.995);
	transition-duration: 80ms;
}

@media (hover: hover) {
	.service-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 18px 42px rgba(0, 0, 0, 0.10);
	}

	.service-card.running:hover {
		box-shadow: 0 22px 55px rgba(96, 165, 250, 0.18);
	}
}

.service-card:focus-visible {
	outline: 2px solid var(--text-muted);
	outline-offset: 2px;
}

.service-toggle {
	position: absolute;
	top: -55px;
	right: -55px;
	width: 160px;
	height: 160px;
	display: grid;
	place-items: center;
	z-index: 1;
}

.service-badge {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	color: var(--badge);
	transform-origin: center;
	pointer-events: none;
	z-index: 0;
	transition: color var(--dur-base) var(--ease-out);
}

.service-card.running .service-badge {
	color: var(--badge-active);
	animation: badge-sway 7s ease-in-out infinite;
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
	transition: background var(--dur-base) var(--ease-out);
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
	transition: color var(--dur-base) var(--ease-out);
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
	position: relative;
	z-index: 1;
	width: 100%;
	height: 100%;
	display: grid;
	place-items: center;
	color: var(--badge-icon);
	transition: color var(--dur-base) var(--ease-out);
}

.service-card.running .service-action {
	color: var(--badge-icon-active);
}

.service-action svg {
	width: 26px;
	height: 26px;
}

@keyframes badge-sway {
	0%, 100% { transform: rotate(0deg) scale(1); }
	50% { transform: rotate(1.5deg) scale(1.015); }
}

@media (prefers-reduced-motion: reduce) {
	.service-card,
	.service-badge,
	.service-dot,
	.service-value,
	.service-action { transition: none; }
	.service-card.running .service-badge { animation: none; }
	.service-card:hover,
	.service-card:active { transform: none; }
}
</style>
