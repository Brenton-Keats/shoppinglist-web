/**
 * Unified auth accessor used by the sync API client.
 *
 * Dual-mode, mirroring the Lambda:
 *   - Google mode  (PUBLIC_GOOGLE_CLIENT_ID set): send an Authorization Bearer
 *     ID token; requires the user to be signed in.
 *   - API-key mode (default): send the shared key as a ?key= query param
 *     (and body apiKey on POST), matching the original behaviour.
 */
import { ENV } from '$lib/config/env';
import { authStore } from './state.svelte';
import { getIdToken, ensureFreshToken, initGoogleAuth } from './google';

/** Sentinel message used to flag "not signed in" distinctly from real errors. */
export const UNAUTHENTICATED = 'unauthenticated';

export type AuthMode = 'google' | 'apikey';

export function authMode(): AuthMode {
	return ENV.PUBLIC_GOOGLE_CLIENT_ID ? 'google' : 'apikey';
}

/** Initialise auth on app startup (browser only). */
export async function initAuth(): Promise<void> {
	if (authMode() === 'google') {
		await initGoogleAuth(ENV.PUBLIC_GOOGLE_CLIENT_ID);
	} else {
		authStore.enabled = false;
		authStore.ready = true;
	}
}

export interface RequestAuth {
	/** Extra headers to merge into the fetch (e.g. Authorization). */
	headers: Record<string, string>;
	/** Query key for API-key mode, if any. */
	queryKey?: string;
	/** Body apiKey for API-key mode POSTs, if any. */
	bodyApiKey?: string;
}

/**
 * Resolves auth material for a request. In Google mode, if no valid token is
 * held it kicks off a background silent renewal and throws the UNAUTHENTICATED
 * sentinel so the caller can represent this as "not signed in" (not an error).
 * The renewal result lands on a later sync tick.
 */
export function resolveRequestAuth(): RequestAuth {
	if (authMode() === 'google') {
		const token = getIdToken();
		if (!token) {
			// Fire-and-forget: try to get a token silently for the next tick.
			void ensureFreshToken();
			throw new Error(UNAUTHENTICATED);
		}
		return { headers: { Authorization: `Bearer ${token}` } };
	}

	const key = ENV.PUBLIC_API_KEY;
	return { headers: {}, queryKey: key || undefined, bodyApiKey: key || undefined };
}

export { authStore };
