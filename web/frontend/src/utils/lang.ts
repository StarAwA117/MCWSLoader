/** Parse a `key=value` language file used by the core and Mods. */
export function parseLang(raw: string): Record<string, string> {
	const messages: Record<string, string> = {};
	for (const rawLine of String(raw ?? "").split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#") || line.startsWith("!")) continue;
		const separator = line.indexOf("=");
		if (separator <= 0) continue;
		const key = line.slice(0, separator).trim();
		const value = line
			.slice(separator + 1)
			.trim()
			.replace(/\\(\\|n|r)/g, (_match, escaped: string) =>
				escaped === "n" ? "\n" : escaped === "r" ? "\r" : "\\"
			);
		if (key) messages[key] = value;
	}
	return messages;
}
