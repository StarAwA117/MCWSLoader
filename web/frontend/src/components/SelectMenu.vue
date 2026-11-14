<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

export interface SelectOption {
	value: string;
	label: string;
}

const props = withDefaults(defineProps<{
	modelValue?: string;
	options: SelectOption[];
	placeholder?: string;
	disabled?: boolean;
	id?: string;
}>(), {
	modelValue: "",
	placeholder: "",
	disabled: false,
	id: ""
});

const emit = defineEmits<{
	"update:modelValue": [value: string];
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);

const selectedLabel = computed(() => {
	const selected = props.options.find((option) => option.value === props.modelValue);
	return selected?.label ?? props.placeholder;
});

function close(): void {
	open.value = false;
}

function toggle(): void {
	if (props.disabled) return;
	open.value = !open.value;
}

function choose(option: SelectOption): void {
	emit("update:modelValue", option.value);
	open.value = false;
	trigger.value?.focus();
}

function onOutsidePointer(event: PointerEvent): void {
	if (!open.value) return;
	if (root.value && !root.value.contains(event.target as Node)) close();
}

watch(open, (isOpen) => {
	if (isOpen) document.addEventListener("pointerdown", onOutsidePointer);
	else document.removeEventListener("pointerdown", onOutsidePointer);
});

onBeforeUnmount(() => document.removeEventListener("pointerdown", onOutsidePointer));
</script>

<template>
	<div ref="root" class="select-menu" :class="{ open, disabled }" @keydown.stop>
		<button
			:id="id"
			ref="trigger"
			type="button"
			class="select-trigger"
			:disabled="disabled"
			aria-haspopup="listbox"
			:aria-expanded="open"
			@click="toggle"
			@keydown.down.prevent="open = true"
			@keydown.enter.prevent="toggle"
			@keydown.space.prevent="toggle"
			@keydown.esc.prevent="close"
		>
			<span class="select-label">{{ selectedLabel || placeholder }}</span>
			<svg class="select-chevron" :class="{ rotated: open }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
				<polyline points="6 9 12 15 18 9"/>
			</svg>
		</button>
		<Transition name="select-pop">
			<ul v-if="open" class="select-options" role="listbox">
				<li v-for="option in options" :key="option.value">
					<button
						type="button"
						class="select-option"
						:class="{ active: option.value === modelValue }"
						role="option"
						:aria-selected="option.value === modelValue"
						@click="choose(option)"
						@keydown.esc.prevent="close"
					>
						<span>{{ option.label }}</span>
						<svg v-if="option.value === modelValue" class="select-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
							<polyline points="20 6 9 17 4 12"/>
						</svg>
					</button>
				</li>
			</ul>
		</Transition>
	</div>
</template>

<style scoped>
.select-menu {
	position: relative;
	width: 100%;
}

.select-trigger {
	width: 100%;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 8px 12px;
	border: 1px solid var(--border);
	border-radius: var(--radius);
	background: var(--bg-input);
	color: var(--text);
	font-family: inherit;
	font-size: 14px;
	text-align: left;
	cursor: pointer;
	outline: none;
	transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}

.select-trigger:hover,
.select-trigger:focus-visible,
.select-menu.open .select-trigger {
	border-color: var(--border-focus);
}

.select-trigger:focus-visible,
.select-menu.open .select-trigger {
	box-shadow: 0 0 0 3px var(--primary-dim);
}

.select-trigger:disabled {
	opacity: 0.55;
	cursor: not-allowed;
}

.select-label {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.select-chevron {
	width: 16px;
	height: 16px;
	flex-shrink: 0;
	color: var(--text-muted);
	transition: transform var(--dur-fast) var(--ease-out);
}

.select-chevron.rotated { transform: rotate(180deg); }

.select-options {
	list-style: none;
	margin: 6px 0 0;
	padding: 4px;
	max-height: 220px;
	overflow-y: auto;
	background: var(--bg-card-solid);
	border: 1px solid var(--border);
	border-radius: var(--radius);
	box-shadow: var(--shadow-modal);
}

.select-option {
	width: 100%;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	padding: 8px 10px;
	border: none;
	border-radius: 6px;
	background: transparent;
	color: var(--text-secondary);
	font-family: inherit;
	font-size: 13px;
	text-align: left;
	cursor: pointer;
	transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.select-option:hover,
.select-option:focus-visible {
	background: var(--primary-glow);
	color: var(--text);
	outline: none;
}

.select-option.active {
	background: var(--primary-dim);
	color: var(--primary);
	font-weight: 600;
}

.select-check {
	width: 15px;
	height: 15px;
	flex-shrink: 0;
}

.select-pop-enter-active,
.select-pop-leave-active {
	transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.select-pop-enter-from,
.select-pop-leave-to {
	opacity: 0;
	transform: translateY(-4px);
}
</style>
