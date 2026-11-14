import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import { config } from "./mods.js";
import type { Client, Location } from "../types/client.js";
import type { CommandResponse } from "../types/config.js";

const { OPEN: wsOPEN } = WebSocket;

type EventCallback = (data: CommandResponse) => void;
type CommandCallback = (data: CommandResponse) => void;

/**
 * WebSocket 工具类
 * 封装了与 Minecraft Bedrock WebSocket API 的所有交互
 * 包括命令发送、事件订阅、消息分发等功能
 */
export default class Utils {
	client: Client | null;
	permission = 0;
	tellAllToTell: boolean;

	/** 命令响应回调：requestId -> callback */
	commandBack: Map<string, CommandCallback>;
	/** 事件回调：eventName -> callbacks */
	subscribeBack: Map<string, EventCallback[]>;
	/** 订阅归属表：owner(Mod 名) -> Array<[event, callback]> */
	ownerBack: Map<string, Array<[string, EventCallback]>>;
	/** 已向游戏端订阅的事件集合（同一事件只订阅一次） */
	subscribedEvents: Set<string>;

	_inWorldTimer: NodeJS.Timeout | null = null;
	_permissionTimer: NodeJS.Timeout | null = null;
	_worldProbes = 0;
	_rlState: { windowStart: number; count: number } | null = null;

	/**
	 * 字符串分割方法
	 * 用于分割所发送的消息命令，防止发送超长包
	 * @param str 要分割的字符串
	 * @param maxBytes 最大字节数
	 * @returns 分割后的字符串数组
	 */
	static splitByBytes(str: string, maxBytes: number): string[] {
		const result: string[] = [];
		let start = 0;
		let bytes = 0;
		// 单次遍历并按 UTF-8 字节数累加：避免逐字符 slice + Buffer.byteLength 的 O(n²) 开销
		for (let i = 0; i < str.length; ) {
			const cp = str.codePointAt(i) ?? 0;
			const charLen = cp > 0xffff ? 2 : 1;
			const charBytes = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
			if (bytes + charBytes > maxBytes && i > start) {
				result.push(str.slice(start, i));
				start = i;
				bytes = 0;
			}
			// 单个字符本身超限：单独成段，保证必定前进
			if (charBytes > maxBytes) {
				result.push(str.slice(i, i + charLen));
				i += charLen;
				start = i;
				bytes = 0;
				continue;
			}
			bytes += charBytes;
			i += charLen;
		}
		if (start < str.length) result.push(str.slice(start));
		return result;
	}

	constructor(client: Client) {
		this.client = client;

		// 将方法绑定到 client
		client.sendCommand = this.sendCommand.bind(this);
		client.runCommand = this.runCommand.bind(this);
		client.subscribe = this.subscribe.bind(this);
		client.unsubscribe = this.unsubscribe.bind(this);
		client.tellAll = this.tellAll.bind(this);
		client.tell = this.tell.bind(this);
		client.getLocation = this.getLocation.bind(this);
		client.getPosition = this.getPosition.bind(this);
		client.getDimension = this.getDimension.bind(this);
		client.getInventory = this.getInventory.bind(this);
		client.getLocalPlayer = this.getLocalPlayer.bind(this);
		client.closechat = this.closechat.bind(this);
		client.getPermission = this.getPermission.bind(this);

		// 状态标记
		// permission: 0=未进入世界/未知 1=普通 2=OP 3=最高
		this.permission = 0;
		// tellAll 转发模式（默认取配置值，可按客户端用 Tool 命令单独开关）
		this.tellAllToTell = config.utils?.tellAllToTell ?? false;

		// 启动轮询
		if (config.utils?.enablePolling) {
			this.startPolling();
		}

		// 各种操作的返回 Map
		this.commandBack = new Map();
		this.subscribeBack = new Map();
		this.ownerBack = new Map();
		this.subscribedEvents = new Set();
	}

	/** 调试发包记录 */
	_saveLog(message: string, error: Error | null = null): void {
		logger.debug(`Server -> Client ${message}`);
		if (error) {
			logger.error("服务端发包错误");
			logger.debug(error.message);
		}
	}

	/**
	 * 无检测的命令发送方法
	 * 该方法可能会抛出错误
	 */
	sendCommandUnsafe(command: string, uuid: string = randomUUID()): Promise<string> {
		return new Promise((resolve, reject) => {
			const client = this.client;
			if (!client) {
				reject(new Error("该 Client 无效或非活跃"));
				return;
			}

			const cmd = {
				body: {
					origin: { type: "player" },
					commandLine: command,
					version: 17104896
				},
				header: {
					requestId: uuid,
					messagePurpose: "commandRequest",
					version: 1,
					messageType: "commandRequest"
				}
			};

			client.send(JSON.stringify(cmd), (error?: Error) => {
				this._saveLog(JSON.stringify(cmd), error ?? null);
				if (error) reject(error);
				else resolve(uuid);
			});
		});
	}

