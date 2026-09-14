<script lang="ts">
	/**
	 * SyncController — client-only component that manages sync lifecycle.
	 *
	 * This component is rendered in the root layout and handles:
	 * - Starting sync on app load
	 * - Setting up connectivity listeners
	 * - Starting/stopping auto-sync based on preferences
	 * - Refreshing stores after sync completes
	 *
	 * By placing sync initialization here instead of in store constructors,
	 * we avoid all SSR-related issues (IndexedDB, navigator, window access).
	 */
	import { onMount, onDestroy } from 'svelte';
	import { syncStore } from '$lib/stores/sync.svelte';
	import { listStore } from '$lib/stores/list.svelte';
	import { preferencesStore } from '$lib/stores/preferences.svelte';
	import { checkSyncNeededOnStartup } from '$lib/sync/scheduler';
	import { syncStateStore } from '$lib/sync/state.svelte';
	import { initAuth } from '$lib/auth';

	let cleanupConnectivity: (() => void) | null = null;

	onMount(async () => {
		// Initialise auth (Google Identity Services in Google mode; no-op for
		// API-key mode) before any sync attempts.
		await initAuth();

		// Wait for preferences to load (they determine sync mode/interval)
		await waitForPreferences();

		// Set up connectivity listeners
		const onOnline = () => {
			doSync();
		};
		window.addEventListener('online', onOnline);
		cleanupConnectivity = () => window.removeEventListener('online', onOnline);

		// Start sync based on preferences
		if (preferencesStore.syncMode === 'auto') {
			syncStore.startAutoSync(preferencesStore.syncInterval);
		}

		// Initial sync — uses checkSyncNeededOnStartup which handles fresh clients
		await checkSyncNeededOnStartup();
		await listStore.loadActiveList();
	});

	onDestroy(() => {
		cleanupConnectivity?.();
		syncStore.stopAutoSync();
	});

	// React to sync mode changes
	$effect(() => {
		const mode = preferencesStore.syncMode;
		const interval = preferencesStore.syncInterval;

		if (mode === 'auto') {
			syncStore.startAutoSync(interval);
		} else {
			syncStore.stopAutoSync();
		}
	});

	// Reload stores whenever new remote data arrives
	let lastDataVersion = 0;
	$effect(() => {
		const version = syncStateStore.dataVersion;
		if (version > lastDataVersion) {
			lastDataVersion = version;
			listStore.loadActiveList();
		}
	});

	async function doSync() {
		await syncStore.triggerSync();
		// Reload is handled by the dataVersion effect above
	}

	function waitForPreferences(): Promise<void> {
		return new Promise((resolve) => {
			if (preferencesStore.loaded) {
				resolve();
				return;
			}
			const check = setInterval(() => {
				if (preferencesStore.loaded) {
					clearInterval(check);
					resolve();
				}
			}, 50);
			setTimeout(() => { clearInterval(check); resolve(); }, 2000);
		});
	}
</script>
