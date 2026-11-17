import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { STANDALONE } from "./apiBase";
import "./assets/main.css";

const root = document.documentElement;
if (STANDALONE) root.dataset.standalone = "true";
if (STANDALONE && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
	root.dataset.mobile = "true";
}

createApp(App).use(router).mount("#app");
