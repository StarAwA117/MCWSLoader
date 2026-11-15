<script setup lang="ts">
import { ref, onMounted } from "vue";
import { api } from "../api";
import { useI18n } from "../composables/useI18n";
import LogOutput from "../components/LogOutput.vue";
import ServerOffNotice from "../components/ServerOffNotice.vue";
import { useServerStatus } from "../composables/useServerStatus";
import type { CommandOutputLine } from "../types";
import { userErrorText } from "../utils/errors";

const { t } = useI18n();
const { running: serverRunning } = useServerStatus();

const input = ref("");
const output = ref<CommandOutputLine[]>([]);
const loading = ref(false);

async function exec() {
	if (!serverRunning.value || !input.value.trim()) return;
	loading.value = true;
	const cmd = input.value.trim();
	output.value.push({ type: "input", text: cmd });
	try {
		const res = await api.execCommand(cmd);
		if (res.ok) {
			output.value.push({ type: "success", text: typeof res.result === "string" ? res.result : JSON.stringify(res.result, null, 2) ?? "" });
		} else {
			output.value.push({ type: "error", text: res.message || t("commands.failed") });
		}
		// Commands can produce large JSON responses; keep the visible history bounded.
		if (output.value.length > 500) output.value.splice(0, output.value.length - 500);
	} catch (e) {
		output.value.push({ type: "error", text: userErrorText(e) });
	}
	input.value = "";
	loading.value = false;
}

onMounted(() => { output.value = []; });
</script>

<template>
	<div class="card">
		<div class="card-header">
			<h2>{{ t('commands.title') }}</h2>
		</div>
		<ServerOffNotice :running="serverRunning" />

		<div style="display: flex; gap: 8px; margin-bottom: 16px;">
			<input
				v-model="input"
				type="text"
				:placeholder="t('commands.executePlaceholder')"
				@keydown.enter="exec"
				style="flex: 1; min-width: 0;"
				:disabled="!serverRunning"
			/>
			<button class="btn btn-primary btn-sm" @click="exec" :disabled="loading || !serverRunning">
				{{ loading ? t('commands.processing') : t('commands.execute') }}
			</button>
		</div>

		<LogOutput v-if="output.length" max-height="200px" :lines="output" class="command-output">
			<div v-for="(line, i) in output" :key="i" class="log-line" :class="line.type === 'error' ? 'error' : line.type === 'success' ? 'info' : ''">
				{{ line.type === 'input' ? '> ' : '' }}{{ line.text }}
			</div>
		</LogOutput>
	</div>
</template>

<style scoped>
.command-output {
	margin-bottom: 16px;
}
</style>
