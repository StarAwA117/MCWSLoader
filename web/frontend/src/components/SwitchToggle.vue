<script setup>
defineOptions({ name: "SwitchToggle" });

defineProps({
	modelValue: { type: Boolean, default: false },
	disabled: { type: Boolean, default: false },
	id: { type: String, default: undefined }
});

const emit = defineEmits(["update:modelValue", "change"]);

function onChange(event) {
	emit("update:modelValue", event.target.checked);
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
	transition: 0.2s;
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
	transition: 0.2s;
	border-radius: 50%;
}

input:checked + .slider {
	background: var(--primary);
}

input:checked + .slider::before {
	transform: translateX(18px);
}
</style>
