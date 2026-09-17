// NetStats - 网络状态查询模组
// 前缀: n:
// 命令: n:query [玩家], n:get [玩家], n:bind <字段> <计分板>, n:bindlist, n:bindclear, n:sapi <on/off>

const FIELDS = ["ping", "avgping", "packetloss", "avgpacketloss", "maxbps"];
const FIELD_LABELS = { ping: "延迟", avgping: "平均延迟", packetloss: "丢包", avgpacketloss: "平均丢包", maxbps: "带宽上限" };

function parseListdStats(raw) {
	if (!raw || !raw.result) return null;
	const match = String(raw.details || "").match(/###\*\s*(\{.*?\})\s*\n?\s*\*###/s);
	if (!match) return null;
	try {
		const obj = JSON.parse(match[1]);
		return obj.result || null;
	} catch { return null; }
}

function formatField(key, val) {
	if (key === "maxbps") {
		if (val >= 1000000) return (val / 1000000).toFixed(1) + " Mbps";
		if (val >= 1000) return (val / 1000).toFixed(1) + " Kbps";
		return val + " bps";
	}
	if (key === "packetloss" || key === "avgpacketloss") return (val * 100).toFixed(1) + "%";
	return val + " ms";
}

export default class NetStats {
	constructor(client) {
		this.client = client;
	}

	onCommand() {
		const bindEnabled = this.config.netstats?.bindEnabled !== false;
		const ownerCmds = [];

		if (bindEnabled) {
			ownerCmds.push(
				this.Command.create("n:bind", "将网络字段绑定到计分板")
					.addString("字段", true)
					.addString("计分板名称", true)
					.setFunc((sender, field, objective) => {
						if (!FIELDS.includes(field)) {
							return this.client.tell(`§cNetStats | §fError > §i不支持的字段: ${field}（可选: ${FIELDS.join(", ")}）`, sender);
						}
						const binds = this.storage.get("binds", {});
						binds[field] = objective;
						this.storage.set("binds", binds);
						this.client.tell(`§eNetStats | §fBind > §i已将 ${FIELD_LABELS[field]} 绑定到计分板 ${objective}`, sender);
					}),

				this.Command.create("n:bindlist", "查看所有绑定")
					.setFunc((sender) => {
						const binds = this.storage.get("binds", {});
						const entries = Object.entries(binds);
						if (!entries.length) return this.client.tell("§eNetStats | §fBindList > §i暂无绑定", sender);
						const lines = entries.map(([f, o]) => `§e${FIELD_LABELS[f]}: §f${o}`);
						this.client.tell(`§eNetStats | §fBindList\n${lines.join("\n")}`, sender);
					}),

				this.Command.create("n:bindclear", "清除指定或所有绑定")
					.addString("字段", false)
					.setFunc((sender, field) => {
						const binds = this.storage.get("binds", {});
						if (field) {
							if (!binds[field]) return this.client.tell(`§cNetStats | §fError > §i${field} 未绑定`, sender);
							delete binds[field];
							this.storage.set("binds", binds);
							this.client.tell(`§eNetStats | §fBindClear > §i已清除 ${FIELD_LABELS[field]}`, sender);
						} else {
							this.storage.set("binds", {});
							this.client.tell("§eNetStats | §fBindClear > §i已清除所有绑定", sender);
						}
					})
			);
		}

		ownerCmds.push(
			this.Command.create("n:sapi", "启用/禁用 SAPI 自动同步")
				.addString("on/off", true)
				.setFunc((sender, toggle) => {
					const enabled = toggle === "on";
					this.storage.set("sapiEnabled", enabled);
					if (enabled) this._startSAPICron();
					else this._stopSAPICron();
					this.client.tell(`§eNetStats | §fSAPI > §i${enabled ? "已启用" : "已禁用"}`, sender);
				})
		);

		return {
			user: [
				this.Command.create("n:query", "查询玩家网络状态")
					.addString("玩家名", false)
					.setFunc(async (sender, target) => {
						const name = target || (await this.client.getLocalPlayer()) || sender;
						const raw = await this.client.runCommand("/listd stats");
						const list = parseListdStats(raw);
						if (!list) return this.client.tell("§cNetStats | §fError > §i无法获取网络数据", sender);
						const player = list.find(p => p.name && p.name.toLowerCase() === name.toLowerCase());
						if (!player) return this.client.tell(`§cNetStats | §fError > §i未找到玩家 ${name}`, sender);
						const lines = FIELDS.map(f => `§e${FIELD_LABELS[f]}: §f${formatField(f, player[f] ?? 0)}`);
						this.client.tell(`§eNetStats | §fQuery > §i${player.name}\n${lines.join("\n")}`, sender);
					})
			],
			op: [
				this.Command.create("n:get", "获取玩家完整网络信息")
					.addString("玩家名", false)
					.setFunc(async (sender, target) => {
						const name = target || (await this.client.getLocalPlayer()) || sender;
						const raw = await this.client.runCommand("/listd stats");
						const list = parseListdStats(raw);
						if (!list) return this.client.tell("§cNetStats | §fError > §i无法获取网络数据", sender);
						const player = list.find(p => p.name && p.name.toLowerCase() === name.toLowerCase());
						if (!player) return this.client.tell(`§cNetStats | §fError > §i未找到玩家 ${name}`, sender);
						const lines = [
							`§e名称: §f${player.name}`,
							`§eUUID: §f${player.uuid}`,
							`§eID: §f${player.id}`,
							`§e客户端: §f${player.clientId}`,
							...FIELDS.map(f => `§e${FIELD_LABELS[f]}: §f${formatField(f, player[f] ?? 0)}`)
						];
						this.client.tell(`§eNetStats | §fGet > §i${player.name}\n${lines.join("\n")}`, sender);
					})
			],
			owner: ownerCmds
		};
	}

	async onStart() {
		this._sapiTimer = null;

		// 加载默认绑定（仅 bind 启用时）
		const bindEnabled = this.config.netstats?.bindEnabled !== false;
		if (bindEnabled) {
			const binds = this.storage.get("binds", null);
			if (binds === null) {
				const defaults = this.config.netstats?.defaultBind || {};
				const initBinds = {};
				for (const f of FIELDS) {
					if (defaults[f]) initBinds[f] = defaults[f];
				}
				this.storage.set("binds", initBinds);
			}
		}

		// SAPI 独立初始化：config 默认值 + storage 覆盖
		const sapiDefault = this.config.netstats?.sapiEnabled || false;
		const sapiEnabled = this.storage.get("sapiEnabled", sapiDefault);
		this.storage.set("sapiEnabled", sapiEnabled);
		if (sapiEnabled) this._startSAPICron();
	}

	_startSAPICron() {
		if (this._sapiTimer) return;
		const interval = this.config.netstats?.sapiInterval || 5000;
		this._sapiTimer = setInterval(async () => {
			try {
				const raw = await this.client.runCommand("/listd stats");
				const list = parseListdStats(raw);
				if (!list) return;
				const binds = this.storage.get("binds", {});
				for (const [field, objective] of Object.entries(binds)) {
					for (const player of list) {
						const val = Math.round(player[field] ?? 0);
						await this.client.runCommand(`/scoreboard players set "${player.name}" ${objective} ${val}`);
					}
				}
			} catch {}
		}, interval);
	}

	_stopSAPICron() {
		if (this._sapiTimer) { clearInterval(this._sapiTimer); this._sapiTimer = null; }
	}

	static onDestroy() {
		if (this._sapiTimer) { clearInterval(this._sapiTimer); this._sapiTimer = null; }
	}
}
