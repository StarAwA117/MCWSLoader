import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { STANDALONE } from "./apiBase";
import { api } from "./api";
import { applyTheme } from "./composables/useTheme";
import { postNativeTheme } from "./utils/nativeBridge";
import "./assets/main.css";

const root = document.documentElement;
if (STANDALONE) root.dataset.standalone = "true";
if (STANDALONE && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
	root.dataset.mobile = "true";
}

createApp(App).use(router).mount("#app");
postNativeTheme();
// The normal WebUI receives the theme in the served HTML. The embedded build
// needs to fetch it once so the first screen and status bar match the config.
if (STANDALONE) {
	api.getConfig()
		.then((config) => {
			const theme = config?.web?.ui?.theme;
			if (typeof theme === "string") applyTheme(theme);
		})
		.catch(() => {});
}
