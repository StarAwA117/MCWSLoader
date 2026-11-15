import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
	// A Flutter WebView loads index.html from the asset directory, so every
	// script/style URL must stay relative. The normal WebUI keeps absolute paths.
	base: process.env.VITE_STANDALONE === "1" ? "./" : "/",
	plugins: [vue()],
	build: {
		outDir: process.env.VITE_STANDALONE === "1" ? "dist-standalone" : "dist",
		emptyOutDir: true,
		rollupOptions: {
			output: {
				manualChunks: {
					vendor: ["vue", "vue-router"]
				}
			}
		}
	},
	server: {
		proxy: {
			"/api": "http://127.0.0.1:50005"
		}
	}
});
