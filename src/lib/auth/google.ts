/**
 * Google Identity Services (GIS) integration — browser only.
 *
 * Obtains a Google ID token (JWT) that the Lambda verifies. Tokens are short
 * lived (~1h); this module persists the current token to localStorage so it
 * survives reloads until expiry, and attempts a silent refresh (One Tap /
 * FedCM) when it is missing or stale.
 *
 * The app is offline-first, so a stale token only matters at the moment sync
 * runs while online — `getIdToken()` returns null in that case and the caller
 * treats it as "sign in required" and retries on the next sync tick.
 */
import { authStore } from './state.svelte';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const STORAGE_KEY = 'sl_google_id_token';
const EXPIRY_SKEW_MS = 30_000;

let currentToken: string | null = null;
let currentExpiryMs = 0;
let currentEmail: string | null = null;
let scriptPromise: Promise<void> | null = null;
let initialized = false;

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

function applyToken(token: string): boolean {
	const claims = decodeJwtPayload(token);
	if (!claims || typeof claims.exp !== 'number') return false;
	currentToken = token;
	currentExpiryMs = claims.exp * 1000;
	currentEmail = typeof claims.email === 'string' ? claims.email : null;
	authStore.signedIn = currentExpiryMs > Date.now();
	authStore.email = currentEmail;
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

function handleCredential(response: GsiCredentialResponse): void {
	if (!response?.credential || !applyToken(response.credential)) {
		authStore.error = 'Sign-in failed';
		return;
	}
	persist();
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

		// Attempt a silent sign-in if we don't already hold a valid token.
		if (!authStore.signedIn) {
			window.google.accounts.id.prompt();
		}
	} catch (err) {
		authStore.error = err instanceof Error ? err.message : 'Google auth init failed';
	}
}

/** Returns a currently-valid ID token, or null (triggering a refresh attempt). */
export function getIdToken(): string | null {
	if (currentToken && currentExpiryMs - EXPIRY_SKEW_MS > Date.now()) {
		return currentToken;
	}
	// Stale/missing — nudge GIS for a fresh token; caller retries next tick.
	if (initialized && window.google?.accounts?.id) {
		try {
			window.google.accounts.id.prompt();
		} catch {
			// Ignore.
		}
	}
	if (authStore.signedIn) authStore.signedIn = false;
	return null;
}

/** Explicit interactive sign-in (One Tap / FedCM prompt). */
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
	authStore.email = null;
	if (initialized && window.google?.accounts?.id) {
		window.google.accounts.id.disableAutoSelect();
	}
}
