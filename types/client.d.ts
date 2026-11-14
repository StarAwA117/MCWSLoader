import type { CommandResponse } from "./config.js";
import type { ClientModManager } from "../lib/mods.js";
import type Utils from "../lib/utils.js";

export interface Location {
	x: number;
	y: number;
	z: number;
	dimension: string;
}

/**
 * WebSocket 客户端连接。
 *
 * Utils 在构造时会把下列方法绑定到连接对象上，因此 Mod 可以直接通过
 * `this.client.tell(...)` 等方式调用。
 */
export interface Client {
	id: string;
	readyState: number;
	_socket?: { remoteAddress?: string };
	_connectedAt?: number;
	localPlayerName?: string | null;
	clientMod?: ClientModManager;
	utils?: Utils;

	send(data: string | Buffer, callback?: (error?: Error) => void): void;
	close(code?: number, reason?: string): void;
	terminate(): void;

	sendCommand(command: string): Promise<string | undefined>;
	sendCommandUnsafe(command: string, uuid?: string): Promise<string>;
	runCommand(command: string, timeout?: number): Promise<CommandResponse>;

	subscribe(
		event: string,
		callback?: ((data: CommandResponse) => void) | null,
		owner?: string | null
	): boolean | void;
	unsubscribe(event: string): boolean | void;

	tellAll(msg: string): void;
	tell(msg: string, target?: string, isPrefix?: boolean): void;

	getLocation(target: string): Promise<Location | undefined>;
	getPosition(target: string): Promise<{ x: number; y: number; z: number } | null>;
	getDimension(target: string): Promise<string | undefined>;
	getInventory(target: string): Promise<unknown>;
	getLocalPlayer(): Promise<string | undefined>;
	closechat(): Promise<boolean | undefined>;
	getPermission(): number;

	/** 客户端 Mod 实例会以 Mod 名挂到连接对象上 */
	[key: string]: unknown;
}
