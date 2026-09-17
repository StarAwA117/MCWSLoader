import { reactive } from "vue";
import { useI18n } from "./useI18n";

const { t } = useI18n();

const state = reactive({
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
	_resolve: null,
});

function lockScroll() { document.body.classList.add("modal-open"); }
function unlockScroll() { document.body.classList.remove("modal-open"); }

function openModal(options) {
	state.type = options.type || "alert";
	state.title = options.title || "";
	state.message = options.message || "";
	state.inputValue = options.inputValue || "";
	state.inputValue2 = options.inputValue2 || "";
	state.inputPlaceholder = options.inputPlaceholder || "";
	state.inputPlaceholder2 = options.inputPlaceholder2 || "";
	state.showCancel = options.type === "confirm" || options.type === "prompt";
	state._error = null;
	state.open = true;
	lockScroll();
	return new Promise((resolve) => { state._resolve = resolve; });
}

function close(result) {
	state.open = false;
	unlockScroll();
	if (state._resolve) { state._resolve(result); state._resolve = null; }
}

export function useModal() {
	return {
		state,
		alert: (message, title) => openModal({ type: "alert", message, title: title || t("modal.alert") }),
		confirm: (message, title) => openModal({ type: "confirm", message, title: title || t("modal.confirm") }),
		prompt: (message, defaultValue, title) => openModal({ type: "prompt", message, title: title || t("modal.prompt"), inputValue: defaultValue || "" }),
		openResetPassword: () => openModal({
			type: "prompt",
			title: t("modal.resetPasswordTitle"),
			message: t("modal.resetPasswordMessage"),
			inputPlaceholder: t("modal.currentPassword"),
			inputPlaceholder2: t("modal.newPassword")
		}),
		close,
	};
}

// 全局单例，供 Modal.vue 直接导入
export { state as modalState, close as closeModal };
