import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ mode }) => {
	const standalone = mode === "standalone";
	return {
		// A Flutter WebView loads index.html from the asset directory, so every
		// script/style URL must stay relative. The normal WebUI keeps absolute paths.
		base: standalone ? "./" : "/",
		plugins: [vue()],
		build: {
			outDir: standalone ? "dist-standalone" : "dist",
			emptyOutDir: true,
			rollupOptions: {
				output: standalone
					// file:// pages cannot load ES module scripts in a WebView
					// because module requests are subject to CORS. Emit one
					// classic script for the embedded build.
					? {
						format: "iife",
						inlineDynamicImports: true,
						entryFileNames: "assets/app.js",
						chunkFileNames: "assets/[name].js",
						assetFileNames: "assets/[name][extname]"
					}
					: {
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
	};
});
