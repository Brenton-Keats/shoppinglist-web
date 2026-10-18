<script lang="ts">
	import { fly } from 'svelte/transition';
	import { X } from '@lucide/svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
</script>

{#if toastStore.toasts.length > 0}
	<div
		class="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2 px-4"
		aria-live="polite"
	>
		{#each toastStore.toasts as toast (toast.id)}
			<div
				transition:fly={{ y: 20, duration: 200 }}
				role="status"
				class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ring-1
					{toast.type === 'error'
						? 'bg-[var(--color-error)] text-white ring-black/10'
						: toast.type === 'success'
							? 'bg-[var(--color-success)] text-white ring-black/10'
							: 'bg-[var(--color-surface)] text-[var(--color-text)] ring-[var(--color-border)]'}"
			>
				<span class="flex-1">{toast.message}</span>
				<button
					onclick={() => toastStore.dismiss(toast.id)}
					class="shrink-0 rounded-full p-0.5 opacity-80 active:opacity-100"
					aria-label="Dismiss"
				>
					<X size={16} />
				</button>
			</div>
		{/each}
	</div>
{/if}
