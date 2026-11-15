<script setup lang="ts">
import { useI18n } from "../composables/useI18n";

defineProps<{ running: boolean }>();
const { t } = useI18n();
</script>

<template>
	<div v-if="!running" class="server-off-notice">
		<span>{{ t('webui.offNotice') }}</span>
		<router-link to="/">{{ t('webui.goDashboard') }}</router-link>
	</div>
</template>

<style scoped>
.server-off-notice {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	flex-wrap: wrap;
	padding: 10px 14px;
	margin-bottom: 14px;
	border: 1px solid var(--border);
	border-radius: var(--radius);
	background: var(--bg-input);
	color: var(--text-secondary);
	font-size: 13px;
}

.server-off-notice a {
	color: var(--text);
	font-weight: 600;
	white-space: nowrap;
}
</style>
