<script setup>
import { ref, nextTick } from "vue";
import { api } from "../api";
import { useI18n } from "../composables/useI18n";
import { usePolling } from "../composables/usePolling";
import LogOutput from "../components/LogOutput.vue";

const { t } = useI18n();

const logType = ref("app");
const logLines = ref([]);
const autoScroll = ref(true);
const logRef = ref(null);

async function refresh() {
	const res = await api.getLogs(logType.value, 300);
	logLines.value = res.lines || [];
	if (autoScroll.value) {
		// 等 DOM 更新后再滚动到底部
		await nextTick();
		logRef.value?.scrollToBottom();
	}
}

function setLogType(type) {
	logType.value = type;
	refresh();
}

function lineClass(line) {
	if (line.includes("[error]")) return "error";
	if (line.includes("[warning]")) return "warning";
	if (line.includes("[debug]")) return "debug";
	return "info";
}

usePolling(refresh, 2000);
</script>

<template>
	<div class="card">
		<div class="card-header">
			<h2>{{ t('logs.title') }}</h2>
			<div class="btn-group">
				<button
					class="btn btn-sm"
					:class="logType === 'app' ? 'btn-primary' : 'btn-ghost'"
					@click="setLogType('app')"
				>{{ t('logs.app') }}</button>
				<button
					class="btn btn-sm"
					:class="logType === 'message' ? 'btn-primary' : 'btn-ghost'"
					@click="setLogType('message')"
				>{{ t('logs.message') }}</button>
				<button
					class="btn btn-sm"
					:class="autoScroll ? 'btn-success' : 'btn-ghost'"
					@click="autoScroll = !autoScroll"
				>{{ autoScroll ? t('logs.autoScroll') : t('logs.manualScroll') }}</button>
			</div>
		</div>

		<LogOutput
			ref="logRef"
			:lines="logLines"
			height="500px"
			:empty-text="t('logs.none')"
			:line-class="lineClass"
		/>
	</div>
</template>
