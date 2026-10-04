<script lang="ts">
	import { ChevronDown, ChevronUp, Plus, Check } from '@lucide/svelte';
	import Button from './Button.svelte';
	import EmptyState from './EmptyState.svelte';
	import LoadingSpinner from './LoadingSpinner.svelte';
	import type { Suggestion } from '$lib/suggestions/engine';

	interface Props {
		suggestions: Suggestion[];
		loading: boolean;
		collapsed: boolean;
		onToggleCollapse: () => void;
		onAdd: (productId: string) => void;
		onAddAll: (productIds: string[]) => void;
		getStoreName: (storeId: string | null) => string | null;
	}

	let {
		suggestions,
		loading,
		collapsed,
		onToggleCollapse,
		onAdd,
		onAddAll,
		getStoreName
	}: Props = $props();

	const strongSuggestions = $derived(suggestions.filter((s) => s.strength === 'strong'));
	const normalSuggestions = $derived(suggestions.filter((s) => s.strength === 'normal'));
	const hasSuggestions = $derived(suggestions.length > 0);

	function handleAddAll() {
		const ids = suggestions.map((s) => s.product.id);
		onAddAll(ids);
	}
</script>

<div class="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
	<button
		onclick={onToggleCollapse}
		class="flex w-full items-center justify-between px-4 py-3 text-left transition-colors active:bg-[var(--color-border)]"
		aria-expanded={!collapsed}
	>
		<div class="flex items-center gap-2">
			<h3 class="text-sm font-semibold text-[var(--color-text)]">Suggestions</h3>
			{#if !collapsed && hasSuggestions}
				<span class="rounded-full bg-[var(--color-primary)] px-2 py-0.5 text-xs font-medium text-white">
					{suggestions.length}
				</span>
			{/if}
		</div>
		{#if collapsed}
			<ChevronDown size={18} class="text-[var(--color-text-secondary)]" />
		{:else}
			<ChevronUp size={18} class="text-[var(--color-text-secondary)]" />
		{/if}
	</button>

	{#if !collapsed}
		<div class="border-t border-[var(--color-border)]">
			{#if loading}
				<div class="flex items-center justify-center py-8">
					<LoadingSpinner size="sm" />
				</div>
			{:else if !hasSuggestions}
				<div class="py-4">
					<EmptyState
						icon={Check}
						title="No suggestions"
						description="Add more items to your lists to get suggestions based on your shopping history."
					/>
				</div>
			{:else}
				<div class="p-2">
					{#if strongSuggestions.length > 0}
						<div class="mb-2 px-2 py-1">
							<span class="text-xs font-medium text-[var(--color-accent)]">
								Strongly suggested
							</span>
						</div>
						{#each strongSuggestions as suggestion (suggestion.product.id)}
							<button
								onclick={() => onAdd(suggestion.product.id)}
								class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors active:bg-[var(--color-border)]"
							>
								<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/10">
									<Plus size={16} class="text-[var(--color-accent)]" />
								</div>
								<div class="flex-1 min-w-0">
									<div class="truncate text-sm font-medium text-[var(--color-text)]">
										{suggestion.product.name}
									</div>
									{#if suggestion.product.default_store_id}
										<div class="text-xs text-[var(--color-text-secondary)]">
											{getStoreName(suggestion.product.default_store_id)}
										</div>
									{/if}
								</div>
							</button>
						{/each}
					{/if}

					{#if normalSuggestions.length > 0}
						<div class="mb-2 mt-2 px-2 py-1">
							<span class="text-xs font-medium text-[var(--color-text-secondary)]">
								Suggested
							</span>
						</div>
						{#each normalSuggestions as suggestion (suggestion.product.id)}
							<button
								onclick={() => onAdd(suggestion.product.id)}
								class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors active:bg-[var(--color-border)]"
							>
								<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-border)]">
									<Plus size={16} class="text-[var(--color-text-secondary)]" />
								</div>
								<div class="flex-1 min-w-0">
									<div class="truncate text-sm font-medium text-[var(--color-text)]">
										{suggestion.product.name}
									</div>
									{#if suggestion.product.default_store_id}
										<div class="text-xs text-[var(--color-text-secondary)]">
											{getStoreName(suggestion.product.default_store_id)}
										</div>
									{/if}
								</div>
							</button>
						{/each}
					{/if}

					<div class="mt-2 px-2">
						<Button variant="secondary" size="sm" fullWidth onclick={handleAddAll}>
							Add all suggestions
						</Button>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
