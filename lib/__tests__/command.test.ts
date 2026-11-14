import test from "node:test";
import assert from "node:assert/strict";
import Command from "../command.js";
import type { CommandResult } from "../command.js";

Command.commandPrefix = "$";

function run(cmd: Command, text: string): CommandResult {
	const result = cmd.execute("tester", text);
	assert.notEqual(result, false);
	return result as CommandResult;
}

test("parseArgs supports whitespace, quotes and empty tokens", () => {
	assert.deepEqual(Command.parseArgs("$a b  c"), ["$a", "b", "c"]);
	assert.deepEqual(Command.parseArgs("$a\tb"), ["$a", "b"]);
	assert.deepEqual(Command.parseArgs('$a "x y" z'), ["$a", "x y", "z"]);
	assert.deepEqual(Command.parseArgs('$a ""'), ["$a", ""]);
	assert.throws(() => Command.parseArgs('$a "x'));
});

test("required and optional parameter counts", () => {
	const cmd = Command.create("n").addInteger().addOptionalString().setFunc(() => undefined);
	assert.deepEqual(run(cmd, "$n 7"), { status: true, message: [7, undefined] });
	assert.equal((cmd.execute("tester", "$n") as CommandResult).status, false);
	assert.equal(cmd.execute("tester", "$other 7"), false);
});

test("strict integer / float / enum parsing", () => {
	const integer = Command.create("i").addInteger().setFunc(() => undefined);
	assert.equal(run(integer, "$i 42").status, true);
	assert.equal(run(integer, "$i 1.5").status, false);
	assert.equal(run(integer, "$i 1e3").status, false);

	const float = Command.create("f").addFloat().setFunc(() => undefined);
	assert.deepEqual(run(float, "$f .5"), { status: true, message: [0.5] });
	assert.deepEqual(run(float, "$f 1e3"), { status: true, message: [1000] });

	const enumCmd = Command.create("e").addEnum(["a", "b"]).setFunc(() => undefined);
	assert.equal(run(enumCmd, "$e b").status, true);
	assert.equal(run(enumCmd, "$e c").status, false);
});

test("async handler errors are delivered to onError", async () => {
	let captured: Error | null = null;
	const cmd = Command.create("async").setFunc(async () => {
		throw new Error("boom");
	});
	cmd.execute("t", "$async", (error) => {
		captured = error;
	});
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal((captured as Error | null)?.message, "boom");
});

test("missing handler is reported instead of silently succeeding", () => {
	const cmd = Command.create("empty");
	assert.equal(run(cmd, "$empty").status, false);
});
