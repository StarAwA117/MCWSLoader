<script setup>
import { ref } from "vue";

defineOptions({ name: "LogOutput" });

const props = defineProps({
	lines: { type: Array, default: () => [] },
	// 传 height 时使用固定高度，否则用 maxHeight
	height: { type: String, default: null },
	maxHeight: { type: String, default: null },
	emptyText: { type: String, default: "" },
	lineClass: { type: Function, default: null },
	lineStyle: { type: [Object, String], default: null }
});

const el = ref(null);

function scrollToBottom() {
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
