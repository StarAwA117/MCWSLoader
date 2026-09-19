// 诊断脚本5：精确模拟真实实例化顺序，验证 bindCommands 是否在 constructor 里就调用了 this.Command

class MockCommand {
    static create(name, desc) {
        return {
            name, desc,
            addString(_, optional) { return this; },
            setFunc(fn) { this.fn = fn; return this; }
        };
    }
}

class MockClient {
    constructor() {
        this.readyState = 1;
    }
    sendCommand(cmd) { return Promise.resolve('uuid'); }
    tell(msg, sender) { console.log('[tell]', msg); }
}

// 完全按照当前 mod/fastbuilder/main.js 的逻辑
class FastBuilder {
    constructor(client) {
        this.client = client;
        this.modName = "FastBuilder";
        this.config = {};
        this.bindCommands();  // 这里 this.Command 还未赋值
    }

    bindCommands() {
        console.log("bindCommands called, this.Command =", typeof this.Command);
        try {
            this.onCommand = () => ({
                op: [
                    this.Command.create("fb:run", "执行脚本")
                        .addString("脚本", true)
                        .setFunc(async (sender, input) => {
                            console.log("[fb:run] executed");
                        })
                ]
            });
            console.log("bindCommands success");
        } catch (e) {
            console.error("bindCommands failed:", e.message);
            throw e;
        }
    }
}

// 模拟 _instantiateMod 的真实顺序
function instantiate(ModClass, client) {
    console.log("step1: new ModClass(client)");
    const instance = new ModClass(client);
    console.log("step2: 此时 instance.onCommand =", typeof instance.onCommand);
    console.log("step3: 注入 Command");
    instance.Command = MockCommand;
    console.log("step4: 注入完成");
    return instance;
}

console.log("=== 模拟真实实例化顺序 ===");
try {
    const client = new MockClient();
    const instance = instantiate(FastBuilder, client);
    console.log("最终实例化成功");
} catch (e) {
    console.error("最终实例化失败:", e.message);
    console.error(e.stack);
}
