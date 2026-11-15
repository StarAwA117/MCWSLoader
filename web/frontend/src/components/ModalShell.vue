<script setup lang="ts">
import { onMounted, onBeforeUnmount } from "vue";
import { useScrollLock } from "../composables/useScrollLock";

defineOptions({ name: "ModalShell" });

defineProps({
	maxWidth: { type: String, default: null }
});

const emit = defineEmits(["close"]);
const { lock, unlock } = useScrollLock();

function onKeydown(event: KeyboardEvent): void {
	if (event.key === "Escape") {
		event.preventDefault();
		emit("close");
	}
}

onMounted(() => {
	lock();
	document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
	document.removeEventListener("keydown", onKeydown);
	unlock();
});
</script>

<template>
	<div class="modal-overlay" @click.self="emit('close')">
		<div class="modal" role="dialog" aria-modal="true" :style="maxWidth ? { maxWidth } : null">
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
