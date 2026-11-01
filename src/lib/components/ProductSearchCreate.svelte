<script lang="ts" generics="T extends { id: string; name: string }">
	import { Search, X, Plus } from '@lucide/svelte';

	/**
	 * Shared "search existing items, or create a new one" control (Items 4 + 7).
	 *
	 * Owns the UX the list page pioneered and now reused verbatim on the meals
	 * page: a search input with a clear (X) button, a dashed "Create" ZONE shown
	 * when the query matches nothing, and CLEAR-ON-SELECT. It is parameterised by
	 * the item type and the data/callbacks the caller passes — it holds no
	 * knowledge of products vs meals, so both pages share the same code.
	 *
	 * Behaviour it owns (so every consumer inherits it identically):
	 *  - filtering is the CALLER's job (pass already-filtered `items`), but the
	 *    "no exact match → show create zone" decision is derived HERE from
	 *    `query` + `items` unless the caller overrides via `isNew`.
	 *  - selecting a result calls `onSelect(item)` and then CLEARS the query
	 *    (Item 4) when `clearOnSelect` is true (the default).
	 *  - the create zone calls `onCreate(trimmedQuery)` and clears the query.
	 *
	 * The result rows and (optionally) the create-zone label are provided by the
	 * caller as snippets so each page keeps its own row styling, while the input,
	 * clear button, create zone, and clear-on-select live in ONE place.
	 */
	interface Props {
		/** Bindable search text. */
		query: string;
		/** Already-filtered candidate items to render as selectable rows. */
		items: T[];
		/** Called when the user selects an existing item. */
		onSelect: (item: T) => void;
		/** Called when the user taps the create zone, with the trimmed query. */
		onCreate: (name: string) => void;
		/**
		 * Whether the current query represents a NEW item (no exact match). When
		 * omitted it is derived from `query` + `items` (case-insensitive exact
		 * name match). Pass it when the caller's match set differs from `items`.
		 */
		isNew?: boolean;
		placeholder?: string;
		/** Label for the create zone, e.g. 'New' or 'Create'. */
		createLabel?: string;
		/** Clear the query after a successful select (Item 4). Default true. */
		clearOnSelect?: boolean;
		/** data-testid for the search input. */
		searchTestId?: string;
		/** data-testid for the create zone button. */
		createTestId?: string;
		/** Optional snippet to render each item row's trailing content. */
		itemRow?: import('svelte').Snippet<[T]>;
		/** Optional data-testid applied to each item row button. */
		itemTestId?: string;
		/** Empty-state text shown when there are no items and nothing to create. */
		emptyText?: string;
	}

	let {
		query = $bindable(),
		items,
		onSelect,
		onCreate,
		isNew,
		placeholder = 'Search or add...',
		createLabel = 'New',
		clearOnSelect = true,
		searchTestId,
		createTestId,
		itemRow,
		itemTestId,
		emptyText
	}: Props = $props();

	const trimmed = $derived(query.trim());

	// Derive "is this a new item?" when the caller doesn't pass isNew: true when
	// there is a query and no candidate has an exact (case-insensitive) name.
	const computedIsNew = $derived.by(() => {
		if (!trimmed) return false;
		return !items.some((i) => i.name.toLowerCase() === trimmed.toLowerCase());
	});
	const showCreate = $derived((isNew ?? computedIsNew) && trimmed.length > 0);

	function handleSelect(item: T) {
		onSelect(item);
		if (clearOnSelect) query = '';
	}

	function handleCreate() {
		if (!trimmed) return;
		onCreate(trimmed);
		query = '';
	}

	function clear() {
		query = '';
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && showCreate) {
			e.preventDefault();
			handleCreate();
		}
	}
</script>

<div class="flex flex-col gap-2">
	<!-- Search input with clear button. -->
	<div
		class="flex items-center gap-2 rounded-2xl bg-[var(--color-surface)] px-4 py-3 shadow-sm ring-1 ring-[var(--color-border)]"
	>
		<Search size={18} class="shrink-0 text-[var(--color-text-secondary)]" />
		<input
			type="text"
			{placeholder}
			bind:value={query}
			data-testid={searchTestId}
			onkeydown={handleKeydown}
			class="flex-1 bg-transparent text-base text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-secondary)]/60"
		/>
		{#if query}
			<button
				onclick={clear}
				class="flex shrink-0 items-center justify-center rounded-full p-1 text-[var(--color-text-secondary)] active:bg-[var(--color-border)]"
				aria-label="Clear search"
			>
				<X size={16} />
			</button>
		{/if}
	</div>

	<!-- Create ZONE: shown only when the query matches nothing. Replaces the old
	     per-page "Add" button with a dedicated dashed affordance. -->
	{#if showCreate}
		<button
			onclick={handleCreate}
			data-testid={createTestId}
			class="flex w-full items-center gap-3 rounded-xl border border-dashed border-[var(--color-primary)] bg-[var(--color-primary)]/5 px-4 py-3 text-left active:bg-[var(--color-primary)]/10"
		>
			<div
				class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary)] text-white"
				style="min-height: auto; min-width: auto;"
			>
				<Plus size={14} />
			</div>
			<div class="flex-1">
				<span class="text-sm font-medium text-[var(--color-text)]">{trimmed}</span>
				<span
					class="ml-2 rounded bg-[var(--color-primary)]/10 px-1.5 py-0.5 text-xs font-medium text-[var(--color-accent)]"
				>
					{createLabel}
				</span>
			</div>
		</button>
	{/if}

	<!-- Result rows (selecting one clears the input via handleSelect). -->
	{#if items.length === 0 && !showCreate && emptyText}
		<p class="py-6 text-center text-sm text-[var(--color-text-secondary)]">{emptyText}</p>
	{:else}
		{#each items as item (item.id)}
			<button
				onclick={() => handleSelect(item)}
				data-testid={itemTestId}
				data-product-name={item.name}
				data-meal-name={item.name}
				class="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left active:bg-[var(--color-surface)]"
			>
				<div
					class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary)] text-white"
					style="min-height: auto; min-width: auto;"
				>
					<Plus size={14} />
				</div>
				<span class="flex-1 truncate text-sm text-[var(--color-text)]">{item.name}</span>
				{#if itemRow}{@render itemRow(item)}{/if}
			</button>
		{/each}
	{/if}
</div>
