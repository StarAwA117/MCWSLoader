// 诊断脚本2：绕过 getPosition，单独测试 setBlocks + _runScript 是否能发命令

let cmdCounter = 0;

function createMockClient() {
	const client = {
		readyState: 1,
		sendCommand(command) {
			cmdCounter++;
			console.log(`[sendCommand] #${cmdCounter}: ${command}`);
			return Promise.resolve(`uuid-${cmdCounter}`);
		},
		tell(msg) {
			console.log(`[tell] ${msg}`);
		}
	};
	return client;
}

function setBlocks(client, defaultBlock) {
	let sent = 0;
	let failed = 0;
	return (arg) => {
		if (typeof arg === "string") {
			return (space) => {
				for (const pos of space) {
					sent++;
					client.sendCommand(`setblock ${pos.x} ${pos.y} ${pos.z} ${arg}`).catch((e) => {
						failed++;
						console.error(`[setBlocks error] ${e?.message || e}`);
					});
				}
			};
		}
		const space = arg;
		for (const pos of space) {
			sent++;
			client.sendCommand(`setblock ${pos.x} ${pos.y} ${pos.z} ${defaultBlock}`).catch((e) => {
				failed++;
				console.error(`[setBlocks error] ${e?.message || e}`);
			});
		}
		console.log(`[setBlocks] sent=${sent}, failed=${failed}`);
	};
}

async function main() {
	console.log("=== 测试 setBlocks 是否真的发包 ===");
	const client = createMockClient();
	const ball = [
		{ x: 0, y: 0, z: 0 },
		{ x: 1, y: 0, z: 0 },
		{ x: -1, y: 0, z: 0 },
		{ x: 0, y: 1, z: 0 },
		{ x: 0, y: -1, z: 0 },
	];
	const setter = setBlocks(client, "iron_block");
	setter(ball);

	console.log("\n=== 测试完整 _runScript 内联脚本（不依赖 getPosition） ===");
	const client2 = createMockClient();
	const code = 'const ball = [{x:0,y:0,z:0},{x:1,y:0,z:0}]; setBlocks(ball);';
	const sandbox = {
		vec3: (x, y, z) => ({ x, y, z }),
		setBlocks: setBlocks(client2, "iron_block"),
		tell_raw: () => {},
		broadcast: () => {},
		pos: () => Promise.resolve({ x: 0, y: 0, z: 0 }),
		setting: { block: "iron_block", origin: { x: 0, y: 0, z: 0 }, particle: "minecraft:explosion" }
	};
	const body = `with(inside) { ${code} }`;
	const fn = new Function("inside", body);
	const result = fn(sandbox);
	if (result instanceof Promise) {
		await result;
	}
	console.log("[runScript] finished");
}

main().catch((e) => {
	console.error("diag2 error:", e);
	process.exit(1);
});