	/**
	 * 有检测的命令发送方法
	 * 该方法可能会抛出错误
	 */
	async sendCommandWithCheck(command: string, uuid?: string): Promise<string> {
		if (typeof command !== "string") throw new Error("命令格式错误");
		const client = this.client;
		if (!client || client.readyState !== wsOPEN) throw new Error("该 Client 无效或非活跃");

		// 游戏接收到 >461 字节的命令会返回 Block / NetherNet 错误并退出房间
		const maxLength = config.command?.maxLength ?? 461;
		if (Buffer.byteLength(command, "utf8") > maxLength) throw new Error("命令长度过长");

		// 命令转发限流：超出窗口上限时统一延后到下一个游戏刻发送
		const rl = config.command?.rateLimit ?? {};
		const windowMs = rl.windowMs !== undefined && rl.windowMs > 0 ? rl.windowMs : 50;
		const maxPerWindow = rl.maxPerWindow !== undefined && rl.maxPerWindow > 0 ? rl.maxPerWindow : 1024;
		if (rl.enabled !== false) {
			const now = Date.now();
			if (!this._rlState) this._rlState = { windowStart: now, count: 0 };
			const state = this._rlState;
			// 并发调用会同时被唤醒，必须循环重新检查，否则仍可能超发
			for (;;) {
				const t = Date.now();
				if (t - state.windowStart >= windowMs) {
					state.windowStart = t;
					state.count = 0;
				}
				if (state.count < maxPerWindow) {
					state.count++;
					break;
				}
				const delay = Math.max(1, windowMs - (t - state.windowStart));
				await new Promise((resolve) => setTimeout(resolve, delay));
			}
		}

		return this.sendCommandUnsafe(command, uuid);
	}

	/** 无报错的执行命令方法 */
	sendCommand(command: string): Promise<string | undefined> {
		return this.sendCommandWithCheck(command).catch(() => undefined);
	}

	/**
	 * 带返回的命令执行方法
	 * 该方法可能会抛出错误
	 * @param timeout 超时时间（毫秒），默认 10 秒
	 */
	runCommand(command: string, timeout = 10000): Promise<CommandResponse> {
		return new Promise((resolve, reject) => {
			// 先以预生成 UUID 注册回调，再发送命令，避免响应先于注册到达导致命令悬挂到超时
			const uuid = randomUUID();
			let timer: NodeJS.Timeout | null = null;

			const handler = (data: CommandResponse): void => {
				if (timer) clearTimeout(timer);
				resolve(data);
			};
			this.commandBack.set(uuid, handler);

			timer = setTimeout(() => {
				this.commandBack.delete(uuid);
				reject(new Error("命令响应超时"));
			}, timeout);

			this.sendCommandWithCheck(command, uuid).catch((e: Error) => {
				if (timer) clearTimeout(timer);
				this.commandBack.delete(uuid);
				reject(e);
			});
		});
	}

	/**
	 * 订阅事件方法
	 * @param owner 订阅归属（Mod 名），用于按归属批量移除
	 */
	subscribe(event: string, callback: EventCallback | null = null, owner: string | null = null): boolean | void {
		if (typeof event !== "string" || (callback && typeof callback !== "function")) {
			throw new Error("非法 Event 或 非 null 下的非法 callback");
		}
		const client = this.client;
		if (!client || client.readyState !== wsOPEN) return false;

		if (callback) {
			const list = this.subscribeBack.get(event);
			if (list) list.push(callback);
			else this.subscribeBack.set(event, [callback]);

			if (owner) {
				const owned = this.ownerBack.get(owner);
				if (owned) owned.push([event, callback]);
				else this.ownerBack.set(owner, [[event, callback]]);
			}
		}

		// 同一事件已订阅过则不再重复发包，避免游戏端重复触发
		if (this.subscribedEvents.has(event)) return true;
		this.subscribedEvents.add(event);

		const sub = {
			body: { eventName: event },
			header: {
				requestId: randomUUID(),
				messagePurpose: "subscribe",
				version: 1,
				messageType: "commandRequest"
			}
		};

		client.send(JSON.stringify(sub), (error?: Error) => {
			this._saveLog(JSON.stringify(sub), error ?? null);
		});
	}

