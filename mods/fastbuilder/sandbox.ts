import vm from "node:vm";
import ts from "typescript";

export type SandboxErrorKind = "validation" | "timeout";

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
		throw new SandboxError("validation", "The script returned an unsupported geometry value");
	}
}

function syntaxError(source: ts.SourceFile): SandboxError {
	const diagnostics = (source as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
	const first = diagnostics[0];
	const detail = first ? ts.flattenDiagnosticMessageText(first.messageText, " ") : "invalid syntax";
	return new SandboxError("validation", `JavaScript syntax error: ${detail}`);
}

function bannedIdentifier(node: ts.Identifier): string | null {
	return BANNED_IDENTIFIERS.has(node.text) ? node.text : null;
}

function validateScript(code: string): void {
	// Wrap the script so top-level await and return behave like the old function body.
	const wrapped = `(async () => {\n${code}\n})();`;
	const source = ts.createSourceFile("fastbuilder.js", wrapped, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	if (((source as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []).length) {
		throw syntaxError(source);
	}

	const visit = (node: ts.Node): void => {
		const identifier = ts.isIdentifier(node) ? bannedIdentifier(node) : null;
		if (identifier) throw new SandboxError("validation", `Identifier "${identifier}" is not allowed`);

		if (node.kind === ts.SyntaxKind.ThisKeyword || node.kind === ts.SyntaxKind.SuperKeyword) {
			throw new SandboxError("validation", "`this` and `super` are not allowed");
		}

		if (ts.isMetaProperty(node)) throw new SandboxError("validation", "meta properties are not allowed");

		if (ts.isPropertyAccessExpression(node) && BANNED_MEMBERS.has(node.name.text)) {
			throw new SandboxError("validation", `Property "${node.name.text}" is not allowed`);
		}

		if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
			if (BANNED_MEMBERS.has(node.argumentExpression.text)) {
				throw new SandboxError("validation", `Property "${node.argumentExpression.text}" is not allowed`);
			}
		}

		if (ts.isCallExpression(node)) {
			if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
				throw new SandboxError("validation", "dynamic import is not allowed");
			}
			if (ts.isIdentifier(node.expression) && BANNED_IDENTIFIERS.has(node.expression.text)) {
				throw new SandboxError("validation", `Calling "${node.expression.text}" is not allowed`);
			}
		}

		if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && BANNED_IDENTIFIERS.has(node.expression.text)) {
			throw new SandboxError("validation", `Constructing "${node.expression.text}" is not allowed`);
		}

		if (ts.isWithStatement(node)) throw new SandboxError("validation", "`with` is not allowed");
		if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
			throw new SandboxError("validation", "module imports and exports are not allowed");
		}

		ts.forEachChild(node, visit);
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
		throw new SandboxError("validation", message);
	} finally {
		if (timer) clearTimeout(timer);
	}
}
