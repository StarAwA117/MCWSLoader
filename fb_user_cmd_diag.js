// 诊断脚本11：精确模拟用户输入的命令，测试完整流程

import FastBuilder from "./mod/fastbuilder/main.js";

const mockClient = {
    readyState: 1,
    sendCommand(cmd) {
        console.log(`[sendCommand] ${cmd}`);
        return Promise.resolve("mock-uuid");
    },
    tell(msg, sender) {
        console.log(`[tell] to=${sender || '@a'} msg=${msg}`);
    }
};

const fb = new FastBuilder(mockClient);
fb.config = {
    defaultBlock: "iron_block",
    origin: { x: 0, y: 0, z: 0 },
    particle: "minecraft:explosion"
};

async function main() {
    console.log("=== 模拟用户输入: $fb:runthis 'const ball = ...' ===\n");
    
    // 模拟 $fb:runthis 的完整流程
    console.log("step1: getPlayerPosition");
    const pos = { x: 10, y: 4, z: -3 }; // 模拟返回玩家位置
    console.log("player position:", pos);
    
    console.log("\nstep2: runScript");
    const sender = "StarAwA117";
    const input = 'const ball = [{x:0,y:0,z:0},{x:64,y:0,z:0}]; setBlocks(ball);';
    
    try {
        await fb.runScript(sender, input, pos);
        console.log("\nrunScript 正常完成");
    } catch (e) {
        console.error("\nrunScript 异常:", e);
    }
    
    console.log("\n=== 诊断完成 ===");
}

main().catch((e) => {
    console.error("diag error:", e);
    process.exit(1);
});
