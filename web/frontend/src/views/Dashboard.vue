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
		<div class="stats-grid">
			<div class="stat-card toggle-card" @click="toggleWebSocket">
				<div class="label">{{ t('dashboard.serverStatus') }}</div>
				<div class="value" :class="wsRunning ? 'blue' : 'off'">{{ wsRunning ? t('dashboard.running') : startingWebSocket ? t('dashboard.serverStarting') : stoppingWebSocket ? t('dashboard.serverStopping') : t('dashboard.serverStopped') }}</div>
			</div>
			<template v-if="wsRunning">
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
			</template>
			<div v-else class="stat-card">
				<div class="label">{{ t('dashboard.webuiPort') }}</div>
				<div class="value">{{ status.server.webPort }}</div>
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
.toggle-card {
	cursor: pointer;
}

.stat-card .value.off {
	color: var(--text-secondary);
}
</style>
