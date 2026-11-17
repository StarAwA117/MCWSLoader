<script setup lang="ts">
import { ref, nextTick } from "vue";
import { api } from "../api";
import { useI18n } from "../composables/useI18n";
import { usePolling } from "../composables/usePolling";
import LogOutput from "../components/LogOutput.vue";
import ServerOffNotice from "../components/ServerOffNotice.vue";
import { useServerStatus } from "../composables/useServerStatus";
import { useModal } from "../composables/useModal";
import { userErrorText } from "../utils/errors";

const { t } = useI18n();
const { notify } = useModal();
const { running: serverRunning } = useServerStatus();

const messages = ref<string[]>([]);
const input = ref("");
const chatRef = ref<InstanceType<typeof LogOutput> | null>(null);

async function refresh() {
	const el = chatRef.value?.el as HTMLElement | null | undefined;
	const follow = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 48;
	const res = await api.getChatLog();
	messages.value = Array.isArray(res.lines) ? (res.lines as string[]) : [];
	if (follow) {
		await nextTick();
		chatRef.value?.scrollToBottom();
	}
}

async function send() {
	if (!serverRunning.value || !input.value.trim()) return;
	const msg = input.value.trim();
	input.value = "";
	try {
		const res = await api.sendChat(msg);
		if (!res.ok) {
			input.value = msg;
			await notify(res.message || t("chat.sendFailed"));
			return;
		}
		await refresh().catch(() => {});
	} catch (e) {
		input.value = msg;
		await notify(userErrorText(e));
	}
}

usePolling(refresh, 3000);
</script>

<template>
	<div class="card">
		<div class="card-header">
			<h2>{{ t('chat.title') }}</h2>
		</div>
		<ServerOffNotice :running="serverRunning" />
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
				:disabled="!serverRunning"
			/>
			<button class="btn btn-primary btn-sm" @click="send" :disabled="!serverRunning">{{ t('chat.send') }}</button>
		</div>
	</div>
</template>

<style scoped>
/* 原内联样式等价类：保持 12px 底部间距 */
.chat-output {
	margin-bottom: 12px;
}
</style>
