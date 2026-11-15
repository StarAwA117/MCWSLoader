/**
 * Standalone builds load index.html from a Flutter asset. The API still lives
 * on the loopback HTTP server, so requests need an explicit absolute origin.
 */
export const STANDALONE = import.meta.env.MODE === "standalone";

const configuredBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
export const API_BASE = configuredBase.replace(/\/+$/, "");

export function apiUrl(path: string): string {
	return `${API_BASE}${path}`;
}