	/** 取消订阅事件方法 */
	unsubscribe(event: string): boolean | void {
		if (typeof event !== "string") throw new Error("非法 Event");
		const client = this.client;
		if (!client || client.readyState !== wsOPEN) return false;

		this.subscribedEvents.delete(event);

		// 同步清理 ownerBack 中该事件的记录，避免 removeOwner 误删重新订阅后的新回调
		for (const [owner, subs] of this.ownerBack) {
			const remain = subs.filter(([ev]) => ev !== event);
			if (remain.length === 0) this.ownerBack.delete(owner);
			else this.ownerBack.set(owner, remain);
		}

		const unsub = {
			body: { eventName: event },
			header: {
				requestId: randomUUID(),
				messagePurpose: "unsubscribe",
				version: 1,
				messageType: "commandRequest"
			}
		};

		client.send(JSON.stringify(unsub), (error?: Error) => {
			if (!error) this.subscribeBack.delete(event);
			this._saveLog(JSON.stringify(unsub), error ?? null);
		});
	}

	/** 全局发送消息（使用 me 命令） */
	tellAll(msg: string): void {
		if (this.tellAllToTell) {
			this.tell(msg);
			return;
		}
		Utils.splitByBytes(msg, 420).forEach((m) => {
			void this.sendCommand(`me ${m}`);
		});
	}

	/**
	 * 对可选目标发送消息（tellraw，需要 OP 权限）
	 * @param current 目标选择器（默认 @a）
	 * @param isPrefix 是否加标识前缀
	 */
	tell(msg: string, current = "@a", isPrefix = true): void {
		const prefixParts = isPrefix
			? [{ text: "* " }, { translate: "commands.origin.external" }, { text: " " }]
			: [];

		const maxCmd = config.command?.maxLength ?? 461;
		const buildCommand = (text: string): string =>
			`tellraw ${current} ${JSON.stringify({ rawtext: [...prefixParts, { text }] })}`;
		// 固定开销：命令外壳 + 前缀 + 空文本/JSON 结构
		const overhead = Buffer.byteLength(buildCommand(""), "utf8");
		const budget = Math.max(1, maxCmd - overhead);

		let start = 0;
		let escapedBytes = 0;
		const flush = (end: number): void => {
			const chunk = msg.slice(start, end);
			if (chunk) void this.sendCommand(buildCommand(chunk));
			start = end;
			escapedBytes = 0;
		};

		for (let i = 0; i < msg.length; ) {
			const cp = msg.codePointAt(i) ?? 0;
			const charLen = cp > 0xffff ? 2 : 1;
			// JSON 转义后的字节数：控制字符变为 \u00XX，引号/反斜杠加一个转义符
			const charBytes =
				cp === 0x22 || cp === 0x5c ? 2 : cp < 0x20 ? 6 : cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;

			if (escapedBytes + charBytes > budget && i > start) flush(i);
			// 单个字符就超出预算：单独发送，避免死循环
			if (charBytes > budget) {
				void this.sendCommand(buildCommand(msg.slice(i, i + charLen)));
				i += charLen;
				start = i;
				escapedBytes = 0;
				continue;
			}
			escapedBytes += charBytes;
			i += charLen;
		}
		flush(msg.length);
	}

	/**
	 * 获取位置方法
	 * @param target 目标选择器
	 */
	async getLocation(target: string): Promise<Location | undefined> {
		let data: CommandResponse;
		try {
			data = await this.runCommand(`querytarget ${target}`);
		} catch {
			return undefined;
		}

		if (data.body?.statusCode) return undefined;

		let details = data.body?.details;
		if (!details) return undefined;

		if (typeof details === "string") {
			try {
				details = JSON.parse(details);
			} catch {
				return undefined;
			}
		}

		const entry = Array.isArray(details) ? details[0] : details;
		if (!entry || typeof entry !== "object" || !("position" in entry)) return undefined;
		const typed = entry as { position?: { x: number; y: number; z: number }; dimension?: string };
		if (!typed.position) return undefined;
		return { ...typed.position, dimension: typed.dimension ?? "" };
	}

	async getPosition(target: string): Promise<{ x: number; y: number; z: number } | null> {
		const location = await this.getLocation(target);
		return location ? { x: location.x, y: location.y, z: location.z } : null;
	}

	async getDimension(target: string): Promise<string | undefined> {
		return (await this.getLocation(target))?.dimension;
	}

	async getInventory(target: string): Promise<unknown> {
		try {
			const data = await this.runCommand(`codebuilder_actorinfo inventory ${target}`);
			return data.body?.inventory;
		} catch {
			return undefined;
		}
	}

