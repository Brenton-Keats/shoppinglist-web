<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { X, ShoppingCart, ChevronDown, ChevronUp } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { listStore } from '$lib/stores/list.svelte';
	import { compareSortKeys } from '$lib/utils/ordering';
	import { preferencesStore } from '$lib/stores/preferences.svelte';
	import { projectItems } from '$lib/view-modes/projection';
	import type { PrimaryGroup } from '$lib/view-modes/types';
	import ShoppingItem from '$lib/components/ShoppingItem.svelte';
	import ProgressBar from '$lib/components/ProgressBar.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';

	onMount(() => {
		listStore.loadActiveList();
	});

	const productsArray = $derived(Array.from(listStore.products.values()));
	const sectionsArray = $derived(Array.from(listStore.sections.values()));
	const storesArray = $derived(Array.from(listStore.stores.values()));

	let groups = $state<PrimaryGroup[]>([]);
	let expandedCompleted = $state<Set<string>>(new Set());

	const totalItems = $derived(listStore.items.filter(i => !i.deleted_at).length);
	const completedItems = $derived(listStore.items.filter(i => !i.deleted_at && i.completed).length);

	$effect(() => {
		const items = listStore.items;
		const viewMode = preferencesStore.viewMode;
		if (items.length === 0) {
			groups = [];
			return;
		}
		projectItems(viewMode, items, productsArray, sectionsArray, storesArray).then((projected) => {
			groups = projected;
		});
	});

	function handleToggleItem(itemId: string) {
		listStore.toggleItem(itemId);
	}

	function handleExit() {
		goto(resolve('/'));
	}

	function toggleCompleted(groupId: string) {
		const next = new Set(expandedCompleted);
		if (next.has(groupId)) {
			next.delete(groupId);
		} else {
			next.add(groupId);
		}
		expandedCompleted = next;
	}

	function getSectionName(sectionId: string | null): string | null {
		if (!sectionId) return null;
		return listStore.getSectionName(sectionId);
	}

	function getStoreName(storeId: string | null): string | null {
		if (!storeId) return null;
		return listStore.getStoreName(storeId);
	}
</script>

<div class="flex h-[100dvh] flex-col bg-[var(--color-bg)]">
	<!-- Header -->
	<div class="bg-[var(--color-bg)]">
		<div class="flex items-center justify-between px-4 pt-2 pb-1">
			<button
				onclick={handleExit}
				class="flex items-center justify-center rounded-full p-2 text-[var(--color-text)] active:bg-[var(--color-surface)]"
				aria-label="Exit shopping mode"
			>
				<X size={24} />
			</button>
			<span class="text-sm font-semibold text-[var(--color-text)]">
				{completedItems}/{totalItems} done
			</span>
			<div class="w-10"></div>
		</div>
		<ProgressBar completed={completedItems} total={totalItems} />
	</div>

	<!-- Content -->
	<div class="flex-1 overflow-y-auto px-4 pb-24">
		{#if listStore.loading}
			<div class="flex items-center justify-center py-16">
				<div class="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]"></div>
			</div>
		{:else if totalItems === 0}
			<EmptyState
				icon={ShoppingCart}
				title="Ready to shop?"
				description="Your shopping list is empty. Add items from the List tab first."
			/>
		{:else}
			{#each groups as group (group.id)}
				{@const allItems = group.secondaryGroups.flatMap(sg => sg.items)}
				{@const incomplete = allItems.filter(gi => !gi.item.completed).sort((a, b) => compareSortKeys(a.item.sort_order, b.item.sort_order))}
				{@const completed = allItems.filter(gi => gi.item.completed).sort((a, b) => compareSortKeys(a.item.sort_order, b.item.sort_order))}
				{@const isExpanded = expandedCompleted.has(group.id)}

				<div class="mt-4 first:mt-2">
					<!-- Section header -->
					<h2 class="sticky top-0 z-10 bg-[var(--color-bg)] py-2 text-xs font-semibold uppercase tracking-wide {incomplete.length === 0 ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-accent)]'}">
						{group.name}
						{#if incomplete.length > 0}
							<span class="ml-1 font-normal">({incomplete.length})</span>
						{/if}
					</h2>

					<!-- Incomplete items -->
					{#each incomplete as gi (gi.item.id)}
						<div class="mb-2">
							<ShoppingItem
								item={gi.item}
								sectionName={getSectionName(gi.item.section_id)}
								storeName={getStoreName(gi.item.store_id)}
								onComplete={() => handleToggleItem(gi.item.id)}
							/>
						</div>
					{/each}

					<!-- Completed items (collapsible) -->
					{#if completed.length > 0}
						<button
							onclick={() => toggleCompleted(group.id)}
							class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] active:bg-[var(--color-surface)]"
							style="min-height: 36px; min-width: auto;"
						>
							{#if isExpanded}
								<ChevronUp size={14} />
							{:else}
								<ChevronDown size={14} />
							{/if}
							{completed.length} completed
						</button>

						{#if isExpanded}
							<div class="mt-1">
								{#each completed as gi (gi.item.id)}
									<div class="mb-2">
										<ShoppingItem
											item={gi.item}
											sectionName={getSectionName(gi.item.section_id)}
											storeName={getStoreName(gi.item.store_id)}
											onComplete={() => handleToggleItem(gi.item.id)}
										/>
									</div>
								{/each}
							</div>
						{/if}
					{/if}
				</div>
			{/each}
		{/if}
	</div>

	<!-- Exit button -->
	{#if totalItems > 0}
		<div class="border-t border-[var(--color-border)] bg-[var(--color-bg)] p-4">
			<button
				onclick={handleExit}
				class="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-3 text-sm font-semibold text-[var(--color-text)] active:bg-[var(--color-border)]"
			>
				<X size={18} />
				<span>Exit Shopping</span>
			</button>
		</div>
	{/if}
</div>
