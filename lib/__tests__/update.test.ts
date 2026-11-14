import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, isNewerVersion, normalizeVersion } from "../update.js";

test("normalizeVersion strips a leading v", () => {
	assert.equal(normalizeVersion("v2.0.0-beta.1"), "2.0.0-beta.1");
	assert.equal(normalizeVersion("2.0.0"), "2.0.0");
});

test("compareVersions handles stable and prerelease ordering", () => {
	assert.ok(compareVersions("2.0.0", "1.3.0") > 0);
	assert.ok(compareVersions("2.0.0-beta.1", "1.3.0") > 0);
	assert.ok(compareVersions("2.0.0", "2.0.0-beta.1") > 0);
	assert.ok(compareVersions("2.0.0-beta.2", "2.0.0-beta.1") > 0);
	assert.ok(compareVersions("2.0.0-beta.10", "2.0.0-beta.2") > 0);
	assert.equal(compareVersions("v2.0.0-beta.1", "2.0.0-beta.1"), 0);
	assert.equal(compareVersions("invalid", "1.0.0"), 0);
});

test("isNewerVersion only reports updates, not downgrades or equal versions", () => {
	assert.equal(isNewerVersion("2.0.0-beta.2", "2.0.0-beta.1"), true);
	assert.equal(isNewerVersion("1.3.0", "2.0.0-beta.1"), false);
	assert.equal(isNewerVersion("2.0.0-beta.1", "2.0.0-beta.1"), false);
});
