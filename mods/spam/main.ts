import ModBase from "../../lib/modbase.js";
// 清屏文本
const CLEAR_TEXT = "\n§r\n".repeat(31);

// 0 值替换
function replaceZeros(str) {
	const chars = [];
	for (let i = 33; i <= 126; i++) {
		if (i < 48 || i > 57) chars.push(String.fromCharCode(i));
	}
	for (let i = chars.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[chars[i], chars[j]] = [chars[j], chars[i]];
	}
	let idx = 0;
	return str.replace(/0/g, () => {
		if (idx >= chars.length) idx = 0;
		return chars[idx++];
	});
}

function stopSpam(Current) {
	if (!Current.has("loop")) return;
	const timer = Current.get("loop");
	if (timer) clearInterval(timer);
	Current.set("loop", null);
}

// 通用刷屏启动方法
function startSpam(Current, interval, generator, logMessage) {
	stopSpam(Current);
	console.log(`< ${logMessage}`);
	Current.set("loop", setInterval(() => {
		// The main client may disconnect while a loop is still running.
		if (!Current.client) return;
		try {
			generator();
		} catch (error) {
			console.error(`Spam loop error: ${error?.message ?? error}`);
		}
	}, interval));
}

export default class Spam extends ModBase {
	onTerminalCommand() {
		const Current = this.Current;
		return {
			ws: [
				this.Command.create("c:bye", this.rawtext("command.cBye"))
					.setFunc((_) => {
						if (!Current.client) {
							console.log(`< ${this.rawtext("terminal.spam.noMain")}`);
							return;
						}
						Current.client.utils.sendCommandUnsafe(`/me ${this.rawtext("spam.byeMessage")}`);
					}),

				this.Command.create("c:attack", this.rawtext("command.cAttack"))
					.setFunc((_) => {
						if (!Current.client) { console.log(`< ${this.rawtext("terminal.spam.noMain")}`); return; }
						startSpam(Current, 10, () => {
							Current.client.sendCommand(`me ${replaceZeros(this.config.attack)}`);
						}, this.rawtext("terminal.spam.attackStart"));
					}),

				this.Command.create("c:clear", this.rawtext("command.cClear"))
					.setFunc((_) => {
						if (!Current.client) { console.log(`< ${this.rawtext("terminal.spam.noMain")}`); return; }
						startSpam(Current, 50, () => {
							for (let i = 0; i < 8; i++) {
								Current.client.tellAll(CLEAR_TEXT);
							}
						}, this.rawtext("terminal.spam.clearStart"));
					}),

				this.Command.create("c:ad", this.rawtext("command.cAd"))
					.setFunc((_) => {
						if (!Current.client) { console.log(`< ${this.rawtext("terminal.spam.noMain")}`); return; }
						if (!Array.isArray(this.config.ad) || this.config.ad.length === 0) {
							console.log(`< ${this.rawtext("terminal.spam.noAds")}`);
							return;
						}
						startSpam(Current, (this.config.adInterval || 60000), () => {
							Current.client.tellAll(`${this.config.ad[Math.floor(Math.random() * this.config.ad.length)]}`);
						}, this.rawtext("terminal.spam.adStart"));
					}),

				this.Command.create("c:repeat", this.rawtext("command.cRepeat"))
					.addString(this.rawtext("spam.param.eb9f14e9a0"))
					.setFunc((_, text) => {
						if (!Current.client) { console.log(`< ${this.rawtext("terminal.spam.noMain")}`); return; }
						startSpam(Current, 50, () => {
							Current.client.tellAll(text);
						}, this.rawtext("terminal.spam.repeatStart"));
					}),

				this.Command.create("c:stop", this.rawtext("command.cStop"))
					.setFunc((_) => {
						stopSpam(Current);
						console.log(`< ${this.rawtext("terminal.spam.stopped")}`);
					})
			]
		};
	}

	onClientDisconnect(client) {
		if (client && client.trusted === false) return;
		const trusted = [...this.Current.clientMods.keys()].filter((candidate) => candidate.trusted !== false).length;
		if (trusted <= 1) stopSpam(this.Current);
	}

	static onDestroy() {
		stopSpam(this.Current);
	}
}
