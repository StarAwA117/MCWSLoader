<script setup>
import { ref, onMounted, onUnmounted } from "vue";
import { api, formatBytes } from "../api";
import { useModal } from "../composables/useModal";
import { useI18n } from "../composables/useI18n";

const { confirm, alert } = useModal();
const { t } = useI18n();

const status = ref(null);
const process = ref(null);
let timer = null;

function formatUptime(ms) {
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	const h = Math.floor(m / 60);
	const d = Math.floor(h / 24);
	if (d > 0) return d + t('time.day') + ' ' + (h % 24) + t('time.hour');
	if (h > 0) return h + t('time.hour') + ' ' + (m % 60) + t('time.minute');
	if (m > 0) return m + t('time.minute') + ' ' + (s % 60) + t('time.second');
	return s + t('time.second');
}

async function refresh() {
	try {
		const [s, p] = await Promise.all([api.getStatus(), api.getProcess()]);
		status.value = s;
		process.value = p;
	} catch {}
}

async function killProcess() {
	const ok = await confirm(t("dashboard.confirmKill"));
	if (!ok) return;
	const res = await api.killProcess();
	if (res.ok) await alert(res.message);
}

async function restartServer() {
	const ok = await confirm(t("dashboard.confirmRestart"));
	if (!ok) return;
	const res = await api.restartServer();
	if (res.ok) await alert(res.message);
}

onMounted(() => {
	refresh();
	timer = setInterval(refresh, 3000);
});

onUnmounted(() => clearInterval(timer));
</script>

<template>
	<div v-if="status">
		<div class="stats-grid">
			<div class="stat-card">
				<div class="label">{{ t('dashboard.serverStatus') }}</div>
				<div class="value blue">{{ t('dashboard.running') }}</div>
			</div>
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

		<div class="card">
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
								<span :class="c.isMain ? 'badge' : 'tag tag-user'">
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
