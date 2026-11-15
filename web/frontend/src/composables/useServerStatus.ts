import { ref } from "vue";
import { api } from "../api";
import { usePolling } from "./usePolling";

/** Tracks whether the optional WebSocket server is running. */
export function useServerStatus() {
	const running = ref(true);
	const mode = ref<"both" | "webui" | "websocket">("both");

	async function refresh(): Promise<void> {
		const status = await api.getStatus();
		const server = status?.server as Record<string, unknown> | undefined;
		if (!server) return;
		running.value = server.websocketRunning !== false;
		const value = server.mode;
		if (value === "both" || value === "webui" || value === "websocket") mode.value = value;
	}

	const { refresh: poll } = usePolling(refresh, 5000);
	return { running, mode, refresh: poll };
}
