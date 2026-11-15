import test from "node:test";
import assert from "node:assert/strict";
import { runFastBuilderScript, SandboxError } from "../../mods/fastbuilder/sandbox.js";

function options(code: string, timeoutMs = 1000) {
	const blocks: unknown[] = [];
	const messages: unknown[] = [];
	return {
		blocks,
		messages,
		options: {
			code,
			geometry: { add: (a: number, b: number) => a + b },
			setting: { block: "stone" },
			position: { x: 4, y: 5, z: 6 },
			setBlocks: (value: unknown) => { blocks.push(value); },
			tellRaw: (...value: unknown[]) => { messages.push(value); },
			broadcast: (...value: unknown[]) => { messages.push(value); },
			timeoutMs
		}
	};
}

test("FastBuilder sandbox runs builder scripts with context APIs", async () => {
	const fixture = options('setBlocks(add(1, 2)); tell_raw(pos().x, setting.block);');
	await runFastBuilderScript(fixture.options);
	assert.deepEqual(fixture.blocks, [3]);
	assert.deepEqual(fixture.messages, [[4, "stone"]]);
});

test("FastBuilder sandbox rejects host and constructor access", async () => {
	for (const code of [
		"process.exit(1)",
		"eval('1 + 1')",
		"({}).constructor",
		"globalThis.process",
		"this"
	]) {
		const fixture = options(code);
		await assert.rejects(
			() => runFastBuilderScript(fixture.options),
			(error: unknown) => error instanceof SandboxError && error.kind === "validation"
		);
	}
});

test("FastBuilder sandbox reports runtime errors separately", async () => {
	const fixture = options("missingFunction()");
	await assert.rejects(
		() => runFastBuilderScript(fixture.options),
		(error: unknown) => error instanceof SandboxError && error.kind === "runtime"
	);
});

test("FastBuilder sandbox enforces a timeout", async () => {
	const fixture = options("while (true) {}", 50);
	await assert.rejects(
		() => runFastBuilderScript(fixture.options),
		(error: unknown) => error instanceof SandboxError && error.kind === "timeout"
	);
});
