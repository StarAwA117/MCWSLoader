// 诊断脚本6：使用真实的 Utils 类，模拟真实 sendCommand 行为

import Utils from "./lib/utils.js";

class FakeWS {
    constructor() {
        this.readyState = 1; // OPEN
        this.sent = [];
    }
    send(data, callback) {
        const id = this.sent.length + 1;
        this.sent.push({ id, data });
        console.log(`[ws.send] #${id}: ${data}`);
        // 模拟 ws 库行为：同步调用 callback
        if (typeof callback === "function") {
            callback(); // 无错误
        }
    }
    close() {
        this.readyState = 3;
    }
}

const ws = new FakeWS();
const utils = new Utils(ws);

async function main() {
    console.log("=== 真实 Utils.sendCommand 行为测试 ===");
    
    console.log("\n1. 测试 sendCommand 返回值");
    const r1 = await utils.sendCommand("testforblock ~ ~ ~ air");
    console.log("sendCommand resolved:", r1);
    
    console.log("\n2. 测试 sendCommand 带回调（错误用法）");
    const r2 = utils.sendCommand("testforblock ~ ~ ~ air", (body) => {
        console.log("callback called with:", body);
    });
    console.log("sendCommand with callback returned:", typeof r2);
    await r2;
    
    console.log("\n3. 测试 tell 是否能发送");
    utils.tell("§eTest message");
    console.log("sent messages:", ws.sent.length);
    
    console.log("\n4. 测试 runCommand 是否能拿到响应");
    const r3 = await utils.runCommand("testforblock ~ ~ ~ air", 1000);
    console.log("runCommand resolved:", r3);
    
    console.log("\n=== 诊断完成 ===");
}

main().catch((e) => {
    console.error("diag_real error:", e);
    process.exit(1);
});
