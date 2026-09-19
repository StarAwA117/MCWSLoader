// 诊断脚本10：模拟真实 Command.execute 调用链，不依赖 lib/mods.js

import FastBuilder from "./mod/fastbuilder/main.js";

class MockCommand {
    constructor(name, description) {
        this.name = name;
        this.description = description;
        this.parameters = [];
        this.func = null;
        this.onError = null;
    }

    static create(name, description) {
        return new MockCommand(name, description);
    }

    addString(description, optional) {
        this.parameters.push(["String", description, optional]);
        return this;
    }

    setFunc(func) {
        this.func = func;
        return this;
    }

    static parseArgs(input) {
        const tokens = [];
        let cur = '', inQuote = false;
        for (let i = 0; i < input.length; i++) {
            const ch = input[i];
            if (ch === '"') {
                if (inQuote) tokens.push(cur), cur = '';
                inQuote = !inQuote;
            } else if (!inQuote && ch === ' ') {
                if (cur) tokens.push(cur), cur = '';
            } else {
                cur += ch;
            }
        }
        if (cur) tokens.push(cur);
        if (inQuote) throw new Error('未闭合的双引号');
        return tokens;
    }

    execute(commander, text) {
        let textList;
        try {
            textList = MockCommand.parseArgs(text);
        } catch (e) {
            return { status: false, message: e.message };
        }

        if (textList[0] !== `$${this.name}`) return false;

        const requiredCount = this.parameters.filter(p => !p[2]).length;
        const totalCount = this.parameters.length;
        const providedArgs = textList.length - 1;

        if (providedArgs < requiredCount || providedArgs > totalCount) {
            return { status: false, message: `参数数量错误：需要 ${requiredCount}-${totalCount} 个，但提供了 ${providedArgs} 个` };
        }

        const resultList = textList.slice(1);

        try {
            const ret = this.func(commander, ...resultList);
            if (ret && typeof ret.then === "function") {
                ret.catch((e) => {
                    if (this.onError) this.onError(e);
                });
            }
        } catch (e) {
            return { status: false, message: e.message };
        }

        return { status: true, message: resultList };
    }
}

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
    console.log("=== 模拟真实 Command.execute 调用链 ===\n");
    
    console.log("--- 测试 $fb:run ---");
    const runCmd = MockCommand.create("fb:run", "执行脚本")
        .addString("脚本内容或文件名", true)
        .setFunc(async (sender, input) => {
            await fb.runScript(sender, input);
        });
    
    const runResult = runCmd.execute("StarAwA117", '$fb:run "const ball = [{x:0,y:0,z:0},{x:1,y:0,z:0}]; setBlocks(ball);"');
    console.log("execute returned:", runResult);
    
    // 等待 Promise 完成
    if (runResult && runResult.status && runResult.message) {
        console.log("等待异步执行完成...");
        await new Promise(r => setTimeout(r, 500));
    }

    console.log("\n--- 测试 $fb:runthis ---");
    const runthisCmd = MockCommand.create("fb:runthis", "以玩家位置为中心执行")
        .addString("脚本内容或文件名", true)
        .setFunc(async (sender, input) => {
            const pos = await fb.getPlayerPosition();
            console.log("getPlayerPosition returned:", pos);
            await fb.runScript(sender, input, pos);
        });
    
    const runthisResult = runthisCmd.execute("StarAwA117", '$fb:runthis "const ball = [{x:0,y:0,z:0},{x:1,y:0,z:0}]; setBlocks(ball);"');
    console.log("execute returned:", runthisResult);
    
    if (runthisResult && runthisResult.status && runthisResult.message) {
        console.log("等待异步执行完成...");
        await new Promise(r => setTimeout(r, 500));
    }

    console.log("\n=== 诊断完成 ===");
}

main().catch((e) => {
    console.error("diag error:", e);
    process.exit(1);
});
