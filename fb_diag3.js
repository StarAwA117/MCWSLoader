// 诊断脚本3：完整模拟 $fb:run 执行流程，不依赖 getPosition

let cmdId = 0;
const sentCommands = [];

function createMockClient() {
	const client = {
		readyState: 1,
		sendCommand(command) {
			cmdId++;
			const id = cmdId;
			sentCommands.push({ id, command });
			console.log(`[sendCommand] #${id}: ${command}`);
			return Promise.resolve(`uuid-${id}`);
		},
		tell(msg, sender) {
			console.log(`[tell] to=${sender || '@a'} msg=${msg}`);
		}
	};
	return client;
}

// 还原 setBlocks
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
		console.log(`[setBlocks] done sent=${sent}, failed=${failed}`);
	};
}

// 模拟 V.Generator
const V = {
	Generator: {
		sphere: (radius) => {
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
	}
};

async function simulateRun(input) {
	console.log(`\n=== $fb:run input="${input}" ===`);
	const client = createMockClient();
	const sender = "StarAwA117";

	const cfg = { defaultBlock: "iron_block", origin: { x: 0, y: 0, z: 0 }, particle: "minecraft:explosion" };
	const defaultBlock = cfg.defaultBlock;
	const origin = cfg.origin;

	const sandbox = {
		...V.Generator,
		vec3: (x, y, z) => ({ x, y, z }),
		setBlocks: setBlocks(client, defaultBlock),
		tell_raw: (...msg) => {},
		broadcast: (...msg) => {},
		pos: () => Promise.resolve({ x: 0, y: 0, z: 0 }),
		setting: { block: defaultBlock, origin, particle: cfg.particle }
	};

	try {
		console.log("[_runScript] step1: 正在执行脚本...");
		client.tell("§eFastBuilder | §fRun > §i正在执行脚本...", sender);

		console.log("[_runScript] step2: 构建并执行脚本");
		const body = `with(inside) { ${input} }`;
		console.log(`[_runScript] body=${body}`);
		const fn = new Function("inside", body);
		const result = fn(sandbox);
		console.log(`[_runScript] fn returned:`, typeof result, result instanceof Promise ? "Promise" : "not Promise");

		if (result instanceof Promise) {
			console.log("[_runScript] step3: await promise");
			await result;
		}

		console.log("[_runScript] step4: 执行完成");
		client.tell("§eFastBuilder | §fRun > §i执行完成", sender);
	} catch (e) {
		console.log(`[_runScript] catch error: ${e.message}`);
		client.tell(`§cFastBuilder | §fError > §i${e.message}`, sender);
	}

	console.log(`[_runScript] total sentCommands=${sentCommands.length}`);
}

(async () => {
	await simulateRun('const ball = sphere(5, 0); setBlocks(ball);');
	await simulateRun('const ball = sphere(2, 0); setBlocks("diamond_block")(ball);');
	console.log("\n=== 诊断完成 ===");
})().catch((e) => {
	console.error("diag3 error:", e);
	process.exit(1);
});
