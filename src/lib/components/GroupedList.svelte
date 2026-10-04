<script lang="ts">
	import { ShoppingCart } from '@lucide/svelte';
	import type { ViewMode, ListItem, Product, Section, Store } from '$lib/types';
	import type { PrimaryGroup } from '$lib/view-modes/types';
	import { projectItems } from '$lib/view-modes/projection';
	import { UNASSIGNED_ID } from '$lib/view-modes/types';
	import { reorderItems } from '$lib/drag-drop/ordering';
	import { moveItemToGroup } from '$lib/drag-drop/cross-group';
	import { findDropTarget } from '$lib/drag-drop/detection';
	import type { DragStartEvent } from '$lib/drag-drop/detection';
	import CollapsibleGroup from './CollapsibleGroup.svelte';
	import ItemRow from './ItemRow.svelte';
	import EmptyState from './EmptyState.svelte';

	interface Props {
		viewMode: ViewMode;
		items: ListItem[];
		products: Product[];
		sections: Section[];
		stores: Store[];
		onToggleItem: (itemId: string) => void;
		onDeleteItem: (itemId: string) => void;
		onReorder?: () => void;
	}

	let { viewMode, items, products, sections, stores, onToggleItem, onDeleteItem, onReorder }: Props =
		$props();

	let projectedGroups = $state<PrimaryGroup[]>([]);
	let isLoading = $state(true);
	let showMoveButtonsFor = $state<string | null>(null);

	const sectionMap = $derived.by(() => {
		const map = new Map<string, Section>();
		for (const section of sections) {
			map.set(section.id, section);
		}
		return map;
	});

	const storeMap = $derived.by(() => {
		const map = new Map<string, Store>();
		for (const store of stores) {
			map.set(store.id, store);
		}
		return map;
	});

	$effect(() => {
		isLoading = true;
		projectItems(viewMode, items, products, sections, stores).then((groups) => {
			projectedGroups = groups;
			isLoading = false;
		});
	});

	function getSectionName(sectionId: string | null): string | null {
		if (sectionId === null || sectionId === UNASSIGNED_ID) return null;
		return sectionMap.get(sectionId)?.name ?? null;
	}

	function getStoreName(storeId: string | null): string | null {
		if (storeId === null || storeId === UNASSIGNED_ID) return null;
		return storeMap.get(storeId)?.name ?? null;
	}

	const totalItems = $derived(items.filter((i) => i.deleted_at === null).length);

	function getGroupKey(primaryGroup: PrimaryGroup, secondaryGroupId: string | null): string {
		return `${viewMode}:${primaryGroup.id}:${secondaryGroupId ?? 'null'}`;
	}

	function getItemGroupIndex(itemId: string): {
		primaryIndex: number;
		secondaryIndex: number;
		itemIndex: number;
	} | null {
		for (let pi = 0; pi < projectedGroups.length; pi++) {
			const pg = projectedGroups[pi];
			for (let si = 0; si < pg.secondaryGroups.length; si++) {
				const sg = pg.secondaryGroups[si];
				const ii = sg.items.findIndex((gi) => gi.item.id === itemId);
				if (ii !== -1) {
					return { primaryIndex: pi, secondaryIndex: si, itemIndex: ii };
				}
			}
		}
		return null;
	}

	function handleDragStart(_itemId: string, _e: DragStartEvent) {
		// Drag start visual feedback handled by ItemRow
	}

	function handleDragMove(_x: number, _y: number) {
		// Transform is handled by ItemRow
	}

	async function handleDragEnd(itemId: string, x: number, y: number, _target?: unknown) {
		const target = findDropTarget(x, y);
		if (!target || target.type !== 'item' || target.id === itemId) {
			return;
		}

		const sourceLoc = getItemGroupIndex(itemId);
		const targetLoc = getItemGroupIndex(target.id);
		if (!sourceLoc || !targetLoc) return;

		const sourceGroupKey = getGroupKey(
			projectedGroups[sourceLoc.primaryIndex],
			projectedGroups[sourceLoc.primaryIndex].secondaryGroups[sourceLoc.secondaryIndex].id
		);
		const targetGroupKey = getGroupKey(
			projectedGroups[targetLoc.primaryIndex],
			projectedGroups[targetLoc.primaryIndex].secondaryGroups[targetLoc.secondaryIndex].id
		);

		if (sourceGroupKey === targetGroupKey) {
			// Reorder within same group
			await reorderItems(itemId, targetLoc.itemIndex, sourceGroupKey);
		} else {
			// Cross-group move
			const targetItem = projectedGroups[targetLoc.primaryIndex].secondaryGroups[
				targetLoc.secondaryIndex
			].items[targetLoc.itemIndex].item;
			await moveItemToGroup(itemId, targetItem.section_id, targetItem.store_id);
		}

		onReorder?.();
	}

	async function handleMoveUp(itemId: string) {
		const loc = getItemGroupIndex(itemId);
		if (!loc || loc.itemIndex <= 0) return;
		const groupKey = getGroupKey(
			projectedGroups[loc.primaryIndex],
			projectedGroups[loc.primaryIndex].secondaryGroups[loc.secondaryIndex].id
		);
		await reorderItems(itemId, loc.itemIndex - 1, groupKey);
		onReorder?.();
	}

	async function handleMoveDown(itemId: string) {
		const loc = getItemGroupIndex(itemId);
		if (!loc) return;
		const group = projectedGroups[loc.primaryIndex].secondaryGroups[loc.secondaryIndex];
		if (loc.itemIndex >= group.items.length - 1) return;
		const groupKey = getGroupKey(projectedGroups[loc.primaryIndex], group.id);
		await reorderItems(itemId, loc.itemIndex + 1, groupKey);
		onReorder?.();
	}

	async function handleMoveToSection(itemId: string) {
		const item = items.find((i) => i.id === itemId);
		if (!item) return;
		const sectionIds = sections.map((s) => s.id);
		const currentIndex = item.section_id ? sectionIds.indexOf(item.section_id) : -1;
		const nextIndex = (currentIndex + 1) % (sectionIds.length + 1);
		const nextSectionId = nextIndex < sectionIds.length ? sectionIds[nextIndex] : null;
		await moveItemToGroup(itemId, nextSectionId, item.store_id);
		onReorder?.();
	}

	async function handleMoveToStore(itemId: string) {
		const item = items.find((i) => i.id === itemId);
		if (!item) return;
		const storeIds = stores.map((s) => s.id);
		const currentIndex = item.store_id ? storeIds.indexOf(item.store_id) : -1;
		const nextIndex = (currentIndex + 1) % (storeIds.length + 1);
		const nextStoreId = nextIndex < storeIds.length ? storeIds[nextIndex] : null;
		await moveItemToGroup(itemId, item.section_id, nextStoreId);
		onReorder?.();
	}

	function toggleMoveButtons(itemId: string) {
		showMoveButtonsFor = showMoveButtonsFor === itemId ? null : itemId;
	}
