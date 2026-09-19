// 诊断脚本：还原 mod/fastbuilder/main.js 的关键行为，找出“无提示、无填充”原因

let cmdCounter = 0;
const commandBack = new Map();
let wsReadyState = 1;

function createMockClient() {
	const client = {
		readyState: wsReadyState,
		sendCommand(command) {
			cmdCounter++;
			console.log(`[sendCommand] #${cmdCounter}: ${command}`);
			return Promise.resolve(`uuid-${cmdCounter}`);
		},
		runCommand(command) {
			console.log(`[runCommand] ${command}`);
			return new Promise((resolve) => {
				const id = cmdCounter;
				setTimeout(() => {
					const details = JSON.stringify([{ position: { x: 10, y: 4, z: -3 } }]);
					resolve({ body: { statusCode: 0, details } });
					console.log(`[runCommand] resolved for ${command}`);
				}, 0);
			});
		},
		getLocation(target) {
			console.log(`[getLocation] ${target}`);
			return this.runCommand(`querytarget ${target}`).then((data) => {
				try {
					const details = JSON.parse(data.body.details);
					if (Array.isArray(details) && details[0]?.position) {
						return { x: details[0].position.x, y: details[0].position.y, z: details[0].position.z };
					}
				} catch {}
				return null;
			}).catch(() => null);
		},
		tell(msg) {
			console.log(`[tell] ${msg}`);
		}
	};
	return client;
}

// 还原原版 getPosition
function getPosition(client) {
	console.log(`[getPosition] start`);
	return new Promise((resolve) => {
		client.sendCommand("testforblock ~ ~ ~ air", ({ body }) => {
			console.log(`[getPosition] sendCommand callback fired, body=`, body);
			if (body && body.position) {
				resolve(body.position);
			} else {
				resolve({ x: 0, y: 0, z: 0 });
			}
		}).catch(() => {
			console.log(`[getPosition] sendCommand rejected`);
			resolve({ x: 0, y: 0, z: 0 });
		});
	});
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
		console.log(`[setBlocks] sent=${sent}, failed=${failed}`);
	};
}

async function main() {
	console.log("=== 1. 测试 sendCommand 是否触发第二个参数回调 ===");
	const c1 = createMockClient();
	await getPosition(c1);

	console.log("\n=== 2. 测试 setBlocks 是否真的发包 ===");
	const c2 = createMockClient();
	const ball = [
		{ x: 0, y: 0, z: 0 },
		{ x: 1, y: 0, z: 0 },
		{ x: -1, y: 0, z: 0 },
		{ x: 0, y: 1, z: 0 },
		{ x: 0, y: -1, z: 0 },
	];
	const setter = setBlocks(c2, "iron_block");
	setter(ball);

	console.log("\n=== 3. 测试完整 _runScript 内联脚本 ===");
	const c3 = createMockClient();
	const code = 'const ball = [{x:0,y:0,z:0},{x:1,y:0,z:0}]; setBlocks(ball);';
	const sandbox = {
		vec3: (x, y, z) => ({ x, y, z }),
		setBlocks: setBlocks(c3, "iron_block"),
		tell_raw: (...msg) => {},
		broadcast: (...msg) => {},
		pos: () => getPosition(c3),
		setting: { block: "iron_block", origin: { x: 0, y: 0, z: 0 }, particle: "minecraft:explosion" }
	};
	const body = `with(inside) { ${code} }`;
	const fn = new Function("inside", body);
	const result = fn(sandbox);
	if (result instanceof Promise) {
		await result;
	}
	console.log("[runScript] finished");

	console.log("\n=== 诊断完成 ===");
}

main().catch((e) => {
	console.error("diag error:", e);
	process.exit(1);
});
