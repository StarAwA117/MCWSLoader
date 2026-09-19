// 诊断脚本8：直接测试 FastBuilder 的命令处理流程，不依赖 WebSocket

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

console.log("=== 1. 检查命令注册 ===");
const cmdMap = fb.onCommand();
console.log("Registered commands:", cmdMap.op.map(c => c.name));

console.log("\n=== 2. 执行 $fb:run ===");
const runCmd = cmdMap.op.find(c => c.name === "fb:run");
const runResult = runCmd.execute("StarAwA117", '$fb:run "const ball = [{x:0,y:0,z:0},{x:1,y:0,z:0}]; setBlocks(ball);"');
console.log("Command execute result:", runResult);

console.log("\n=== 3. 执行 $fb:runthis ===");
const runthisCmd = cmdMap.op.find(c => c.name === "fb:runthis");
const runthisResult = runthisCmd.execute("StarAwA117", '$fb:runthis "const ball = [{x:0,y:0,z:0},{x:1,y:0,z:0}]; setBlocks(ball);"');
console.log("Command execute result:", runthisResult);

console.log("\n=== 4. 执行 $fb:list ===");
const listCmd = cmdMap.op.find(c => c.name === "fb:list");
const listResult = listCmd.execute("StarAwA117", "$fb:list");
console.log("Command execute result:", listResult);

console.log("\n=== 诊断完成 ===");
