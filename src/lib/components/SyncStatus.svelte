<script lang="ts">
	import { Check, CircleAlert, Loader2, WifiOff, LogIn } from '@lucide/svelte';
	import { syncStore } from '$lib/stores/sync.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	function handleClick() {
		if (syncStore.status === 'unauthenticated') {
			// Sign-in requires a user gesture; send them to Settings → Account.
			goto(resolve('/settings'));
			return;
		}
		if (syncStore.status === 'pending' || syncStore.status === 'error') {
			syncStore.sync();
		}
	}
</script>

<button
	onclick={handleClick}
	class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors active:bg-[var(--color-surface)]"
	aria-label="Sync status: {syncStore.status}"
>
	{#if syncStore.status === 'synced'}
		<Check size={14} class="text-[var(--color-success)]" />
		<span class="text-[var(--color-text-secondary)]">Synced</span>
	{:else if syncStore.status === 'pending'}
		<span class="relative flex h-2.5 w-2.5">
			<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-warning)] opacity-75"></span>
			<span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-warning)]"></span>
		</span>
		<span class="text-[var(--color-warning)]">{syncStore.pendingCount} pending</span>
	{:else if syncStore.status === 'syncing'}
		<Loader2 size={14} class="animate-spin text-[var(--color-accent)]" />
		<span class="text-[var(--color-accent)]">Syncing...</span>
	{:else if syncStore.status === 'offline'}
		<WifiOff size={14} class="text-[var(--color-warning)]" />
		<span class="text-[var(--color-warning)]">Offline</span>
	{:else if syncStore.status === 'unauthenticated'}
		<LogIn size={14} class="text-[var(--color-text-secondary)]" />
		<span class="text-[var(--color-text-secondary)]">Sign in</span>
	{:else if syncStore.status === 'error'}
		<CircleAlert size={14} class="text-[var(--color-error)]" />
		<span class="text-[var(--color-error)]">Error</span>
	{/if}
</button>
