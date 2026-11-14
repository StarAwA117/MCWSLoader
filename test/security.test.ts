import test from "node:test";
import assert from "node:assert/strict";
import { isSafeArchiveEntry, isValidNpmName, parseDependency, sanitizeFolderName } from "../lib/modinstall.js";
import { sanitizeConfigObject } from "../lib/mods.js";
import Utils from "../lib/utils.js";

test("archive entries reject zip-slip and absolute paths", () => {
	assert.equal(isSafeArchiveEntry("manifest.json"), true);
	assert.equal(isSafeArchiveEntry("sub/main.js"), true);
	assert.equal(isSafeArchiveEntry("../evil.js"), false);
	assert.equal(isSafeArchiveEntry("a/../../evil.js"), false);
	assert.equal(isSafeArchiveEntry("/etc/passwd"), false);
	assert.equal(isSafeArchiveEntry("C:/Windows/evil"), false);
	assert.equal(isSafeArchiveEntry("a\\..\\evil"), false);
});

test("config sanitizer removes prototype keys", () => {
	const input = JSON.parse('{"safe":1,"__proto__":{"polluted":true},"nested":{"constructor":1,"ok":2}}');
	const output = sanitizeConfigObject(input);
	assert.equal(output.safe, 1);
	assert.equal(output.nested.ok, 2);
	assert.equal(Object.getPrototypeOf(output), Object.prototype);
	assert.equal(({} as Record<string, unknown>).polluted, undefined);
	assert.equal(Object.prototype.hasOwnProperty.call(output, "__proto__"), false);
});

test("folder and npm package name validation", () => {
	const sanitized = sanitizeFolderName("../../evil");
	assert.equal(sanitized.includes(".."), false);
	assert.equal(sanitized.includes("/"), false);
	assert.equal(sanitizeFolderName("hello/world"), "hello_world");
	assert.equal(sanitizeFolderName(""), "mod");

	assert.equal(isValidNpmName("openai"), true);
	assert.equal(isValidNpmName("@scope/pkg"), true);
	assert.equal(isValidNpmName("bad name"), false);
	assert.equal(isValidNpmName("../evil"), false);
	assert.deepEqual(parseDependency("openai"), { kind: "npm", name: "openai" });
	assert.equal(parseDependency({ name: "openai" }), null);
});

test("splitByBytes never splits a UTF-8 code point", () => {
	const text = 'x"\\\n\t' + "中文😀".repeat(20);
	for (const max of [1, 2, 5, 10, 50]) {
		const parts = Utils.splitByBytes(text, max);
		assert.equal(parts.join(""), text);
		for (const part of parts) {
			const size = Buffer.byteLength(part, "utf8");
			assert.ok(size <= max || [...part].length === 1, `chunk of ${size} bytes exceeds ${max}`);
		}
	}
});
