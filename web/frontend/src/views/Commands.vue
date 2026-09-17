<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api";
import { useI18n } from "../composables/useI18n";

const { t } = useI18n();

const input = ref("");
const output = ref([]);
const loading = ref(false);

async function exec() {
	if (!input.value.trim()) return;
	loading.value = true;
	const cmd = input.value.trim();
	output.value.push({ type: "input", text: cmd });
	try {
		const res = await api.execCommand(cmd);
		if (res.ok) {
			output.value.push({ type: "success", text: typeof res.result === "string" ? res.result : JSON.stringify(res.result, null, 2) });
		} else {
			output.value.push({ type: "error", text: res.message || t("commands.failed") });
		}
	} catch (e) {
		output.value.push({ type: "error", text: e.message });
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

		<div style="display: flex; gap: 8px; margin-bottom: 16px;">
			<input
				v-model="input"
				type="text"
				:placeholder="t('commands.executePlaceholder')"
				@keydown.enter="exec"
				style="flex: 1; min-width: 0;"
			/>
			<button class="btn btn-primary btn-sm" @click="exec" :disabled="loading">
				{{ loading ? t('commands.processing') : t('commands.execute') }}
			</button>
		</div>

		<div v-if="output.length" class="log-viewer" style="max-height: 200px; margin-bottom: 16px;">
			<div v-for="(line, i) in output" :key="i" class="log-line" :class="line.type === 'error' ? 'error' : line.type === 'success' ? 'info' : ''">
				{{ line.type === 'input' ? '> ' : '' }}{{ line.text }}
			</div>
		</div>
	</div>
</template>
