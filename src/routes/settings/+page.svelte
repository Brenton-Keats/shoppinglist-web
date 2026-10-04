<script lang="ts">
	import { onMount } from 'svelte';
	import {
		RefreshCw,
		Monitor,
		Sun,
		Moon,
		LayoutGrid,
		ArrowUpDown,
		Download,
		Info,
		Trash2,
		UserCircle
	} from '@lucide/svelte';
	import { preferencesStore } from '$lib/stores/preferences.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { syncStore } from '$lib/stores/sync.svelte';
	import { syncStateStore } from '$lib/sync/state.svelte';
	import { APP_CONFIG } from '$lib/config';
	import SectionManager from '$lib/components/SectionManager.svelte';
	import StoreManager from '$lib/components/StoreManager.svelte';
	import SignIn from '$lib/components/SignIn.svelte';
	import { authStore } from '$lib/auth/state.svelte';
	import Toggle from '$lib/components/Toggle.svelte';
	import ExportDialog from '$lib/components/ExportDialog.svelte';
	import { getActiveList } from '$lib/db/queries';
	import { getActiveEntities } from '$lib/db/operations';
	import type { List, Section, Store, ListItem, Product } from '$lib/types';

	uiStore.setHeaderTitle('Settings');
	uiStore.setShowBackButton(false);

	let activeList = $state<List | undefined>(undefined);
	let sections = $state<Section[]>([]);
	let stores = $state<Store[]>([]);
	let items = $state<ListItem[]>([]);
	let products = $state<Product[]>([]);
	let showExport = $state(false);
	let confirmClear = $state(false);

	const syncIntervals = [
		{ value: 15, label: '15 seconds' },
		{ value: 30, label: '30 seconds' },
		{ value: 60, label: '1 minute' },
		{ value: 300, label: '5 minutes' }
	];

	const viewModes = [
		{ value: 'SECTION_STORE' as const, label: 'Section → Store', icon: LayoutGrid },
		{ value: 'STORE_SECTION' as const, label: 'Store → Section', icon: ArrowUpDown }
	];

	const themes = [
		{ value: 'light' as const, label: 'Light', icon: Sun },
		{ value: 'dark' as const, label: 'Dark', icon: Moon },
		{ value: 'auto' as const, label: 'Auto', icon: Monitor }
	];

	const lastSyncText = $derived(() => {
		if (!syncStore.lastSync) return 'Never';
		const date = syncStore.lastSync;
		const now = new Date();
		const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
		if (diff < 60) return 'Just now';
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		return `${Math.floor(diff / 86400)}d ago`;
	});

	async function loadData() {
		activeList = await getActiveList();
		sections = await getActiveEntities<Section>('sections');
		stores = await getActiveEntities<Store>('stores');
		items = await getActiveEntities<ListItem>('listItems');
		products = await getActiveEntities<Product>('products');

	}

	onMount(() => {
		loadData();
	});

	// Reload when new remote data arrives
	let lastDataVersion = 0;
	$effect(() => {
		const version = syncStateStore.dataVersion;
		if (version > lastDataVersion) {
			lastDataVersion = version;
			loadData();
		}
	});

	function handleManualSync() {
		syncStore.sync();
	}

	async function clearAllLocalData() {
		// Delete IndexedDB
		const { db } = await import('$lib/db/database');
		await db.delete();

		// Clear localStorage
		localStorage.clear();

		// Unregister service workers
		if ('serviceWorker' in navigator) {
			const registrations = await navigator.serviceWorker.getRegistrations();
			for (const reg of registrations) {
				await reg.unregister();
			}
		}

		// Clear caches
		if ('caches' in window) {
			const cacheNames = await caches.keys();
			for (const name of cacheNames) {
				await caches.delete(name);
			}
		}

		// Reload the page to reinitialise cleanly
		window.location.reload();
	}
</script>

