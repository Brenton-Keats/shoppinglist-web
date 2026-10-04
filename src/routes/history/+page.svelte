<script lang="ts">
	import { onMount } from 'svelte';
	import { Clock, X, ChevronRight, Calendar, Package } from '@lucide/svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { preferencesStore } from '$lib/stores/preferences.svelte';
	import { getHistoricalLists } from '$lib/db/queries';
	import { getActiveEntities } from '$lib/db/operations';
	import { groupItemsByViewMode } from '$lib/view-modes/group';
	import type { List, ListItem, Section, Store } from '$lib/types';
	import EmptyState from '$lib/components/EmptyState.svelte';

	uiStore.setHeaderTitle('History');
	uiStore.setShowBackButton(false);

	let lists = $state<List[]>([]);
	let items = $state<ListItem[]>([]);
	let sections = $state<Section[]>([]);
	let stores = $state<Store[]>([]);
	let loading = $state(true);
	let selectedList = $state<List | null>(null);

	async function load() {
		lists = await getHistoricalLists();
		items = await getActiveEntities<ListItem>('listItems');
		sections = await getActiveEntities<Section>('sections');
		stores = await getActiveEntities<Store>('stores');
		loading = false;
	}

	onMount(() => {
		load();
	});

	function getItemCount(listId: string): number {
		return items.filter((i) => i.list_id === listId).length;
	}

	function formatDate(list: List): string {
		const dateStr = list.archived_at ?? list.updated_at;
		const date = new Date(dateStr);
		return date.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function openList(list: List) {
		selectedList = list;
	}

	function closeList() {
		selectedList = null;
	}

	const selectedListItems = $derived(
		selectedList ? items.filter((i) => i.list_id === selectedList!.id) : []
	);

	const groupedItems = $derived(
		selectedList
			? groupItemsByViewMode(selectedListItems, preferencesStore.viewMode, sections, stores)
			: []
	);
</script>

<div class="flex flex-col">
	{#if loading}
		<div class="py-8 text-center text-sm text-[var(--color-text-secondary)]">Loading...</div>
	{:else if lists.length === 0}
		<EmptyState
			icon={Clock}
			title="No history yet"
			description="Completed shopping lists will appear here once you finish shopping."
		/>
	{:else}
		<div class="flex flex-col gap-1 p-2">
			{#each lists as list (list.id)}
				<button
					onclick={() => openList(list)}
					class="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left active:bg-[var(--color-border)]"
				>
					<div class="flex-1">
						<div class="text-sm font-medium text-[var(--color-text)]">{list.name}</div>
						<div class="mt-1 flex items-center gap-3 text-xs text-[var(--color-text-secondary)]">
							<span class="flex items-center gap-1">
								<Calendar size={12} />
								{formatDate(list)}
							</span>
							<span class="flex items-center gap-1">
								<Package size={12} />
								{getItemCount(list.id)} items
							</span>
						</div>
					</div>
					<ChevronRight size={18} class="text-[var(--color-text-secondary)]" />
				</button>
			{/each}
		</div>
	{/if}
</div>

{#if selectedList}
	<div
		class="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center"
		onclick={(e) => {
			if (e.target === e.currentTarget) closeList();
		}}
		onkeydown={(e) => {
			if (e.key === 'Escape') closeList();
		}}
		tabindex="-1"
		role="dialog"
		aria-modal="true"
		aria-label="List details"
	>
		<div
			class="flex w-full max-w-lg flex-col rounded-t-xl bg-[var(--color-bg)] shadow-xl sm:rounded-xl"
			style="max-height: 85vh;"
		>
			<div class="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
				<div>
					<h2 class="text-base font-semibold text-[var(--color-text)]">{selectedList.name}</h2>
					<p class="text-xs text-[var(--color-text-secondary)]">{formatDate(selectedList)}</p>
				</div>
				<button
					onclick={closeList}
					class="rounded-full p-2 text-[var(--color-text-secondary)] active:bg-[var(--color-surface)]"
					aria-label="Close"
				>
					<X size={20} />
				</button>
			</div>

			<div class="flex-1 overflow-y-auto p-4">
				{#if selectedListItems.length === 0}
					<p class="py-8 text-center text-sm text-[var(--color-text-secondary)]">
						No items in this list.
					</p>
				{:else}
					<div class="flex flex-col gap-4">
						{#each groupedItems as group}
							<div>
								<h3 class="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-accent)]">
									{group.primaryName}
								</h3>
								{#each group.secondaryGroups as subGroup}
									{#if subGroup.secondaryName !== 'Uncategorized' && subGroup.secondaryName !== 'Any Store'}
										<h4 class="mb-1 text-xs font-medium text-[var(--color-text-secondary)]">
											{subGroup.secondaryName}
										</h4>
									{/if}
									<div class="flex flex-col gap-1">
										{#each subGroup.items as item}
											<div class="flex items-center gap-2 rounded-lg bg-[var(--color-surface)] px-3 py-2">
												<span class="text-sm">
													{item.completed ? '☑' : '☐'}
												</span>
												<span class="text-sm text-[var(--color-text)] {item.completed ? 'line-through opacity-50' : ''}">
													{item.name_snapshot}
												</span>
											</div>
										{/each}
									</div>
								{/each}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}
