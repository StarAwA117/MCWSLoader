<script setup lang="ts">
defineOptions({ name: "SwitchToggle" });

defineProps<{
	modelValue?: boolean;
	disabled?: boolean;
	id?: string;
}>();

const emit = defineEmits<{
	"update:modelValue": [value: boolean];
	"change": [event: Event];
}>();

function onChange(event: Event): void {
	const target = event.target as HTMLInputElement;
	emit("update:modelValue", target.checked);
	emit("change", event);
}
</script>

<template>
	<label class="switch" @click.stop>
		<input
			:id="id"
			type="checkbox"
			:checked="modelValue"
			:disabled="disabled"
			@change="onChange"
		/>
		<span class="slider"></span>
	</label>
</template>

<style scoped>
.switch {
	position: relative;
	display: inline-block;
	width: 42px;
	height: 24px;
	flex-shrink: 0;
	cursor: pointer;
}

.switch input {
	opacity: 0;
	width: 0;
	height: 0;
}

.slider {
	position: absolute;
	inset: 0;
	background: var(--border);
	transition: background-color var(--dur-base) var(--ease-in-out);
	border-radius: 24px;
}

.slider::before {
	position: absolute;
	content: "";
	height: 18px;
	width: 18px;
	left: 3px;
	bottom: 3px;
	background: white;
	transition: transform 260ms var(--ease-spring);
	border-radius: 50%;
}

input:checked + .slider {
	background: var(--primary);
}

input:checked + .slider::before {
	transform: translateX(18px);
}
</style>
