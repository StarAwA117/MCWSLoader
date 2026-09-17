<script setup>
import { ref, onMounted, onUnmounted, nextTick } from "vue";
import { api } from "../api";
import { useI18n } from "../composables/useI18n";

const { t } = useI18n();

const messages = ref([]);
const input = ref("");
const chatRef = ref(null);
let timer = null;

async function refresh() {
	const res = await api.getChatLog();
	messages.value = res.lines || [];
	if (chatRef.value) chatRef.value.scrollTop = chatRef.value.scrollHeight;
}

async function send() {
	if (!input.value.trim()) return;
	const msg = input.value.trim();
	input.value = "";
	const res = await api.sendChat(msg);
	if (!res.ok) return;
	await refresh();
}

onMounted(() => {
	refresh();
	timer = setInterval(refresh, 2000);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
	<div class="card">
		<div class="card-header">
			<h2>{{ t('chat.title') }}</h2>
		</div>
		<div ref="chatRef" class="log-viewer" style="height: 400px; margin-bottom: 12px;">
			<div v-if="messages.length === 0" style="color: var(--text-muted); text-align: center; padding: 40px;">
				{{ t('chat.empty') }}
			</div>
			<div
				v-for="(msg, i) in messages"
				:key="i"
				class="log-line"
				style="color: #94a3b8;"
			>{{ msg }}</div>
		</div>
		<div style="display: flex; gap: 8px;">
			<input
				v-model="input"
				type="text"
				:placeholder="t('chat.placeholder')"
				@keydown.enter="send"
				style="flex: 1; min-width: 0;"
			/>
			<button class="btn btn-primary btn-sm" @click="send">{{ t('chat.send') }}</button>
		</div>
	</div>
</template>
