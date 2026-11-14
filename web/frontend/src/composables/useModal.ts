import { reactive } from "vue";
import { useI18n } from "./useI18n";
import { useScrollLock } from "./useScrollLock";

const { t } = useI18n();

export type ModalType = "alert" | "confirm" | "prompt";

export interface ModalOptions {
	type?: ModalType;
	title?: string;
	message?: string;
	inputValue?: string;
	inputValue2?: string;
	inputPlaceholder?: string;
	inputPlaceholder2?: string;
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
	showCancel: boolean;
	_error: string | null;
	_resolve: ((value: unknown) => void) | null;
}

const state = reactive<ModalState>({
	open: false,
	type: "alert",
	title: "",
	message: "",
	inputValue: "",
	inputValue2: "",
	inputPlaceholder: "",
	inputPlaceholder2: "",
	showCancel: false,
	_error: null,
	_resolve: null
});

const { lock: lockScroll, unlock: unlockScroll } = useScrollLock();

function openModal(options: ModalOptions): Promise<unknown> {
	state.type = options.type ?? "alert";
	state.title = options.title ?? "";
	state.message = options.message ?? "";
	state.inputValue = options.inputValue ?? "";
	state.inputValue2 = options.inputValue2 ?? "";
	state.inputPlaceholder = options.inputPlaceholder ?? "";
	state.inputPlaceholder2 = options.inputPlaceholder2 ?? "";
	state.showCancel = state.type === "confirm" || state.type === "prompt";
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
		alert: (message: string, title?: string) =>
			openModal({ type: "alert", message, title: title ?? t("modal.alert") }),
		confirm: (message: string, title?: string) =>
			openModal({ type: "confirm", message, title: title ?? t("modal.confirm") }),
		prompt: (message: string, defaultValue?: string, title?: string) =>
			openModal({ type: "prompt", message, title: title ?? t("modal.prompt"), inputValue: defaultValue ?? "" }),
		openResetPassword: () =>
			openModal({
				type: "prompt",
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
