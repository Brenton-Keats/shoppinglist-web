<script lang="ts">
	/**
	 * Google sign-in control. Renders nothing in API-key mode. When Google auth
	 * is enabled, shows the official Google button while signed out, or the
	 * signed-in email with a sign-out action.
	 */
	import { LogOut } from '@lucide/svelte';
	import { authStore } from '$lib/auth/state.svelte';
	import { renderSignInButton, signOut } from '$lib/auth/google';

	let buttonEl = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (authStore.ready && !authStore.signedIn && buttonEl) {
			buttonEl.innerHTML = '';
			renderSignInButton(buttonEl);
		}
	});
</script>

{#if authStore.enabled}
	{#if authStore.signedIn}
		<div class="flex items-center justify-between">
			<div>
				<div class="text-sm font-medium text-[var(--color-text)]">Signed in</div>
				<div class="text-xs text-[var(--color-text-secondary)]">{authStore.email ?? ''}</div>
			</div>
			<button
				onclick={signOut}
				class="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium text-[var(--color-text)] active:bg-[var(--color-bg)]"
			>
				<LogOut size={16} />
				Sign out
			</button>
		</div>
	{:else}
		<div class="flex flex-col gap-2">
			<p class="text-sm text-[var(--color-text-secondary)]">
				Sign in with your Google account to sync your lists.
			</p>
			<div bind:this={buttonEl}></div>
			{#if authStore.error}
				<p class="text-xs text-[var(--color-error)]">{authStore.error}</p>
			{/if}
		</div>
	{/if}
{/if}
