import { env } from '$env/dynamic/public';
import { APP_CONFIG } from '../config';

function getEnv(key: string): string | undefined {
	return env[key as keyof typeof env];
}

export const ENV = {
	/**
	 * Base URL of the sync API (the Lambda Function URL). Replaces the former
	 * PUBLIC_APPS_SCRIPT_URL.
	 */
	get PUBLIC_API_BASE_URL(): string {
		const value = getEnv('PUBLIC_API_BASE_URL');
		if (!value) {
			throw new Error(
				'Missing required environment variable: PUBLIC_API_BASE_URL. ' +
				'Set it in your .env file (local) or as a GitHub Actions variable (CI).'
			);
		}
		return value;
	},

	/** Shared API key (used when Google auth is not configured). */
	get PUBLIC_API_KEY(): string {
		return getEnv('PUBLIC_API_KEY') || '';
	},

	/**
	 * Google OAuth Web client ID. When set, the app authenticates with Google
	 * ID tokens instead of the shared API key.
	 */
	get PUBLIC_GOOGLE_CLIENT_ID(): string {
		return getEnv('PUBLIC_GOOGLE_CLIENT_ID') || '';
	},

	get PUBLIC_APP_NAME(): string {
		return getEnv('PUBLIC_APP_NAME') || APP_CONFIG.APP_NAME;
	},

	get PUBLIC_APP_VERSION(): string {
		return getEnv('PUBLIC_APP_VERSION') || APP_CONFIG.APP_VERSION;
	}
};
