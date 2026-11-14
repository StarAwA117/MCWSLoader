<script setup lang="ts">
import { ref, nextTick } from "vue";
import { api } from "../api";
import { useI18n } from "../composables/useI18n";
import { usePolling } from "../composables/usePolling";
import LogOutput from "../components/LogOutput.vue";

const { t } = useI18n();

const messages = ref<string[]>([]);
const input = ref("");
const chatRef = ref<InstanceType<typeof LogOutput> | null>(null);

async function refresh() {
	const res = await api.getChatLog();
	messages.value = Array.isArray(res.lines) ? (res.lines as string[]) : [];
	await nextTick();
	chatRef.value?.scrollToBottom();
}

async function send() {
	if (!input.value.trim()) return;
	const msg = input.value.trim();
	input.value = "";
	const res = await api.sendChat(msg);
	if (!res.ok) return;
	await refresh();
}

usePolling(refresh, 2000);
</script>

<template>
	<div class="card">
		<div class="card-header">
			<h2>{{ t('chat.title') }}</h2>
		</div>
		<LogOutput
			ref="chatRef"
			:lines="messages"
			height="400px"
			:empty-text="t('chat.empty')"
			line-style="color: var(--text-muted);"
			class="chat-output"
		/>
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

<style scoped>
/* 原内联样式等价类：保持 12px 底部间距 */
.chat-output {
	margin-bottom: 12px;
}
</style>
