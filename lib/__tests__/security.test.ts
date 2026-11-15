import test from "node:test";
import assert from "node:assert/strict";
import { isSafeArchiveEntry, isValidNpmName, parseDependency, sanitizeFolderName } from "../modinstall.js";
import { sanitizeConfigObject } from "../mods.js";
import Current from "../current.js";
import PermissionManager from "../permission.js";
import { parseMultipartBody } from "../multipart.js";
import Utils from "../utils.js";

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
	assert.equal(sanitizeFolderName("."), "mod");
	assert.equal(sanitizeFolderName(".."), "mod");

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

test("pending clients are never elected as main", () => {
	Current.reset();
	const pending = { id: "pending", trusted: false } as any;
	const trusted = { id: "trusted", trusted: true } as any;
	const trusted2 = { id: "trusted-2", trusted: true } as any;

	Current.addClient(pending, {} as any);
	assert.equal(Current.client, null);
	assert.equal(Current.setMain(pending), null, "setMain must not promote pending clients");

	Current.addClient(trusted, {} as any);
	assert.equal(Current.client, trusted);

	Current.addClient(trusted2, {} as any);
	Current.removeClient(trusted);
	assert.equal(Current.client, trusted2, "next approved client should be elected");

	Current.addClient({ id: "pending-2", trusted: false } as any, {} as any);
	Current.removeClient(trusted2);
	assert.equal(Current.client, null, "an approved client must not be replaced by pending peers");
	Current.reset();
});

test("permission groups reject prototype keys", () => {
	assert.ok(PermissionManager.add("__proto__", "player") instanceof Error);
	assert.ok(PermissionManager.remove("constructor", "player") instanceof Error);
});

test("multipart parser rejects prototype-polluting field names", () => {
	const body = Buffer.from(
		'--x\r\nContent-Disposition: form-data; name="__proto__"\r\n\r\npolluted\r\n' +
		'--x\r\nContent-Disposition: form-data; name="file"; filename="mod.zip"\r\n\r\nzip\r\n--x--\r\n'
	);
	const result = parseMultipartBody(body, "multipart/form-data; boundary=x");
	assert.ok(result);
	assert.equal(Object.getPrototypeOf(result), null);
	assert.equal(({} as Record<string, unknown>).polluted, undefined);
	assert.equal(result?.file?.type, "file");
});
