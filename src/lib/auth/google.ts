/**
 * Google Identity Services (GIS) integration — browser only.
 *
 * Obtains a Google ID token (JWT) that the Lambda verifies. Tokens are short
 * lived (~1h); this module persists the current token to localStorage so it
 * survives reloads until expiry.
 *
 * Token renewal is kept OFF the hot path. `getIdToken()` is a pure read — it
 * never triggers UI. When a token is missing/stale, `ensureFreshToken()`
 * attempts a single *silent* renewal (GIS `auto_select` re-issues a credential
 * with no prompt if the Google session is alive and consent was given). It does
 * NOT fall back to the One Tap prompt automatically, because repeated prompts
 * trip Google's exponential cooldown and cause the "keeps asking me to log in"
 * problem. If silent renewal can't produce a token, we flag that an explicit
 * sign-in is needed and the UI shows the sign-in button instead.
 */
import { authStore } from './state.svelte';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const STORAGE_KEY = 'sl_google_id_token';
const EXPIRY_SKEW_MS = 30_000;
// Minimum gap between silent-renewal attempts, so a failing session doesn't
// hammer GIS on every sync tick.
const SILENT_RETRY_COOLDOWN_MS = 60_000;

let currentToken: string | null = null;
let currentExpiryMs = 0;
let currentEmail: string | null = null;
let scriptPromise: Promise<void> | null = null;
let initialized = false;
let silentRefreshInFlight: Promise<string | null> | null = null;
let lastSilentAttemptMs = 0;

interface GoogleIdClaims {
	email?: string;
	exp?: number;
	[k: string]: unknown;
}

function decodeJwtPayload(token: string): GoogleIdClaims | null {
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	try {
		const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
		const json = decodeURIComponent(
			atob(b64 + pad)
				.split('')
				.map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
				.join('')
		);
		return JSON.parse(json);
	} catch {
		return null;
	}
}

function persist(): void {
	try {
		if (currentToken) {
			localStorage.setItem(STORAGE_KEY, currentToken);
		} else {
			localStorage.removeItem(STORAGE_KEY);
		}
	} catch {
		// Ignore storage failures (private mode, etc.).
	}
}

function tokenIsFresh(): boolean {
	return !!currentToken && currentExpiryMs - EXPIRY_SKEW_MS > Date.now();
}

function applyToken(token: string): boolean {
	const claims = decodeJwtPayload(token);
	if (!claims || typeof claims.exp !== 'number') return false;
	currentToken = token;
	currentExpiryMs = claims.exp * 1000;
	currentEmail = typeof claims.email === 'string' ? claims.email : null;
	authStore.signedIn = currentExpiryMs > Date.now();
	authStore.email = currentEmail;
	authStore.needsSignIn = false;
	authStore.error = null;
	return true;
}

function loadFromStorage(): void {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored && applyToken(stored) && currentExpiryMs <= Date.now()) {
			// Expired on load — keep email hint but mark signed out.
			authStore.signedIn = false;
		}
	} catch {
		// Ignore.
	}
}

function loadGisScript(): Promise<void> {
	if (scriptPromise) return scriptPromise;
	scriptPromise = new Promise<void>((resolve, reject) => {
		if (window.google?.accounts?.id) {
			resolve();
			return;
		}
		const script = document.createElement('script');
		script.src = GIS_SRC;
		script.async = true;
		script.defer = true;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
		document.head.appendChild(script);
	});
	return scriptPromise;
}

// Resolver for an in-flight silent refresh; set while we wait for GIS to call
// back with (or without) a credential.
let silentResolve: ((token: string | null) => void) | null = null;

function handleCredential(response: GsiCredentialResponse): void {
	if (!response?.credential || !applyToken(response.credential)) {
		authStore.error = 'Sign-in failed';
		if (silentResolve) {
			silentResolve(null);
			silentResolve = null;
		}
		return;
	}
	persist();
	if (silentResolve) {
		silentResolve(currentToken);
		silentResolve = null;
	}
}

