import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GITHUB_API = "https://api.github.com/repos/StarAwA117/MCWSLoader";

export const CURRENT_VERSION = (
	JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf-8")) as { version: string }
).version;

export interface GitHubRelease {
	tag_name?: string;
	name?: string;
	body?: string;
	published_at?: string;
	prerelease?: boolean;
	draft?: boolean;
	target_commitish?: string;
}

export interface ReleaseInfo {
	tag: string;
	version: string;
	title: string;
	commit: string | null;
	prerelease: boolean;
	body: string | null;
	publishedAt: string | null;
}

export interface UpdateCheck {
	current: string;
	latest: string | null;
	hasUpdate: boolean;
	releaseName: string | null;
	releaseBody: string | null;
	publishedAt: string | null;
	allowPrerelease: boolean;
}

interface ParsedVersion {
	core: [number, number, number];
	prerelease: string[];
}

export function normalizeVersion(version: string): string {
	return String(version ?? "").trim().replace(/^v/i, "");
}

function parseVersion(version: string): ParsedVersion | null {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(normalizeVersion(version));
	if (!match) return null;
	return {
		core: [Number(match[1]), Number(match[2]), Number(match[3])],
		prerelease: match[4] ? match[4].split(".") : []
	};
}

/**
 * SemVer-style comparison. Returns <0 when a < b, 0 when equal, >0 when a > b.
 * Invalid versions compare as equal so callers can safely fall back to a label.
 */
export function compareVersions(a: string, b: string): number {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right) return 0;

	for (let i = 0; i < 3; i++) {
		if (left.core[i] !== right.core[i]) return left.core[i] - right.core[i];
	}

	// A stable release has higher precedence than any pre-release of the same core.
	if (!left.prerelease.length && !right.prerelease.length) return 0;
	if (!left.prerelease.length) return 1;
	if (!right.prerelease.length) return -1;

	const length = Math.max(left.prerelease.length, right.prerelease.length);
	for (let i = 0; i < length; i++) {
		const x = left.prerelease[i];
		const y = right.prerelease[i];
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

export function isNewerVersion(latest: string, current: string): boolean {
	return compareVersions(latest, current) > 0;
}

async function githubFetch<T>(apiPath: string): Promise<T> {
	const response = await fetch(`${GITHUB_API}${apiPath}`, {
		headers: {
			Accept: "application/vnd.github+json",
			"User-Agent": "MCWSLoader-UpdateChecker"
		},
		signal: AbortSignal.timeout(10000)
	});
	if (!response.ok) throw new Error(`GitHub API request failed: HTTP ${response.status}`);
	return (await response.json()) as T;
}

function toRelease(raw: GitHubRelease): ReleaseInfo | null {
	const tag = typeof raw.tag_name === "string" ? raw.tag_name : "";
	if (!tag) return null;
	return {
		tag,
		version: normalizeVersion(tag),
		title: raw.name || tag,
		commit: raw.target_commitish || null,
		prerelease: raw.prerelease === true,
		body: raw.body || null,
		publishedAt: raw.published_at || null
	};
}

/** All non-draft releases, newest SemVer first. */
export async function listReleases(allowPrerelease = false): Promise<ReleaseInfo[]> {
	const raw = await githubFetch<GitHubRelease[]>("/releases?per_page=100");
	return raw
		.filter((release) => !release.draft)
		.map(toRelease)
		.filter((release): release is ReleaseInfo => release !== null)
		.filter((release) => allowPrerelease || !release.prerelease)
		.sort((a, b) => compareVersions(b.version, a.version));
}

/** Latest release, optionally including pre-releases. */
export async function latestRelease(allowPrerelease = false): Promise<ReleaseInfo | null> {
	if (!allowPrerelease) {
		try {
			const release = toRelease(await githubFetch<GitHubRelease>("/releases/latest"));
			if (release) return release;
		} catch {
			// Fall back to the releases list when no stable release exists yet.
		}
	}
	return (await listReleases(allowPrerelease))[0] ?? null;
}

/** One-shot update check used by the WebUI and the optional startup check. */
export async function checkForUpdate(allowPrerelease = false): Promise<UpdateCheck> {
	const release = await latestRelease(allowPrerelease);
	const latest = release?.version ?? null;
	return {
		current: CURRENT_VERSION,
		latest,
		hasUpdate: latest ? isNewerVersion(latest, CURRENT_VERSION) : false,
		releaseName: release?.title ?? null,
		releaseBody: release?.body ?? null,
		publishedAt: release?.publishedAt ?? null,
		allowPrerelease
	};
}
