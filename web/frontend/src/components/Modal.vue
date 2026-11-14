<script setup lang="ts">
import { modalState as state, closeModal as close } from "../composables/useModal";
import { ref, watch } from "vue";
import { useI18n } from "../composables/useI18n";

const { t } = useI18n();

const inputRef = ref<HTMLInputElement | null>(null);
const inputRef2 = ref<HTMLInputElement | null>(null);
const modalRef = ref<HTMLDivElement | null>(null);

watch(() => state.open, (v: boolean) => {
	if (!v) return;
	setTimeout(() => {
		if (state.type === "input" || state.type === "password") inputRef.value?.focus();
		else modalRef.value?.focus();
	}, 100);
});

function onConfirm(): void {
	if (state.type === "input") {
		const value = state.inputValue.trim();
		if (!value) { state._error = t("modal.required"); return; }
		close(value);
		return;
	}
	if (state.type === "password") {
		const current = state.inputValue.trim();
		const next = state.inputValue2.trim();
		if (!current) { state._error = t("modal.currentPasswordRequired"); return; }
		if (!next) { state._error = t("modal.newPasswordRequired"); return; }
		close([current, next]);
		return;
	}
	if (state.type === "choice") {
		if (!state.selected) { state._error = t("modal.required"); return; }
		close(state.selected);
		return;
	}
	close(true);
}

function onCancel(): void { close(false); }

function onKeydown(e: KeyboardEvent): void {
	if (e.key === "Enter") onConfirm();
	if (e.key === "Escape") onCancel();
}
</script>

<template>
	<Transition name="modal-pop">
	<div v-if="state.open" class="modal-overlay" @click.self="state.type === 'message' ? close(true) : onCancel()">
		<div ref="modalRef" class="modal" role="dialog" aria-modal="true" tabindex="-1" @keydown="onKeydown">
			<div class="modal-header">
				<h3>{{ state.title }}</h3>
				<button class="modal-close" @click="state.type === 'message' ? close(true) : onCancel()">×</button>
			</div>
			<div class="modal-body">
				<p v-if="state.message" style="margin: 0; font-size: 14px; line-height: 1.6; color: var(--text-secondary); white-space: pre-line;">{{ state.message }}</p>
				<p v-if="state._error" style="margin: 8px 0 0; font-size: 13px; color: var(--danger);">{{ state._error }}</p>
				<input
					v-if="state.type === 'input' || state.type === 'password'"
					ref="inputRef"
					v-model="state.inputValue"
					:type="state.type === 'password' ? 'password' : 'text'"
					:placeholder="state.inputPlaceholder"
					style="margin-top: 12px; width: 100%; padding: 8px 12px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg-input); color: var(--text); font-size: 14px; font-family: inherit; outline: none;"
				/>
				<input
					v-if="state.type === 'password'"
					ref="inputRef2"
					v-model="state.inputValue2"
					type="password"
					:placeholder="state.inputPlaceholder2"
					style="margin-top: 8px; width: 100%; padding: 8px 12px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg-input); color: var(--text); font-size: 14px; font-family: inherit; outline: none;"
				/>
				<select
					v-if="state.type === 'choice'"
					v-model="state.selected"
					class="modal-select"
					style="margin-top: 12px;"
				>
					<option v-for="choice in state.choices" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
				</select>
			</div>
			<div class="modal-footer">
				<button v-if="state.showCancel" class="btn btn-ghost btn-sm" @click="onCancel">{{ t('modal.cancel') }}</button>
				<button class="btn btn-primary btn-sm" @click="onConfirm">{{ t('modal.okButton') }}</button>
			</div>
		</div>
	</div>
	</Transition>
</template>
