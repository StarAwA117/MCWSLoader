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
					<path fill="currentColor" d="M 50 5 C 53.49 5 56.73 9.88 60.48 10.88 C 64.23 11.88 69.47 9.28 72.5 11.03 C 75.53 12.78 75.89 18.62 78.64 21.36 C 81.38 24.11 87.22 24.47 88.97 27.5 C 90.72 30.53 88.12 35.77 89.12 39.52 C 90.12 43.27 95 46.51 95 50 C 95 53.49 90.12 56.73 89.12 60.48 C 88.12 64.23 90.72 69.47 88.97 72.5 C 87.22 75.53 81.38 75.89 78.64 78.64 C 75.89 81.38 75.53 87.22 72.5 88.97 C 69.47 90.72 64.23 88.12 60.48 89.12 C 56.73 90.12 53.49 95 50 95 C 46.51 95 43.27 90.12 39.52 89.12 C 35.77 88.12 30.53 90.72 27.5 88.97 C 24.47 87.22 24.11 81.38 21.36 78.64 C 18.62 75.89 12.78 75.53 11.03 72.5 C 9.28 69.47 11.88 64.23 10.88 60.48 C 9.88 56.73 5 53.49 5 50 C 5 46.51 9.88 43.27 10.88 39.52 C 11.88 35.77 9.28 30.53 11.03 27.5 C 12.78 24.47 18.62 24.11 21.36 21.36 C 24.11 18.62 24.47 12.78 27.5 11.03 C 30.53 9.28 35.77 11.88 39.52 10.88 C 43.27 9.88 46.51 5 50 5 Z"/>
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
	padding: 26px 116px 26px 22px;
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
	top: 8px;
	right: 12px;
	width: 92px;
	height: 92px;
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
	color: var(--text-muted);
	transition: color var(--dur-base);
}

.service-card.running .service-action {
	color: var(--primary);
}

.service-action svg {
	width: 18px;
	height: 18px;
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
