<script setup lang="ts">
import { ref } from "vue";
import { api } from "../api";
import { useModal } from "../composables/useModal";
import { useI18n } from "../composables/useI18n";
import { usePolling } from "../composables/usePolling";
import ModalShell from "../components/ModalShell.vue";
import type { ClientInfo } from "../types";

const { alert, confirm } = useModal();
const { t } = useI18n();

const clients = ref<ClientInfo[]>([]);
const selected = ref<ClientInfo | null>(null);
const showDetail = ref(false);

async function refresh() {
	const data = await api.getClients();
	clients.value = Array.isArray(data) ? (data as unknown as ClientInfo[]) : [];
}

function openDetail(c: ClientInfo): void {
	selected.value = c;
	showDetail.value = true;
}

async function setMain() {
	if (!selected.value) return;
	const res = await api.setMainClient(selected.value.id);
	if (res.ok) { showDetail.value = false; await refresh(); }
	else await alert(res.message ?? "");
}

async function disconnect() {
	if (!selected.value) return;
	const name = selected.value.localPlayerName || selected.value.id.slice(0, 8);
	const ok = await confirm(t("clients.confirmDisconnect", { name }));
	if (!ok) return;
	const res = await api.disconnectClient(selected.value.id);
	if (res.ok) { showDetail.value = false; await refresh(); }
	else await alert(res.message ?? "");
}

usePolling(refresh, 3000);
</script>

<template>
	<div class="card">
		<div class="card-header">
			<h2>{{ t('clients.title') }}</h2>
			<span class="badge">{{ clients.length }} {{ t('clients.count') }}</span>
		</div>

		<div v-if="clients.length === 0" class="empty-state">
			<p>{{ t('clients.none') }}</p>
		</div>

		<div v-else>
			<div
				v-for="(c, index) in clients"
				:key="c.id"
				class="client-card"
				:style="{ '--i': Math.min(index, 6) }"
				@click="openDetail(c)"
			>
				<div style="flex: 1;">
					<div style="font-weight: 500; font-size: 14px;">
						{{ c.localPlayerName || t('clients.unnamed') }}
						<span v-if="c.isMain" class="badge" style="margin-left: 6px;">{{ t('clients.mainClient') }}</span>
					</div>
					<div class="client-meta">
						<span>IP: {{ c.ip }}</span>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- 客户端详情弹窗 -->
	<Transition name="modal-pop">
	<ModalShell v-if="showDetail && selected" max-width="420px" @close="showDetail = false">
		<template #title>{{ t('clients.detail') }}</template>
		<div class="detail-row"><span class="detail-label">{{ t('clients.name') }}</span><span>{{ selected.localPlayerName || t('clients.unnamed') }}</span></div>
		<div class="detail-row"><span class="detail-label">IP</span><span style="font-family: monospace;">{{ selected.ip }}</span></div>
		<div class="detail-row"><span class="detail-label">{{ t('clients.uuid') }}</span><span style="font-family: monospace; font-size: 12px;">{{ selected.id }}</span></div>
		<div class="detail-row"><span class="detail-label">{{ t('clients.role') }}</span><span :class="selected.isMain ? 'badge' : 'tag tag-user'">{{ selected.isMain ? t('clients.mainClient') : t('clients.normal') }}</span></div>
		<div class="detail-row"><span class="detail-label">{{ t('clients.connectedAt') }}</span><span>{{ new Date(selected.connectedAt).toLocaleString() }}</span></div>
		<template #footer>
			<button v-if="!selected.isMain" class="btn btn-primary btn-sm" @click="setMain">{{ t('clients.switch') }}</button>
			<button class="btn btn-danger btn-sm" @click="disconnect">{{ t('clients.disconnect') }}</button>
		</template>
	</ModalShell>
	</Transition>
</template>

<style scoped>
.client-card {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px;
	background: var(--bg-input);
	border-radius: 8px;
	margin-bottom: 8px;
	cursor: pointer;
	transition: background 0.15s;
}
.client-card:hover { background: var(--border); transform: translate3d(2px, 0, 0); }

.client-meta {
	font-size: 12px;
	color: var(--text-muted);
	margin-top: 2px;
}

.detail-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 8px 0;
	border-bottom: 1px solid var(--border);
	font-size: 14px;
}
.detail-row:last-child { border-bottom: none; }
.detail-label {
	color: var(--text-muted);
	font-size: 13px;
}
</style>
