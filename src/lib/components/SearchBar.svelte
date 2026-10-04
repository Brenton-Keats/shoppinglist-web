<script lang="ts">
	import { Search, X, Plus } from '@lucide/svelte';
	import type { Product } from '$lib/types';
	import { getProductsForSearch } from '$lib/db/queries';

	interface Props {
		onSelect: (product: Product) => void;
		onAddNew: (query: string) => void;
	}

	let { onSelect, onAddNew }: Props = $props();

	let query = $state('');
	let results = $state<Product[]>([]);
	let isOpen = $state(false);
	let isLoading = $state(false);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let containerEl: HTMLDivElement | undefined = $state();

	function handleInput() {
		if (debounceTimer) clearTimeout(debounceTimer);

		if (!query.trim()) {
			results = [];
			isOpen = false;
			isLoading = false;
			return;
		}

		isLoading = true;
		debounceTimer = setTimeout(async () => {
			results = await getProductsForSearch(query);
			isOpen = true;
			isLoading = false;
		}, 200);
	}

	function handleSelect(product: Product) {
		query = '';
		results = [];
		isOpen = false;
		onSelect(product);
	}

	function handleAddNew() {
		const q = query.trim();
		query = '';
		results = [];
		isOpen = false;
		onAddNew(q);
	}

	function handleClear() {
		query = '';
		results = [];
		isOpen = false;
		if (debounceTimer) clearTimeout(debounceTimer);
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			isOpen = false;
		}
	}

	const hasExactMatch = $derived(
		results.some((p) => p.name.toLowerCase() === query.toLowerCase().trim())
	);
</script>

<div class="relative" bind:this={containerEl}>
	<div class="flex items-center gap-2 rounded-2xl bg-[var(--color-surface)] px-4 py-3 shadow-sm ring-1 ring-[var(--color-border)]">
		<Search size={18} class="shrink-0 text-[var(--color-text-secondary)]" />
		<input
			type="text"
			placeholder="Add or search items..."
			bind:value={query}
			oninput={handleInput}
			onkeydown={handleKeyDown}
			onfocus={() => { if (query.trim() && results.length > 0) isOpen = true; }}
			class="flex-1 bg-transparent text-base text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-secondary)]/60"
			aria-label="Search products"
			aria-controls="search-results"
			aria-autocomplete="list"
		/>
		{#if query}
			<button
				onclick={handleClear}
				class="flex shrink-0 items-center justify-center rounded-full p-1 text-[var(--color-text-secondary)] active:bg-[var(--color-border)]"
				aria-label="Clear search"
			>
				<X size={16} />
			</button>
		{/if}
		{#if isLoading}
			<div class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--color-text-secondary)]/30 border-t-[var(--color-accent)]"></div>
		{/if}
	</div>

	{#if isOpen && (results.length > 0 || (!hasExactMatch && query.trim()))}
		<div
			id="search-results"
			role="listbox"
			class="absolute left-0 right-0 top-full z-40 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
		>
			{#if results.length > 0}
				<div class="py-1">
					{#each results as product (product.id)}
						<button
							role="option"
							aria-selected="false"
							onclick={() => handleSelect(product)}
							class="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-[var(--color-bg)]"
						>
							<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/10">
								<Plus size={14} class="text-[var(--color-accent)]" />
							</div>
							<div class="flex-1 min-w-0">
								<div class="truncate text-sm font-medium text-[var(--color-text)]">
									{product.name}
								</div>
							</div>
						</button>
					{/each}
				</div>
			{/if}

			{#if !hasExactMatch && query.trim()}
				<button
					onclick={handleAddNew}
					class="flex w-full items-center gap-3 border-t border-[var(--color-border)] px-4 py-3 text-left transition-colors active:bg-[var(--color-bg)]"
				>
					<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)]/15">
						<Plus size={14} class="text-[var(--color-accent)]" />
					</div>
					<span class="text-sm font-medium text-[var(--color-accent)]">
						Create "{query.trim()}"
					</span>
				</button>
			{/if}
		</div>
	{/if}
</div>

<svelte:window
	onclick={(e) => {
		const target = e.target as HTMLElement;
		if (containerEl && !containerEl.contains(target)) {
			isOpen = false;
		}
	}}
/>
