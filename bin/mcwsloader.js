#!/usr/bin/env node
// CLI 启动器：通过项目内的 tsx 运行 TypeScript 入口，兼容 npm bin/npx。
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");

if (!fs.existsSync(cli)) {
	console.error("tsx is not installed. Run `npm install` first.");
	process.exit(1);
}

const child = spawn(process.execPath, [cli, path.join(root, "main.ts")], {
	cwd: root,
	stdio: "inherit"
});

// 转发终止信号，避免父进程退出后 tsx 子进程残留
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
	if (signal) process.kill(process.pid, signal);
	else process.exit(code ?? 0);
});
