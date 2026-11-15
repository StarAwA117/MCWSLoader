import test from "node:test";
import assert from "node:assert/strict";
import { toUserError } from "../errors.js";

test("maps raw filesystem and network errors to readable messages", () => {
	assert.equal(toUserError(new Error("EACCES: permission denied, open /root/config.json")), "没有访问该文件或目录的权限");
	assert.equal(toUserError(new Error("Failed to write config: ENOENT")), "保存配置失败，请检查文件权限或磁盘空间");
	assert.equal(toUserError(new Error("fetch failed")), "网络连接失败，请检查网络或服务地址");
	assert.equal(toUserError(new Error("HTTP 500 Internal Server Error")), "服务暂时不可用，请稍后重试");
});

test("keeps short Chinese domain errors and hides internal errors", () => {
	assert.equal(toUserError(new Error("建筑文件解析失败")), "建筑文件解析失败");
	assert.equal(toUserError(new Error("Cannot read properties of undefined (reading 'x')")), "程序内部处理失败，请稍后重试");
	assert.equal(toUserError(new Error("")), "操作失败，请稍后重试");
});

test("prefers explicit userMessage values", () => {
	assert.equal(toUserError({ userMessage: "AI 请求失败，请稍后重试。" }, "fallback"), "AI 请求失败，请稍后重试。");
});
