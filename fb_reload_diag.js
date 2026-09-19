// 诊断脚本12：模拟 reload 对 FastBuilder 的影响，只看 mod 自身有没有重复注册

import Command from "./lib/command.js";
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
fb.Command = Command;
fb.config = {
    defaultBlock: "iron_block",
    origin: { x: 0, y: 0, z: 0 },
    particle: "minecraft:explosion"
};

function collectCommands(instance) {
    const commands = { normal: [], user: [], op: [], owner: [] };
    const cmdMap = instance.onCommand();
    for (const key of Object.keys(cmdMap)) {
        if (!Array.isArray(cmdMap[key])) continue;
        commands[key] = [...cmdMap[key]];
    }
    return commands;
}

async function main() {
    console.log("=== 初始状态 ===");
    let cmds = collectCommands(fb);
    console.log("op commands:", cmds.op.map(c => c.name));

    console.log("\n=== 模拟 reload 1 次 ===");
    const newFb1 = new FastBuilder(mockClient);
    newFb1.Command = Command;
    newFb1.config = fb.config;
    cmds = collectCommands(newFb1);
    console.log("op commands:", cmds.op.map(c => c.name));

    console.log("\n=== 模拟 reload 3 次 ===");
    for (let i = 2; i <= 4; i++) {
        const newFb = new FastBuilder(mockClient);
        newFb.Command = Command;
        newFb.config = fb.config;
        cmds = collectCommands(newFb);
        console.log(`reload ${i} - op commands:`, cmds.op.map(c => c.name));
    }

    console.log("\n=== 诊断完成 ===");
}

main().catch((e) => {
    console.error("diag error:", e);
    process.exit(1);
});
