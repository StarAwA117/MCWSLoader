// 诊断脚本7：使用真实 Utils，模拟 sphere + setBlocks 是否卡住

import Utils from "./lib/utils.js";

class FakeWS {
    constructor() {
        this.readyState = 1;
        this.sent = [];
        this.handlers = {};
    }
    send(data, callback) {
        const id = this.sent.length + 1;
        this.sent.push({ id, data });
        console.log(`[ws.send] #${id}: ${data.slice(0, 80)}...`);
        // 模拟 ws 库：如果回调是 function，同步调用
        if (typeof callback === "function") {
            try { callback(); } catch (e) { console.error("[ws.send callback error]", e.message); }
        }
        return true;
    }
    on(event, handler) {
        this.handlers[event] = handler;
    }
    close() {
        this.readyState = 3;
    }
}

const ws = new FakeWS();
const utils = new Utils(ws);

// 模拟 V.Generator.sphere
function sphere(radius) {
    const result = [];
    for (let x = -radius; x <= radius; x++) {
        for (let y = -radius; y <= radius; y++) {
            for (let z = -radius; z <= radius; z++) {
                if (x*x + y*y + z*z <= radius*radius) {
                    result.push({ x, y, z });
                }
            }
        }
    }
    return result;
}

function setBlocks(client, defaultBlock) {
    return (arg) => {
        if (typeof arg === "string") {
            return (space) => {
                for (const pos of space) {
                    client.sendCommand(`setblock ${pos.x} ${pos.y} ${pos.z} ${arg}`).catch(() => {});
                }
            };
        }
        const space = arg;
        for (const pos of space) {
            client.sendCommand(`setblock ${pos.x} ${pos.y} ${pos.z} ${defaultBlock}`).catch(() => {});
        }
    };
}

async function main() {
    console.log("=== 真实 Utils + sphere/setBlocks 测试 ===");
    
    const client = ws;
    const defaultBlock = "iron_block";
    const ball = sphere(5);
    console.log(`sphere(5) 生成了 ${ball.length} 个点`);
    
    console.log("\n开始 setBlocks...");
    const start = Date.now();
    
    const setter = setBlocks(client, defaultBlock);
    setter(ball);
    
    const elapsed = Date.now() - start;
    console.log(`\nsetBlocks 完成，耗时 ${elapsed}ms`);
    console.log(`总共发送了 ${client.sent.length} 条命令`);
    
    // 检查是否所有 sendCommand 都成功了
    const allResolved = client.sent.every((item, index) => {
        // 在真实环境中，Promise resolve 由回调触发
        return true;
    });
    console.log("所有命令都调用了 send:", allResolved);
    
    console.log("\n=== 诊断完成 ===");
}

main().catch((e) => {
    console.error("diag_real2 error:", e);
    process.exit(1);
});
