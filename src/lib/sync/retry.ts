import { performSync } from './engine';
import { syncStateStore } from './state.svelte';

const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 60000;

function isClientError(status: number | undefined): boolean {
	return status !== undefined && status >= 400 && status < 500;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncWithRetry(
	maxRetries: number = DEFAULT_MAX_RETRIES,
	baseDelayMs: number = DEFAULT_BASE_DELAY_MS
): Promise<boolean> {
	let attempt = 0;

	while (attempt <= maxRetries) {
		if (!navigator.onLine) {
			syncStateStore.setOffline();
			return false;
		}

		try {
			const result = await performSync();
			if (result) {
				return true;
			}
			// performSync sets state itself and returns false on failure. If it's
			// an auth condition (not signed in), that's terminal for this run —
			// don't retry or overwrite the unauthenticated state with an error.
			if (syncStateStore.state.status === 'unauthenticated') {
				return false;
			}
		} catch (error) {
			const isApiError =
				error instanceof Error &&
				'status' in error &&
				typeof (error as { status?: number }).status === 'number';

			if (isApiError) {
				const status = (error as { status: number }).status;
				if (isClientError(status)) {
					syncStateStore.setError(`Client error ${status}: ${error.message}`);
					return false;
				}
			}

			console.error(`Sync attempt ${attempt + 1} failed:`, error);
		}

		attempt++;

		if (attempt > maxRetries) {
			break;
		}

		const backoffDelay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), MAX_DELAY_MS);

		await delay(backoffDelay);
		if (!navigator.onLine) {
			syncStateStore.setOffline();
			return false;
		}
	}

	syncStateStore.setError(`Sync failed after ${maxRetries + 1} attempts`);
	return false;
}
