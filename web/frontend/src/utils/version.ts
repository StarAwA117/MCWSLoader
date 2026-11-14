/** Minimal SemVer comparison for update labels (supports beta/rc tags). */
export function compareVersions(a: string, b: string): number {
	const parse = (value: string) => {
		const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
		if (!match) return null;
		return {
			core: [Number(match[1]), Number(match[2]), Number(match[3])],
			pre: match[4] ? match[4].split(".") : []
		};
	};
	const left = parse(a);
	const right = parse(b);
	if (!left || !right) return 0;
	for (let i = 0; i < 3; i++) {
		if (left.core[i] !== right.core[i]) return left.core[i] - right.core[i];
	}
	if (!left.pre.length && !right.pre.length) return 0;
	if (!left.pre.length) return 1;
	if (!right.pre.length) return -1;
	const length = Math.max(left.pre.length, right.pre.length);
	for (let i = 0; i < length; i++) {
		const x = left.pre[i];
		const y = right.pre[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		if (x === y) continue;
		const xNumeric = /^\d+$/.test(x);
		const yNumeric = /^\d+$/.test(y);
		if (xNumeric && yNumeric) return Number(x) - Number(y);
		if (xNumeric) return -1;
		if (yNumeric) return 1;
		return x.localeCompare(y);
	}
	return 0;
}
