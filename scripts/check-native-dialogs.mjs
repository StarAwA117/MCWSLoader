#!/usr/bin/env node
// Guard against browser-native alert/confirm/prompt dialogs.
//
// Firefox and some extensions block native dialogs, and they cannot use the
// MCWSLoader theme. All UI dialogs must go through src/composables/useModal.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web", "frontend", "src");
const files = [];

function walk(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) walk(full);
		else if (/\.(ts|vue)$/.test(entry.name)) files.push(full);
	}
}

walk(root);

const nativeGlobal = /\b(?:window|globalThis)\.(alert|confirm|prompt)\s*\(/g;
const bareDialog = /(?<![\w.$])(alert|confirm|prompt)\s*\(/g;
const errors = [];

for (const file of files) {
	const source = fs.readFileSync(file, "utf-8");
	const relative = path.relative(root, file);

	for (const [pattern, message] of [
		[nativeGlobal, "uses a native window/globalThis dialog"],
		[bareDialog, "uses an alert/confirm/prompt-style call; use useModal().notify/ask/input/choose"]
	]) {
		pattern.lastIndex = 0;
		if (!pattern.test(source)) continue;
		errors.push(`${relative}: ${message}`);
	}
}

if (errors.length) {
	console.error("Native browser dialogs found; use useModal() instead:");
	for (const error of errors) console.error(`  - ${error}`);
	process.exit(1);
}

console.log(`No native alert/confirm/prompt dialogs found in ${files.length} frontend files.`);
