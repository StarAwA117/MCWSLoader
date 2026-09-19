// 诊断脚本9：直接调用 FastBuilder.runScript，绕过 Command 系统，只看脚本执行流程

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
    console.log("=== 测试 $fb:run 脚本执行 ===");
    await fb.runScript("StarAwA117", 'const ball = [{x:0,y:0,z:0},{x:1,y:0,z:0}]; setBlocks(ball);');
    console.log("\n=== 诊断完成 ===");
}

main().catch((e) => {
    console.error("diag error:", e);
    process.exit(1);
});
