import { reactive } from "vue";
import { useI18n } from "./useI18n";
import { useScrollLock } from "./useScrollLock";

const { t } = useI18n();

export type ModalType = "message" | "question" | "input" | "password" | "choice";

export interface ModalChoice {
	value: string;
	label: string;
}

export interface ModalOptions {
	type?: ModalType;
	title?: string;
	message?: string;
	inputValue?: string;
	inputValue2?: string;
	inputPlaceholder?: string;
	inputPlaceholder2?: string;
	choices?: ModalChoice[];
	selected?: string;
}

interface ModalState {
	open: boolean;
	type: ModalType;
	title: string;
	message: string;
	inputValue: string;
	inputValue2: string;
	inputPlaceholder: string;
	inputPlaceholder2: string;
	choices: ModalChoice[];
	selected: string;
	showCancel: boolean;
	_error: string | null;
	_resolve: ((value: unknown) => void) | null;
}

const state = reactive<ModalState>({
	open: false,
	type: "message",
	title: "",
	message: "",
	inputValue: "",
	inputValue2: "",
	inputPlaceholder: "",
	inputPlaceholder2: "",
	choices: [],
	selected: "",
	showCancel: false,
	_error: null,
	_resolve: null
});

const { lock: lockScroll, unlock: unlockScroll } = useScrollLock();

function openModal(options: ModalOptions): Promise<unknown> {
	// 上一个弹窗还没结束时先以 false 结束，避免调用方永久等待
	if (state._resolve) {
		const previous = state._resolve;
		state._resolve = null;
		previous(false);
	}
	state.type = options.type ?? "message";
	state.title = options.title ?? "";
	state.message = options.message ?? "";
	state.inputValue = options.inputValue ?? "";
	state.inputValue2 = options.inputValue2 ?? "";
	state.inputPlaceholder = options.inputPlaceholder ?? "";
	state.inputPlaceholder2 = options.inputPlaceholder2 ?? "";
	state.choices = (options.choices ?? []).map((choice) => ({ ...choice }));
	state.selected = options.selected ?? state.choices[0]?.value ?? "";
	state.showCancel = state.type !== "message";
	state._error = null;
	state.open = true;
	lockScroll();
	return new Promise((resolve) => {
		state._resolve = resolve;
	});
}

function close(result?: unknown): void {
	state.open = false;
	unlockScroll();
	if (state._resolve) {
		state._resolve(result);
		state._resolve = null;
	}
}

export function useModal() {
	return {
		state,
		/** Informational message with one OK button. */
		notify: (message: string, title?: string) =>
			openModal({ type: "message", message, title: title ?? t("modal.message") }),
		/** Yes/no question. Resolves to a boolean. */
		ask: (message: string, title?: string) =>
			openModal({ type: "question", message, title: title ?? t("modal.question") }),
		/** Single-line text input. Resolves to a string (or false when cancelled). */
		input: (message: string, defaultValue?: string, title?: string) =>
			openModal({ type: "input", message, title: title ?? t("modal.input"), inputValue: defaultValue ?? "" }),
		/** Dropdown chooser. Resolves to the selected value (or false when cancelled). */
		choose: (choices: ModalChoice[], title?: string, message?: string) =>
			openModal({ type: "choice", title: title ?? t("modal.choose"), message, choices }),
		resetPassword: () =>
			openModal({
				type: "password",
				title: t("modal.resetPasswordTitle"),
				message: t("modal.resetPasswordMessage"),
				inputPlaceholder: t("modal.currentPassword"),
				inputPlaceholder2: t("modal.newPassword")
			}),
		close
	};
}

// 全局单例，供 Modal.vue 直接导入
export { state as modalState, close as closeModal };