	async getLocalPlayer(): Promise<string | undefined> {
		try {
			const data = await this.runCommand("getlocalplayername");
			return data.body?.localplayername as string | undefined;
		} catch {
			return undefined;
		}
	}

	async closechat(): Promise<boolean | undefined> {
		try {
			const data = await this.runCommand("closechat");
			return data.body ? data.body.statusCode === 0 : false;
		} catch {
			return undefined;
		}
	}

	/** 权限等级：0=未进入世界/未知 1=普通 2=OP 3=最高 */
	getPermission(): number {
		return this.permission;
	}

	getTellAllMode(): boolean {
		return this.tellAllToTell;
	}

	setTellAllMode(enabled: boolean): boolean {
		this.tellAllToTell = !!enabled;
		return this.tellAllToTell;
	}

	/** 启动轮询：未进世界 1s，进入后 15s；权限每 60s 检测 */
	startPolling(): void {
		if (this._inWorldTimer) return;
		this._scheduleInWorldCheck(0);
		this._permissionTimer = setInterval(() => this._checkPermission(), 60000);
		void this._checkPermission();
	}

	_scheduleInWorldCheck(delay: number): void {
		this._inWorldTimer = setTimeout(async () => {
			await this._checkInWorld();
			if (!this.client) return;
			this._worldProbes++;
			const next = this.permission === 0 ? (this._worldProbes > 30 ? 3000 : 1000) : 15000;
			if (this.permission !== 0) this._worldProbes = 0;
			this._scheduleInWorldCheck(next);
		}, delay);
	}

	/** 用短超时的 /list 判断是否已进入世界 */
	async _checkInWorld(): Promise<void> {
		const client = this.client;
		if (!client || client.readyState !== wsOPEN) return;
		try {
			await this.runCommand("list", 500);
			if (this.permission === 0) this.permission = 1;
		} catch {
			this.permission = 0;
		}
	}

	/** 权限等级检测：testfor + listd */
	async _checkPermission(): Promise<void> {
		if (this.permission === 0) return;
		const client = this.client;
		if (!client || client.readyState !== wsOPEN) return;

		try {
			const testfor = await this.runCommand("testfor @a", 5000);
			if (testfor.body?.statusCode) {
				this.permission = 1;
				return;
			}
			const listd = await this.runCommand("listd", 5000);
			this.permission = listd.body?.statusCode ? 2 : 3;
		} catch {
			// 命令超时等异常：保留当前权限值，避免误标记
		}
	}

	/** 接收消息方法 */
	onMessage(data: CommandResponse): void {
		const purpose = data?.header?.messagePurpose;
		if (!purpose) return;

		logger.debug(`Client -> Server ${JSON.stringify(data)}`);

		if (purpose === "event") {
			const eventName = data.header?.eventName;
			if (!eventName) return;
			const callbacks = this.subscribeBack.get(eventName);
			if (!callbacks) return;
			for (const callback of callbacks) {
				try {
					callback(data);
				} catch (e) {
					logger.error("订阅返回包 Callback 函数错误");
					logger.debug((e as Error).message);
				}
			}
		} else if (purpose === "commandResponse") {
			const uuid = data.header?.requestId;
			if (!uuid) return;
			const callback = this.commandBack.get(uuid);
			if (!callback) return;
			try {
				callback(data);
			} catch (e) {
				logger.error("命令返回包 Callback 函数错误");
				logger.debug((e as Error).message);
			}
			this.commandBack.delete(uuid);
		}
	}

	/** 按归属（Mod 名）批量移除订阅 */
	removeOwner(owner: string): void {
		const subs = this.ownerBack.get(owner);
		if (!subs) return;
		for (const [event, callback] of subs) {
			const list = this.subscribeBack.get(event);
			if (list) {
				const idx = list.indexOf(callback);
				if (idx !== -1) list.splice(idx, 1);
				if (list.length === 0) {
					this.subscribeBack.delete(event);
					this.subscribedEvents.delete(event);
				}
			}
		}
		this.ownerBack.delete(owner);
	}

	/** 销毁方法 */
	destroy(): void {
		if (this._inWorldTimer) clearTimeout(this._inWorldTimer);
		if (this._permissionTimer) clearInterval(this._permissionTimer);
		this._inWorldTimer = null;
		this._permissionTimer = null;
		this.client = null;
		this.commandBack.clear();
		this.subscribeBack.clear();
		this.ownerBack.clear();
		this.subscribedEvents.clear();
		this._rlState = null;
	}
}
