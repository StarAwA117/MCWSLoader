/** Storage can be unavailable in a file:// WebView or private sandbox. */
export function getSession(key: string): string | null {
	try {
		return sessionStorage.getItem(key);
	} catch {
		return null;
	}
}

export function setSession(key: string, value: string): void {
	try {
		sessionStorage.setItem(key, value);
	} catch {
		// The standalone WebUI does not need a token.
	}
}

export function removeSession(key: string): void {
	try {
		sessionStorage.removeItem(key);
	} catch {
		// ignore
	}
}

export function getLocal(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

export function setLocal(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// ignore
	}
}
