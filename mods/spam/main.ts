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

// 通用刷屏启动方法
function startSpam(Current, interval, generator, logMessage) {
	if (Current.has("loop")) clearInterval(Current.get("loop"));
	console.log(`< ${logMessage}`);
	Current.set("loop", setInterval(generator, interval));
}

export default class Spam extends ModBase {
	onTerminalCommand() {
		const Current = this.Current;
		return {
			ws: [
				this.Command.create("c:bye", this.t("command.cBye"))
					.setFunc((_) => {
						if (!Current.client) {
							console.log(`< ${this.t("terminal.spam.noMain")}`);
							return;
						}
						Current.client.utils.sendCommandUnsafe("/me 正在尝试退出...".repeat(100) + "退出失败");
					}),

				this.Command.create("c:attack", this.t("command.cAttack"))
					.setFunc((_) => {
						if (!Current.client) { console.log(`< ${this.t("terminal.spam.noMain")}`); return; }
						startSpam(Current, 10, () => {
							Current.client.sendCommand(`me ${replaceZeros(this.config.attack)}`);
						}, this.t("terminal.spam.attackStart"));
					}),

				this.Command.create("c:clear", this.t("command.cClear"))
					.setFunc((_) => {
						if (!Current.client) { console.log(`< ${this.t("terminal.spam.noMain")}`); return; }
						startSpam(Current, 50, () => {
							for (let i = 0; i < 8; i++) {
								Current.client.tellAll(CLEAR_TEXT);
							}
						}, this.t("terminal.spam.clearStart"));
					}),

				this.Command.create("c:ad", this.t("command.cAd"))
					.setFunc((_) => {
						if (!Current.client) { console.log(`< ${this.t("terminal.spam.noMain")}`); return; }
						startSpam(Current, (this.config.adInterval || 60000), () => {
							Current.client.tellAll(`${this.config.ad[Math.floor(Math.random() * this.config.ad.length)]}`);
						}, this.t("terminal.spam.adStart"));
					}),

				this.Command.create("c:repeat", this.t("command.cRepeat"))
					.addString("刷屏内容", true)
					.setFunc((_, text) => {
						if (!Current.client) { console.log(`< ${this.t("terminal.spam.noMain")}`); return; }
						startSpam(Current, 50, () => {
							Current.client.tellAll(text);
						}, this.t("terminal.spam.repeatStart"));
					}),

				this.Command.create("c:stop", this.t("command.cStop"))
					.setFunc((_) => {
						if (Current.has("loop")) clearInterval(Current.get("loop"));
						Current.set("loop", null);
						console.log(`< ${this.t("terminal.spam.stopped")}`);
					})
			]
		};
	}

	static onDestroy() {
		const Current = this.Current;
		if (Current.has("loop")) {
			clearInterval(Current.get("loop"));
			Current.set("loop", null);
		}
	}
}
