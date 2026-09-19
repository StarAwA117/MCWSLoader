// 诊断脚本4：模拟 _instantiateMod 的实例化顺序，验证 this.Command 是否可用

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

// 模拟当前 mod/fastbuilder 的 FastBuilder 类
class FastBuilder {
    constructor(client) {
        this.client = client;
        this.modName = "FastBuilder";
        this.config = {};
        this.bindCommands();
    }

    bindCommands() {
        this.onCommand = () => ({
            op: [
                MockCommand.create("fb:run", "执行脚本")
                    .addString("脚本", true)
                    .setFunc(async (sender, input) => {
                        console.log("[fb:run] executed");
                    })
            ]
        });
    }
}

// 模拟 _instantiateMod 的行为
function instantiate(ModClass, client) {
    const instance = new ModClass(client);
    instance.Command = MockCommand;
    return instance;
}

console.log("=== 模拟实例化顺序 ===");
try {
    const client = new MockClient();
    const instance = instantiate(FastBuilder, client);
    console.log("实例化成功");
    console.log("instance.onCommand:", typeof instance.onCommand);
    const cmdMap = instance.onCommand();
    console.log("cmdMap.op:", cmdMap.op ? cmdMap.op.length : 'N/A');
    if (cmdMap.op && cmdMap.op[0]) {
        console.log("command name:", cmdMap.op[0].name);
    }
} catch (e) {
    console.error("实例化失败:", e.message);
    console.error(e.stack);
}
