<script setup lang="ts">
defineOptions({ name: "ModalShell" });

defineProps({
	maxWidth: { type: String, default: null }
});

const emit = defineEmits(["close"]);
</script>

<template>
	<div class="modal-overlay" @click.self="emit('close')">
		<div class="modal" :style="maxWidth ? { maxWidth } : null">
			<div class="modal-header">
				<h3><slot name="title" /></h3>
				<button class="modal-close" @click="emit('close')">×</button>
			</div>
			<div class="modal-body">
				<slot />
			</div>
			<div v-if="$slots.footer" class="modal-footer">
				<slot name="footer" />
			</div>
		</div>
	</div>
</template>