/** Initialises GIS. Safe to call once on app startup (browser only). */
export async function initGoogleAuth(clientId: string): Promise<void> {
	if (typeof window === 'undefined') return;
	authStore.enabled = true;
	loadFromStorage();

	try {
		await loadGisScript();
		if (!window.google?.accounts?.id) {
			authStore.error = 'Google Identity Services unavailable';
			return;
		}
		if (!initialized) {
			window.google.accounts.id.initialize({
				client_id: clientId,
				callback: handleCredential,
				auto_select: true,
				use_fedcm_for_prompt: true
			});
			initialized = true;
		}
		authStore.ready = true;

		// If we don't already hold a valid token, try a silent renewal once.
		// No eager prompt() here — that's what trips the cooldown.
		if (!tokenIsFresh()) {
			void ensureFreshToken();
		}
	} catch (err) {
		authStore.error = err instanceof Error ? err.message : 'Google auth init failed';
	}
}

/**
 * Returns a currently-valid ID token, or null. PURE READ — no UI, no network.
 * The sync path calls this; renewal is driven separately by ensureFreshToken().
 */
export function getIdToken(): string | null {
	return tokenIsFresh() ? currentToken : null;
}

/**
 * Attempts to obtain a fresh token without user interaction (GIS auto_select).
 * Returns the token, or null if a visible sign-in is required. De-duplicated and
 * rate-limited so repeated sync ticks don't spam GIS. On failure it sets
 * authStore.needsSignIn so the UI can show the sign-in button.
 */
export function ensureFreshToken(): Promise<string | null> {
	if (tokenIsFresh()) return Promise.resolve(currentToken);
	if (silentRefreshInFlight) return silentRefreshInFlight;

	const now = Date.now();
	if (now - lastSilentAttemptMs < SILENT_RETRY_COOLDOWN_MS) {
		return Promise.resolve(null);
	}
	lastSilentAttemptMs = now;

	if (!initialized || !window.google?.accounts?.id) {
		authStore.needsSignIn = true;
		return Promise.resolve(null);
	}

	silentRefreshInFlight = new Promise<string | null>((resolve) => {
		let settled = false;
		const finish = (token: string | null) => {
			if (settled) return;
			settled = true;
			silentResolve = null;
			if (!token) {
				authStore.signedIn = false;
				authStore.needsSignIn = true;
			}
			resolve(token);
		};

		silentResolve = finish;

		try {
			// With auto_select + an active Google session and prior consent, GIS
			// invokes handleCredential with no visible UI. If it can't (dismissed/
			// cooldown/no session), the notification tells us to fall back to the
			// explicit sign-in button rather than forcing a prompt.
			window.google!.accounts.id.prompt((notification) => {
				const n = notification as {
					isNotDisplayed?: () => boolean;
					isSkippedMoment?: () => boolean;
					isDismissedMoment?: () => boolean;
				};
				const unavailable =
					(n.isNotDisplayed?.() ?? false) ||
					(n.isSkippedMoment?.() ?? false) ||
					(n.isDismissedMoment?.() ?? false);
				if (unavailable) finish(null);
			});
		} catch {
			finish(null);
		}

		// Safety timeout: if GIS never calls back, don't hang forever.
		setTimeout(() => finish(currentToken && tokenIsFresh() ? currentToken : null), 8000);
	}).finally(() => {
		silentRefreshInFlight = null;
	});

	return silentRefreshInFlight;
}

/** Explicit interactive sign-in — only in response to a user gesture. */
export function promptSignIn(): void {
	if (initialized && window.google?.accounts?.id) {
		window.google.accounts.id.prompt();
	}
}

/** Renders the official Google sign-in button into an element. */
export function renderSignInButton(el: HTMLElement): void {
	if (initialized && window.google?.accounts?.id) {
		window.google.accounts.id.renderButton(el, {
			type: 'standard',
			theme: 'outline',
			size: 'large',
			text: 'signin_with',
			shape: 'pill'
		});
	}
}

export function signOut(): void {
	currentToken = null;
	currentExpiryMs = 0;
	currentEmail = null;
	persist();
	authStore.signedIn = false;
	authStore.needsSignIn = true;
	authStore.email = null;
	if (initialized && window.google?.accounts?.id) {
		window.google.accounts.id.disableAutoSelect();
	}
}
