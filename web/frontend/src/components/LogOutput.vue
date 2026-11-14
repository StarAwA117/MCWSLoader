<script setup lang="ts">
import { ref } from "vue";

defineOptions({ name: "LogOutput" });

const props = defineProps<{
	lines: unknown[];
	// 传 height 时使用固定高度，否则用 maxHeight
	height?: string | null;
	maxHeight?: string | null;
	emptyText?: string;
	lineClass?: ((line: any) => string) | null;
	lineStyle?: string | Record<string, string> | null;
}>();

const el = ref<HTMLElement | null>(null);

function scrollToBottom(): void {
	if (el.value) el.value.scrollTop = el.value.scrollHeight;
}

defineExpose({ scrollToBottom, el });
</script>

<template>
	<div
		ref="el"
		class="log-viewer"
		:style="height ? { height } : (maxHeight ? { maxHeight } : null)"
	>
		<div v-if="lines.length === 0 && emptyText" style="color: var(--text-muted); text-align: center; padding: 40px;">
			{{ emptyText }}
		</div>
		<slot>
			<div
				v-for="(line, i) in lines"
				:key="i"
				class="log-line"
				:class="props.lineClass ? props.lineClass(line) : ''"
				:style="lineStyle"
			>{{ line }}</div>
		</slot>
	</div>
</template>