<div class="flex flex-col gap-6 p-4">
	{#if authStore.enabled}
		<section class="flex flex-col gap-3">
			<h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
				<UserCircle size={16} />
				Account
			</h2>
			<div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
				<SignIn />
			</div>
		</section>
	{/if}

	<section class="flex flex-col gap-3">
		<h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
			<RefreshCw size={16} />
			Synchronization
		</h2>
		<div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
			<div class="flex flex-col gap-4">
				<div class="flex items-center justify-between">
					<div>
						<div class="text-sm font-medium text-[var(--color-text)]">Sync Mode</div>
						<div class="text-xs text-[var(--color-text-secondary)]">
							{preferencesStore.syncMode === 'auto' ? 'Sync automatically' : 'Sync manually'}
						</div>
					</div>
					<Toggle
						checked={preferencesStore.syncMode === 'auto'}
						onchange={(v) => preferencesStore.setSyncMode(v ? 'auto' : 'manual')}
						label="Toggle sync mode"
					/>
				</div>

				{#if preferencesStore.syncMode === 'auto'}
					<div class="flex items-center justify-between">
						<div class="text-sm text-[var(--color-text)]">Sync Interval</div>
						<select
							value={preferencesStore.syncInterval}
							onchange={(e) => preferencesStore.setSyncInterval(Number(e.currentTarget.value))}
							class="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
						>
							{#each syncIntervals as interval}
								<option value={interval.value}>{interval.label}</option>
							{/each}
						</select>
					</div>
				{:else}
					<button
						onclick={handleManualSync}
						class="inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-medium text-white active:bg-[var(--color-primary-dark)]"
					>
						<RefreshCw size={16} />
						Sync Now
					</button>
				{/if}

				<div class="flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
					<span>Last sync</span>
					<span>{lastSyncText()}</span>
				</div>
			</div>
		</div>
	</section>

	<section class="flex flex-col gap-3">
		<h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
			<Monitor size={16} />
			Display
		</h2>
		<div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
			<div class="flex flex-col gap-4">
				<div>
					<div class="mb-2 text-sm font-medium text-[var(--color-text)]">View Mode</div>
					<div class="flex gap-2">
						{#each viewModes as mode}
							<button
								onclick={() => preferencesStore.setViewMode(mode.value)}
								class="flex flex-1 flex-col items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors {preferencesStore.viewMode === mode.value ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-secondary)]'}"
							>
								<mode.icon size={18} />
								{mode.label}
							</button>
						{/each}
					</div>
				</div>

				<div>
					<div class="mb-2 text-sm font-medium text-[var(--color-text)]">Theme</div>
					<div class="flex gap-2">
						{#each themes as t}
							<button
								onclick={() => uiStore.setTheme(t.value)}
								class="flex flex-1 flex-col items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors {preferencesStore.theme === t.value ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-accent)]' : 'border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text-secondary)]'}"
							>
								<t.icon size={18} />
								{t.label}
							</button>
						{/each}
					</div>
				</div>
			</div>
		</div>
	</section>

	<section class="flex flex-col gap-3">
		<h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
			<LayoutGrid size={16} />
			Sections
		</h2>
		<div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
			<SectionManager />
		</div>
	</section>

	<section class="flex flex-col gap-3">
		<h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
			<ArrowUpDown size={16} />
			Stores
		</h2>
		<div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
			<StoreManager />
		</div>
	</section>

	<section class="flex flex-col gap-3">
		<h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
			<Download size={16} />
			Export
		</h2>
		<div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
			{#if activeList && items.length > 0}
				<button
					onclick={() => (showExport = true)}
					class="inline-flex items-center gap-2 rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-medium text-white active:bg-[var(--color-primary-dark)]"
				>
					<Download size={16} />
					Export List
				</button>
			{:else}
				<p class="text-sm text-[var(--color-text-secondary)]">
					Add items to your list to export.
				</p>
			{/if}
		</div>
	</section>

	<section class="flex flex-col gap-3">
		<h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
			<Info size={16} />
			About
		</h2>
		<div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
			<div class="flex flex-col gap-2 text-sm">
				<div class="flex items-center justify-between">
					<span class="text-[var(--color-text-secondary)]">App Name</span>
					<span class="font-medium text-[var(--color-text)]">{APP_CONFIG.APP_NAME}</span>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-[var(--color-text-secondary)]">Version</span>
					<span class="font-medium text-[var(--color-text)]">{APP_CONFIG.APP_VERSION}</span>
				</div>
				<div class="flex items-center justify-between">
					<span class="text-[var(--color-text-secondary)]">Build</span>
					<span class="font-medium text-[var(--color-text)]">{new Date().toISOString().split('T')[0]}</span>
				</div>
			</div>
		</div>
	</section>

	<section class="flex flex-col gap-3">
		<h2 class="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
			<Trash2 size={16} />
			Debug
		</h2>
		<div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
			<p class="mb-3 text-sm text-[var(--color-text-secondary)]">
				Clear all local data (IndexedDB, localStorage, service workers). Data on the server is not affected. The app will re-sync on next load.
			</p>
			{#if confirmClear}
				<div class="flex gap-3">
					<button
						onclick={() => { confirmClear = false; }}
						class="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-3 text-sm font-medium text-[var(--color-text)] active:bg-[var(--color-bg)]"
					>Cancel</button>
					<button
						onclick={clearAllLocalData}
						class="flex-1 rounded-xl bg-[var(--color-error)] py-3 text-sm font-medium text-white active:brightness-90"
					>Confirm Clear</button>
				</div>
			{:else}
				<button
					onclick={() => { confirmClear = true; }}
					class="inline-flex items-center gap-2 rounded-lg border border-[var(--color-error)] px-4 py-2.5 text-sm font-medium text-[var(--color-error)] active:bg-[var(--color-error)]/10"
				>
					<Trash2 size={16} />
					Clear Local Data
				</button>
			{/if}
		</div>
	</section>
</div>

{#if showExport && activeList}
	<ExportDialog
		listName={activeList.name}
		viewMode={preferencesStore.viewMode}
		{sections}
		{stores}
		items={items.filter((i) => i.list_id === activeList!.id)}
		{products}
		onClose={() => (showExport = false)}
	/>
{/if}
