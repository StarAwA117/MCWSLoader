import vm from "node:vm";
import { parse } from "acorn";

export type SandboxErrorKind = "validation" | "timeout" | "runtime";

export class SandboxError extends Error {
	constructor(public readonly kind: SandboxErrorKind, message: string) {
		super(message);
		this.name = "SandboxError";
	}
}

export interface SandboxPosition {
	x: number;
	y: number;
	z: number;
}

export interface FastBuilderSandboxOptions {
	code: string;
	geometry: Record<string, unknown>;
	setting: Record<string, unknown>;
	position: SandboxPosition;
	setBlocks: (arg: unknown) => unknown;
	tellRaw: (...messages: unknown[]) => void;
	broadcast: (...messages: unknown[]) => void;
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

/** Names that cannot appear anywhere in a script identifier. */
const BANNED_IDENTIFIERS = new Set([
	"__dirname", "__filename", "global", "globalThis", "window", "self",
	"process", "require", "module", "exports", "Deno", "Bun",
	"Function", "eval", "Proxy", "Reflect", "Object", "WebAssembly",
	"Atomics", "SharedArrayBuffer", "navigator", "XMLHttpRequest", "fetch",
	"setTimeout", "setInterval", "setImmediate", "queueMicrotask",
	"importScripts", "console", "arguments", "constructor"
]);

/** Member names that expose host constructors or prototype mutation. */
const BANNED_MEMBERS = new Set([
	"constructor", "__proto__", "prototype", "caller", "callee", "arguments",
	"call", "apply", "bind", "getPrototypeOf", "setPrototypeOf",
	"defineProperty", "defineProperties", "getOwnPropertyDescriptor",
	"getOwnPropertyDescriptors", "getOwnPropertyNames", "getOwnPropertySymbols",
	"create", "__defineGetter__", "__defineSetter__", "__lookupGetter__",
	"__lookupSetter__"
]);

function cloneToContext(value: unknown, context: vm.Context): unknown {
	if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
	if (typeof value === "function") return value;
	try {
		const json = JSON.stringify(value);
		if (json === undefined) return undefined;
		return vm.runInContext(`(${json})`, context, { timeout: 1000 });
	} catch {
		throw new SandboxError("runtime", "The script returned an unsupported geometry value");
	}
}

function validateScript(code: string): void {
	// Wrap the script so top-level await and return behave like the old function body.
	const wrapped = `(async () => {\n${code}\n})();`;
	let source: any;
	try {
		source = parse(wrapped, { ecmaVersion: "latest", sourceType: "script" });
	} catch (error) {
		throw new SandboxError("validation", `JavaScript syntax error: ${error instanceof Error ? error.message : String(error)}`);
	}

	const visit = (node: any): void => {
		if (!node || typeof node !== "object") return;

		if (node.type === "Identifier" && BANNED_IDENTIFIERS.has(node.name)) {
			throw new SandboxError("validation", `Identifier "${node.name}" is not allowed`);
		}

		if (node.type === "ThisExpression" || node.type === "Super") {
			throw new SandboxError("validation", "`this` and `super` are not allowed");
		}

		if (node.type === "MetaProperty") {
			throw new SandboxError("validation", "meta properties are not allowed");
		}

		if (node.type === "MemberExpression" && !node.computed && node.property?.type === "Identifier" && BANNED_MEMBERS.has(node.property.name)) {
			throw new SandboxError("validation", `Property "${node.property.name}" is not allowed`);
		}

		if (node.type === "MemberExpression" && node.computed && node.property?.type === "Literal" && typeof node.property.value === "string" && BANNED_MEMBERS.has(node.property.value)) {
			throw new SandboxError("validation", `Property "${node.property.value}" is not allowed`);
		}

		if (node.type === "CallExpression") {
			if (node.callee?.type === "Import") throw new SandboxError("validation", "dynamic import is not allowed");
			if (node.callee?.type === "Identifier" && BANNED_IDENTIFIERS.has(node.callee.name)) {
				throw new SandboxError("validation", `Calling "${node.callee.name}" is not allowed`);
			}
		}

		if (node.type === "NewExpression" && node.callee?.type === "Identifier" && BANNED_IDENTIFIERS.has(node.callee.name)) {
			throw new SandboxError("validation", `Constructing "${node.callee.name}" is not allowed`);
		}

		if (node.type === "ImportExpression") throw new SandboxError("validation", "dynamic import is not allowed");
		if (node.type === "WithStatement") throw new SandboxError("validation", "`with` is not allowed");
		if (node.type === "ImportDeclaration" || node.type === "ExportDeclaration" || node.type === "ImportEqualsDeclaration") {
			throw new SandboxError("validation", "module imports and exports are not allowed");
		}

		for (const [key, value] of Object.entries(node)) {
			if (key === "parent") continue;
			if (Array.isArray(value)) value.forEach(visit);
			else if (value && typeof value === "object") visit(value);
		}
	};
	visit(source);
}

function guardHostValue(
	value: unknown,
	context: vm.Context,
	guards: WeakMap<object, unknown>
): unknown {
	if (!value) return value;
	if (typeof value !== "object" && typeof value !== "function") return value;
	const existing = guards.get(value as object);
	if (existing) return existing;

	if (typeof value === "function") {
		// A normal function preserves `this` for Array iterator methods. Its
		// non-configurable prototype is explicitly cleared so the get trap can
		// safely hide prototype-based escape routes.
		const callable = function (this: unknown, ...args: unknown[]) {
			return guardHostValue(Reflect.apply(value, this, args), context, guards);
		};
		callable.prototype = undefined;
		const proxy = new Proxy(callable, {
			get(target, property, receiver) {
				if (typeof property === "string" && BANNED_MEMBERS.has(property)) return undefined;
				return guardHostValue(Reflect.get(target, property, receiver), context, guards);
			},
			apply(_target, thisArg, args) {
				return guardHostValue(Reflect.apply(value, thisArg, args), context, guards);
			},
			construct(_target, args) {
				return guardHostValue(Reflect.construct(value as new (...args: unknown[]) => unknown, args, value as Function), context, guards) as object;
			}
		});
		guards.set(value, proxy);
		return proxy;
	}

	// Plain geometry results are cloned into the VM realm. This avoids proxying
	// built-in iterators, whose native methods perform realm/brand checks.
	const cloned = cloneToContext(value, context);
	guards.set(value, cloned);
	return cloned;
}


/**
 * Run a FastBuilder script in a VM context.
 *
 * The context has no Node globals, no code-generation builtins and only the
 * builder API. Scripts are syntax-checked before execution; host values are
 * filtered so constructor/prototype lookups cannot reach the host realm.
 */
export async function runFastBuilderScript(options: FastBuilderSandboxOptions): Promise<void> {
	validateScript(options.code);

	const context = vm.createContext(Object.create(null), {
		name: "mcws-fastbuilder",
		codeGeneration: { strings: false, wasm: false }
	});

	const guards = new WeakMap<object, unknown>();
	const define = (name: string, value: unknown): void => {
		if (BANNED_IDENTIFIERS.has(name) || name === "__proto__") return;
		Object.defineProperty(context, name, {
			value: guardHostValue(value, context, guards),
			writable: true,
			enumerable: true,
			configurable: true
		});
	};

	for (const [name, value] of Object.entries(options.geometry)) define(name, value);
	define("setBlocks", options.setBlocks);
	define("tell_raw", options.tellRaw);
	define("broadcast", options.broadcast);

	// These are constructed inside the context so the script never receives a host promise.
	const settingJson = JSON.stringify(options.setting);
	const positionJson = JSON.stringify(options.position);
	vm.runInContext(`globalThis.setting = ${settingJson}; globalThis.vec3 = (x, y, z) => ({ x, y, z }); globalThis.pos = () => (${positionJson});`, context, {
		timeout: 1000
	});

	const wrapped = `(async () => {\n${options.code}\n})();`;
	let timer: ReturnType<typeof setTimeout> | null = null;
	try {
		const result = vm.runInContext(wrapped, context, {
			filename: "fastbuilder-script.js",
			timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			displayErrors: false
		}) as Promise<unknown>;
		await Promise.race([
			Promise.resolve(result),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					reject(new SandboxError("timeout", "Script execution timed out"));
				}, (options.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 100);
			})
		]);
	} catch (error) {
		if (error instanceof SandboxError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		if (/timed out/i.test(message)) {
			throw new SandboxError("timeout", message.replace(/^Error:\s*/, ""));
		}
		throw new SandboxError("runtime", message);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