</script>

{#if isLoading}
	<div class="flex items-center justify-center py-12">
		<div
			class="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]"
		></div>
	</div>
{:else if projectedGroups.length === 0 || totalItems === 0}
	<EmptyState
		icon={ShoppingCart}
		title="No items yet"
		description="Add items to your list to see them organized here."
	/>
{:else}
	<div class="flex flex-col gap-2 p-2">
		{#each projectedGroups as primaryGroup (primaryGroup.id)}
			<CollapsibleGroup
				groupKey="{viewMode}:{primaryGroup.id}"
				title={primaryGroup.name}
				itemCount={primaryGroup.secondaryGroups.reduce((sum, sg) => sum + sg.items.length, 0)}
				level="primary"
			>
				<div class="flex flex-col gap-1">
					{#each primaryGroup.secondaryGroups as secondaryGroup (secondaryGroup.id)}
						<CollapsibleGroup
							groupKey="{viewMode}:{primaryGroup.id}:{secondaryGroup.id ?? 'null'}"
							title={secondaryGroup.name}
							itemCount={secondaryGroup.items.length}
							level="secondary"
						>
							<div class="flex flex-col">
								{#each secondaryGroup.items as groupedItem, itemIndex (groupedItem.item.id)}
									{@const groupKey = getGroupKey(primaryGroup, secondaryGroup.id)}
									{@const groupItemsCount = secondaryGroup.items.length}
									<ItemRow
										item={groupedItem.item}
										sectionName={getSectionName(groupedItem.item.section_id)}
										storeName={getStoreName(groupedItem.item.store_id)}
										onToggle={() => onToggleItem(groupedItem.item.id)}
										onDelete={() => onDeleteItem(groupedItem.item.id)}
										dragData={{
											type: 'item',
											id: groupedItem.item.id,
											listId: groupedItem.item.list_id,
											groupId: groupKey
										}}
										dropTargetData={{
											type: 'item',
											id: groupedItem.item.id,
											listId: groupedItem.item.list_id,
											groupId: groupKey
										}}
										onDragStart={(e) => handleDragStart(groupedItem.item.id, e)}
										onDragMove={handleDragMove}
										onDragEnd={(x, y, target) => handleDragEnd(groupedItem.item.id, x, y, target)}
										canMoveUp={itemIndex > 0}
										canMoveDown={itemIndex < groupItemsCount - 1}
										canMoveSection={sections.length > 1}
										canMoveStore={stores.length > 1}
										onMoveUp={() => handleMoveUp(groupedItem.item.id)}
										onMoveDown={() => handleMoveDown(groupedItem.item.id)}
										onMoveSection={() => handleMoveToSection(groupedItem.item.id)}
										onMoveStore={() => handleMoveToStore(groupedItem.item.id)}
										showMoveButtons={showMoveButtonsFor === groupedItem.item.id}
										onToggleMoveButtons={() => toggleMoveButtons(groupedItem.item.id)}
									/>
								{/each}
							</div>
						</CollapsibleGroup>
					{/each}
				</div>
			</CollapsibleGroup>
		{/each}
	</div>
{/if}
