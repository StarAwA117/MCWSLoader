<script setup lang="ts">
import { ref, nextTick } from "vue";
import { api } from "../api";
import { useI18n } from "../composables/useI18n";
import { usePolling } from "../composables/usePolling";
import LogOutput from "../components/LogOutput.vue";

const { t } = useI18n();

const logLines = ref<string[]>([]);
const logRef = ref<InstanceType<typeof LogOutput> | null>(null);

async function refresh() {
	const el = logRef.value?.el as HTMLElement | null | undefined;
	// Follow new lines only when the reader is already near the bottom.
	const follow = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 48;
	const res = await api.getLogs("app", 300);
	logLines.value = Array.isArray(res.lines) ? (res.lines as string[]) : [];
	if (follow) {
		await nextTick();
		logRef.value?.scrollToBottom();
	}
}

function lineClass(line: string): string {
	if (line.includes("[error]")) return "error";
	if (line.includes("[warning]")) return "warning";
	if (line.includes("[debug]")) return "debug";
	return "info";
}

usePolling(refresh, 2000);
</script>

<template>
	<div class="logs-page">
		<div class="card logs-card">
			<div class="card-header logs-header">
				<h2>{{ t('logs.title') }}</h2>
				<span class="logs-live">
					<span class="logs-live-dot" aria-hidden="true"></span>
					{{ t('logs.live') }}
				</span>
			</div>
			<LogOutput
				ref="logRef"
				class="logs-output"
				:lines="logLines"
				height="calc(100vh - 200px)"
				:empty-text="t('logs.none')"
				:line-class="lineClass"
			/>
		</div>
	</div>
</template>

<style scoped>
.logs-page {
	display: flex;
	flex-direction: column;
	min-height: 0;
}

.logs-card {
	display: flex;
	flex-direction: column;
	padding: 0;
	overflow: hidden;
}

.logs-header {
	margin: 0;
	padding: 16px 20px;
	flex-shrink: 0;
}

.logs-live {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	font-size: 11px;
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--text-muted);
}

.logs-live-dot {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: var(--primary);
	box-shadow: 0 0 0 3px var(--primary-dim);
	animation: live-pulse 2.4s ease-in-out infinite;
}

.logs-output {
	height: calc(100vh - 200px);
	max-height: none;
	min-height: 360px;
	border: 0;
	border-radius: 0;
	padding: 14px 18px;
}

@keyframes live-pulse {
	50% { opacity: 0.55; }
}

@media (prefers-reduced-motion: reduce) {
	.logs-live-dot { animation: none; }
}

@media (max-width: 600px) {
	.logs-header { padding: 14px 16px; }
	.logs-output {
		height: calc(100vh - 180px);
		min-height: 300px;
		padding: 12px 14px;
	}
}
</style>
