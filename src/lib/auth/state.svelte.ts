/**
 * Reactive authentication state.
 *
 * Only meaningful when Google auth is enabled (PUBLIC_GOOGLE_CLIENT_ID set).
 * In API-key mode the app is always considered "ready" and requests use the
 * shared key instead.
 */
class AuthStore {
	/** True when Google auth is configured for this build. */
	enabled = $state(false);
	/** True once Google Identity Services has loaded and initialised. */
	ready = $state(false);
	/** True when a valid ID token is held. */
	signedIn = $state(false);
	/** True when silent renewal failed and an explicit (gesture) sign-in is needed. */
	needsSignIn = $state(false);
	/** Signed-in account email, if known. */
	email = $state<string | null>(null);
	/** Last auth error message, if any. */
	error = $state<string | null>(null);
}

export const authStore = new AuthStore();
