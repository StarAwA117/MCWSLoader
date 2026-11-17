<script setup lang="ts">
import { ref, nextTick } from "vue";
import { api } from "../api";
import { useI18n } from "../composables/useI18n";
import { usePolling } from "../composables/usePolling";
import { userErrorText } from "../utils/errors";
import LogOutput from "../components/LogOutput.vue";

const { t } = useI18n();

const logLines = ref<string[]>([]);
const logRef = ref<InstanceType<typeof LogOutput> | null>(null);
const terminalInput = ref("");
const terminalError = ref("");
const terminalBusy = ref(false);

async function runTerminal(): Promise<void> {
	const command = terminalInput.value.trim();
	if (!command || terminalBusy.value) return;
	terminalBusy.value = true;
	terminalError.value = "";
	try {
		const res = await api.runTerminalCommand(command);
		if (!res.ok) {
			terminalError.value = res.message || t("logs.terminalFailed");
		} else {
			terminalInput.value = "";
			await refresh();
		}
	} catch (e) {
		terminalError.value = userErrorText(e);
	} finally {
		terminalBusy.value = false;
	}
}

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
				height="calc(100vh - 270px)"
				:empty-text="t('logs.none')"
				:line-class="lineClass"
			/>
			<div class="terminal-input">
				<input
					v-model="terminalInput"
					type="text"
					:placeholder="t('logs.terminalPlaceholder')"
					:disabled="terminalBusy"
					@keydown.enter="runTerminal"
				/>
				<button class="btn btn-primary btn-sm" :disabled="terminalBusy" @click="runTerminal">
					{{ t('logs.terminalSend') }}
				</button>
			</div>
			<p v-if="terminalError" class="terminal-error">{{ terminalError }}</p>
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

.terminal-input {
	display: flex;
	gap: 8px;
	padding: 12px 18px 16px;
	border-top: 1px solid var(--border);
	background: var(--bg-card-solid);
}

.terminal-input input {
	flex: 1;
	min-width: 0;
}

.terminal-error {
	margin: 0;
	padding: 0 18px 12px;
	color: var(--danger);
	font-size: 12px;
}

.logs-output {
	height: calc(100vh - 270px);
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
		height: calc(100vh - 250px);
		min-height: 300px;
		padding: 12px 14px;
	}
}
</style>
