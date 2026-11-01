<script lang="ts">
	import { onMount } from 'svelte';
	import { X, ChevronUp, ChevronDown, ChevronRight, Plus, Archive, Pencil, Check } from '@lucide/svelte';
	import { fly, fade } from 'svelte/transition';
	import { listStore } from '$lib/stores/list.svelte';
	import { mealStore } from '$lib/stores/meal.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { preferencesStore } from '$lib/stores/preferences.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import QuantityControl from '$lib/components/QuantityControl.svelte';
	import ProductSearchCreate from '$lib/components/ProductSearchCreate.svelte';
	import {
		buildMealPlanRows,
		buildSuggestedRows,
		hasMealPlan,
		hasSuggested
	} from '$lib/meals/suggested-view';
	import type { SuggestedProduct } from '$lib/meals/suggested';
	import { db } from '$lib/db/database';
	import { getActiveEntities, createList, updateProduct, updateList, createSectionAtEnd, createStoreAtEnd, updateListItem, moveEntityToGroupEnd } from '$lib/db/operations';
	import { compareSortKeys, compareSectionSortKeys, sortKeyAfter, planReorder } from '$lib/utils/ordering';
	import { toastStore } from '$lib/stores/toast.svelte';
	import type { Product, Section, Store, List, ListItem } from '$lib/types';

	uiStore.setHeaderTitle('');
	uiStore.setShowBackButton(false);

	// List management
	let showListSheet = $state(false);
	let allLists = $state<List[]>([]);
	let editingListId = $state<string | null>(null);
	let editListName = $state('');

	let allProducts = $state<Product[]>([]);
	let allSections = $state<Section[]>([]);
	let searchQuery = $state('');
	let collapsedSections = $state<Set<string | null>>(new Set());
	// Sentinel collapse keys for the two synthetic sections (Item 6). They share
	// the SAME collapsedSections set + toggleSection as normal groups; the
	// sentinels can never collide with a real section id (which is a UUID).
	const MEAL_PLAN_KEY = '__meal_plan__';
	const SUGGESTED_KEY = '__suggested__';

	const sectionsArray = $derived(Array.from(listStore.sections.values()));

	// Set of product IDs currently on the active list
	const onListProductIds = $derived(new Set(listStore.items.map(i => i.product_id)));

	// ---------------------------------------------------------------------------
	// MEALS — "Meal Plan" + "Suggested" synthetic sections (Phase 3).
	//
	// These render ABOVE the normal product groups and live entirely OUTSIDE the
	// product grouping, so the one-bucket-per-item contract is untouched (a
	// Suggested product is a would-be ListItem, not yet an item, so there is no
	// double-render — assessment §4).
	//
	// REUSE, don't recompute: the summed+curated suggested products come straight
	// from the Phase-2 selector `mealStore.computeSuggestedForList` (which gathers
	// selected meals → their MealProducts → contributions, the already-on-list set,
	// and calls the pure `computeSuggested`). We only ADAPT its output to rows.
	// ---------------------------------------------------------------------------

	let suggestedProducts = $state<SuggestedProduct[]>([]);

	// Recompute the suggested products whenever the inputs that feed the Phase-2
	// selector change: the active list, the set of items on it (so tap-to-add
	// reactively drops a row once the product becomes a ListItem — the curation
	// rule), and the meal selections (select/deselect). We read these reactive
	// values synchronously so the effect re-subscribes, then run the async
	// Dexie-backed selector and assign the result.
	$effect(() => {
		const list = listStore.activeList;
		// Touch the reactive dependencies so this effect re-runs on their change.
		void listStore.items;
		void mealStore.selections;
		if (!list) {
			suggestedProducts = [];
			return;
		}
		let cancelled = false;
		mealStore.computeSuggestedForList(list.id).then((rows) => {
			if (!cancelled) suggestedProducts = rows;
		});
		return () => {
			cancelled = true;
		};
	});

	// Adapt the Phase-2 outputs into the two synthetic view sections. The Meal
	// Plan section uses `mealPlanMeals` (selected meals FILTERED to
	// in_meal_plan=true) — a pure display filter that does NOT touch Suggested,
	// which still derives from all selections via computeSuggestedForList.
	const mealPlanRows = $derived(buildMealPlanRows(mealStore.mealPlanMeals));
	const suggestedRows = $derived(
		buildSuggestedRows(suggestedProducts, (id) => listStore.products.get(id)?.name)
	);

	// Empty-state choice (locked): hide BOTH sections entirely when no meals are
	// selected (keep the list clean). Meal Plan shows whenever meals are planned;
	// Suggested shows only when it has rows (all-already-on-list → Suggested hides
	// but Meal Plan can still show what was planned).
	const showMealPlan = $derived(hasMealPlan(mealPlanRows.length));
	const showSuggested = $derived(hasSuggested(suggestedRows.length));

	async function addSuggested(productId: string, quantity: number) {
		const product = listStore.products.get(productId);
		// Reuse the normal add path; pass the summed meal quantity (clamped to a
		// positive integer inside the store). Once added, the product is on the
		// list → computeSuggestedForList excludes it → the reactive effect above
		// drops it from Suggested automatically.
		await listStore.addItem(
			productId,
			product?.default_section_id ?? null,
			product?.default_store_id ?? null,
			quantity
		);
	}

	async function deselectMeal(mealId: string) {
		if (!listStore.activeList) return;
		await mealStore.deselectMeal(mealId, listStore.activeList.id);
	}

	// Filter products by search query
	const filteredProducts = $derived.by(() => {
		const q = searchQuery.toLowerCase().trim();
		if (!q) return allProducts;
		return allProducts.filter(p => p.name.toLowerCase().includes(q));
	});

	// Check if search query matches no existing product (for "New" badge)
	const isNewProduct = $derived.by(() => {
		const q = searchQuery.trim();
		if (!q) return false;
		return !allProducts.some(p => p.name.toLowerCase() === q.toLowerCase());
	});

	// Group filtered products by section, with on-list items at the top of each
	const groupedProducts = $derived.by(() => {
		const groups: { section: Section | null; products: Array<{ product: Product; onList: boolean }> }[] = [];
		const sectionMap = new Map<string | null, Array<{ product: Product; onList: boolean }>>();

		for (const product of filteredProducts) {
			const sectionId = product.default_section_id || null;
			if (!sectionMap.has(sectionId)) {
				sectionMap.set(sectionId, []);
			}
			sectionMap.get(sectionId)!.push({
				product,
				onList: onListProductIds.has(product.id)
			});
		}

		// Sort sections by their fractional sort_order. The keys are STRING
		// fractional indexes, so they MUST be compared with compareSectionSortKeys
		// (lexicographic, unassigned-last) — the same contract shop mode uses
		// (view-modes/grouping.ts). The previous `orderA - orderB` subtracted
		// strings, producing NaN and leaving insertion order, which diverged from
		// shop mode (Item 10).
		const sectionOrder = new Map(allSections.map(s => [s.id, s.sort_order]));
		const sortedKeys = [...sectionMap.keys()].sort((a, b) =>
			compareSectionSortKeys(a ? sectionOrder.get(a) : null, b ? sectionOrder.get(b) : null)
		);

		for (const sectionId of sortedKeys) {
			const section = sectionId ? allSections.find(s => s.id === sectionId) ?? null : null;
			const products = sectionMap.get(sectionId)!;
			// On-list items at the top, then by sort_order, then by name
			products.sort((a, b) => {
				if (a.onList !== b.onList) return a.onList ? -1 : 1;
				const orderCmp = compareSortKeys(a.product.sort_order, b.product.sort_order);
				if (orderCmp !== 0) return orderCmp;
				return a.product.name.localeCompare(b.product.name);
			});
			groups.push({ section, products });
		}

		return groups;
	});

	async function ensureActiveList() {
		if (!listStore.activeList) {
			const { getActiveList } = await import('$lib/db/queries');
			const existing = await getActiveList();
			if (existing) {
				listStore.activeList = existing;
				await listStore.loadListData(existing.id);
				return;
			}
			const list = await createList({
				name: 'Shopping List',
				status: 'ACTIVE',
				sort_order: sortKeyAfter(null),
				started_at: new Date().toISOString(),
				archived_at: null
			});
			listStore.activeList = list;
			await listStore.loadListData(list.id);
			// Genuinely-new list → auto-select the usuals (see ensureUsualsSelected
			// trigger policy). Done only on creation, never on adopting an existing
			// list, so a per-list opt-out of a usual is never resurrected.
			await mealStore.ensureUsualsSelected(list.id);
			await mealStore.loadSelections(list.id);
		}
	}

	async function loadProducts() {
		allProducts = await getActiveEntities<Product>('products');
		allSections = await getActiveEntities<Section>('sections');
	}

	async function loadLists() {
		const all = await db.lists.toArray();
		allLists = all.filter(l => !l.deleted_at).sort((a, b) => {
			// Active lists first, then by date
			if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
			if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1;
			return (b.created_at || '').localeCompare(a.created_at || '');
		});
	}

	async function openListSheet() {
		await loadLists();
		showListSheet = true;
		uiStore.dialogOpen = true;
	}

	function closeListSheet() {
		showListSheet = false;
		uiStore.dialogOpen = false;
		cancelEditList();
	}

	async function switchToList(list: List) {
		listStore.activeList = list;
		await listStore.loadListData(list.id);
		closeListSheet();
	}

	function startEditList(list: List) {
		editingListId = list.id;
		editListName = list.name;
	}

	function cancelEditList() {
		editingListId = null;
		editListName = '';
	}

	async function handleListRenameSave() {
		const name = editListName.trim();
		if (!name || !editingListId) {
			if (!name) toastStore.error('Name cannot be empty.');
			return;
		}
		await updateList(editingListId, { name });
		// Keep the active-list display reactive if the renamed list is active.
		if (editingListId === listStore.activeList?.id) {
			listStore.activeList = { ...listStore.activeList, name };
		}
		editingListId = null;
		editListName = '';
		await loadLists();
	}

	function handleListRenameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			handleListRenameSave();
		} else if (e.key === 'Escape') {
			cancelEditList();
		}
	}

	async function createNewList() {
		// Only archive current list if it has items
		if (listStore.activeList && listStore.items.length > 0) {
			await updateList(listStore.activeList.id, {
				status: 'ARCHIVED',
				archived_at: new Date().toISOString()
			});
		} else if (listStore.activeList && listStore.items.length === 0) {
			// Empty list — just keep using it, nothing to do
			closeListSheet();
			return;
		}

		// Create new active list
		const list = await createList({
			name: 'Shopping List',
			status: 'ACTIVE',
			sort_order: sortKeyAfter(null),
			started_at: new Date().toISOString(),
			archived_at: null
		});

		listStore.activeList = list;
		await listStore.loadListData(list.id);
		// New list → auto-select the usuals (trigger policy: creation only).
		await mealStore.ensureUsualsSelected(list.id);
		await mealStore.loadSelections(list.id);
		closeListSheet();
	}

	async function archiveCurrentList() {
		if (!listStore.activeList) return;

		// Don't archive an empty list — just ignore
		if (listStore.items.length === 0) {
			closeListSheet();
			return;
		}

		await updateList(listStore.activeList.id, {
			status: 'ARCHIVED',
			archived_at: new Date().toISOString()
		});

		// Create a fresh list
		const list = await createList({
			name: 'Shopping List',
			status: 'ACTIVE',
			sort_order: sortKeyAfter(null),
			started_at: new Date().toISOString(),
			archived_at: null
		});

		listStore.activeList = list;
		await listStore.loadListData(list.id);
		// New list → auto-select the usuals (trigger policy: creation only).
		await mealStore.ensureUsualsSelected(list.id);
		await mealStore.loadSelections(list.id);
		closeListSheet();
	}

	onMount(async () => {
		await listStore.loadActiveList();
		await ensureActiveList();
		await loadProducts();
		// Load meals + the active list's selections so the Meal Plan / Suggested
		// sections can render. computeSuggestedForList reads Dexie directly, so it
		// does not depend on meal products being cached in memory.
		await mealStore.loadMeals();
		if (listStore.activeList) await mealStore.loadSelections(listStore.activeList.id);
	});

	// Reload products when sync brings new data
	import { syncStateStore } from '$lib/sync/state.svelte';
	let lastDataVersion = 0;
	$effect(() => {
		const version = syncStateStore.dataVersion;
		if (version > lastDataVersion) {
			lastDataVersion = version;
			loadProducts();
			// Keep the Meal Plan / Suggested sections current when sync brings new
			// meal data. Reassigning selections re-runs the suggested effect.
			mealStore.loadMeals();
			if (listStore.activeList) mealStore.loadSelections(listStore.activeList.id);
		}
	});

	function toggleProduct(product: Product) {
		if (onListProductIds.has(product.id)) {
			// Remove from list
			const item = listStore.items.find(i => i.product_id === product.id);
			if (item) listStore.removeItem(item.id);
		} else {
			// Add to list
			listStore.addItem(product.id, product.default_section_id, product.default_store_id);
		}
	}

	// Create a brand-new product from the shared ProductSearchCreate create zone.
	// The component passes the trimmed query and clears the bound `searchQuery`
	// itself (clear-on-create), so this only does the create + edit-sheet open.
	async function addNewProduct(rawName: string) {
		const name = rawName.trim();
		if (!name) return;

		// Create product + list item; both derive their sort_order atomically from
		// the current group max (see createProductAtEnd / createListItemAtEnd).
		await listStore.addNewProductAndItem(name, null, null);

		await loadProducts();

		// Immediately open the edit sheet for the new product
		const newProduct = allProducts.find(p => p.name.toLowerCase() === name.toLowerCase());
		if (newProduct) {
			openEditSheet(newProduct);
		}
	}

	function toggleSection(sectionId: string | null) {
		const next = new Set(collapsedSections);
		if (next.has(sectionId)) {
			next.delete(sectionId);
		} else {
			next.add(sectionId);
		}
		collapsedSections = next;
	}

	// Long-press edit
	let editingProduct = $state<Product | null>(null);
	let allStores = $state<Store[]>([]);
	let editName = $state('');
	let editSectionId = $state<string>('');
	let editStoreId = $state<string>('');
	let addingNewSection = $state(false);
	let addingNewStore = $state(false);
	let newSectionName = $state('');
	let newStoreName = $state('');

	async function openEditSheet(product: Product) {
		allStores = await getActiveEntities<Store>('stores');
		editingProduct = product;
		editName = product.name;
		editSectionId = product.default_section_id || '';
		editStoreId = product.default_store_id || '';
		addingNewSection = false;
		addingNewStore = false;
		newSectionName = '';
		newStoreName = '';
		uiStore.dialogOpen = true;
	}

	function closeEditSheet() {
		editingProduct = null;
		addingNewSection = false;
		addingNewStore = false;
		uiStore.dialogOpen = false;
	}

	async function handleSectionChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value;
		if (value === '__new__') {
			addingNewSection = true;
			editSectionId = '';
		} else {
			editSectionId = value;
			addingNewSection = false;
		}
	}

	async function handleStoreChange(e: Event) {
		const value = (e.target as HTMLSelectElement).value;
		if (value === '__new__') {
			addingNewStore = true;
			editStoreId = '';
		} else {
			editStoreId = value;
			addingNewStore = false;
		}
	}

	async function createNewSection() {
		const name = newSectionName.trim();
		if (!name) return;
		const section = await createSectionAtEnd({
			list_id: null,
			name,
			active: true
		});
		allSections = [...allSections, section];
		editSectionId = section.id;
		addingNewSection = false;
		newSectionName = '';
	}

	async function createNewStore() {
		const name = newStoreName.trim();
		if (!name) return;
		const store = await createStoreAtEnd({
			name,
			active: true
		});
		allStores = [...allStores, store];
		editStoreId = store.id;
		addingNewStore = false;
		newStoreName = '';
	}

	async function saveProductEdit() {
		if (!editingProduct) return;

		const name = editName.trim();
		if (!name) {
			toastStore.error('Name cannot be empty.');
			return;
		}

		const productId = editingProduct.id;
		const newSectionId = editSectionId || null;
		const newStoreId = editStoreId || null;
		const sectionChanged = newSectionId !== (editingProduct.default_section_id || null);

		const listItem = listStore.items.find(i => i.product_id === productId);

		if (sectionChanged) {
			// Moving the product into a different section: append it to the END of
			// the destination section via the shared atomic group-max path, so the
			// new key is derived from the live group max inside a transaction and
			// cannot collide with a drifted/duplicate key in the target section.
			await moveEntityToGroupEnd<Product>(
				'products',
				'Product',
				productId,
				p => (p.default_section_id ?? null) === newSectionId,
				{ name, default_section_id: newSectionId, default_store_id: newStoreId }
			);

			// Mirror the move onto the matching ListItem: append it to the end of
			// its own group (items sharing this list) through the same shared op,
			// updating its section/store. name_snapshot stays frozen — renaming a
			// product does not rewrite list history.
			if (listItem) {
				await moveEntityToGroupEnd<ListItem>(
					'listItems',
					'ListItem',
					listItem.id,
					i => i.list_id === listItem.list_id,
					{ section_id: newSectionId, store_id: newStoreId }
				);
			}
		} else {
			// Section unchanged: SAVE-ON-SUBMIT must preserve the product's CURRENT
			// persisted position (including any reorder done with the up/down
			// buttons while the sheet was open). Omit sort_order from the update so
			// the DB keeps whatever the reorder wrote — never stamp back the stale
			// key captured when the sheet opened.
			await updateProduct(productId, {
				name,
				default_section_id: newSectionId,
				default_store_id: newStoreId
			});

			if (listItem) {
				await updateListItem(listItem.id, {
					section_id: newSectionId,
					store_id: newStoreId
				});
			}
		}

		if (listItem) await listStore.loadActiveList();
		await loadProducts();
		closeEditSheet();
	}

	// Reordering within section. Siblings are sorted by sort_order with a stable
	// tiebreak (name, then id) so that even a degenerate group where every key is
	// identical yields a deterministic, repeatable visual order.
	function getProductPositionInSection(): { index: number; total: number; siblings: Product[] } {
		if (!editingProduct) return { index: -1, total: 0, siblings: [] };
		const sectionId = editingProduct.default_section_id || null;
		const siblings = allProducts
			.filter(p => (p.default_section_id || null) === sectionId)
			.sort((a, b) => {
				const cmp = compareSortKeys(a.sort_order, b.sort_order);
				if (cmp !== 0) return cmp;
				const nameCmp = a.name.localeCompare(b.name);
				if (nameCmp !== 0) return nameCmp;
				return a.id.localeCompare(b.id);
			});
		const index = siblings.findIndex(p => p.id === editingProduct!.id);
		return { index, total: siblings.length, siblings };
	}

	// Apply a product reorder within its section. Writes each product whose key
	// changed (one row on the happy path, the whole group on a rebalance) and
	// mirrors the key onto any matching ListItem on the active list. All writes
	// run in a single Dexie transaction so a rebalance is atomic.
	async function applyProductReorder(siblings: Product[], movingId: string, newIndex: number) {
		const writes = planReorder(siblings, movingId, newIndex);
		if (writes.length === 0) return;

		await db.transaction('rw', db.products, db.listItems, db.changes, async () => {
			for (const { id, sort_order } of writes) {
				await updateProduct(id, { sort_order });
				const listItem = listStore.items.find(i => i.product_id === id);
				if (listItem) await updateListItem(listItem.id, { sort_order });
			}
		});

		await loadProducts();
		await listStore.loadActiveList();
	}

	async function moveProductUp() {
		if (!editingProduct) return;
		const { index, siblings } = getProductPositionInSection();
		if (index <= 0) return;
		try {
			await applyProductReorder(siblings, editingProduct.id, index - 1);
		} catch (err) {
			console.error('Failed to move product up:', err);
			toastStore.error('Could not reorder item. Please try again.');
		}
	}

	async function moveProductDown() {
		if (!editingProduct) return;
		const { index, siblings } = getProductPositionInSection();
		if (index >= siblings.length - 1) return;
		try {
			await applyProductReorder(siblings, editingProduct.id, index + 1);
		} catch (err) {
			console.error('Failed to move product down:', err);
			toastStore.error('Could not reorder item. Please try again.');
		}
	}
</script>

<div class="flex min-h-full flex-col" data-testid="list-page">
	{#if listStore.loading}
		<div class="flex flex-1 items-center justify-center py-16">
			<LoadingSpinner />
		</div>
	{:else}
		<!-- List picker + Search bar -->
		<div class="flex items-center gap-2 px-4 pt-3 pb-1">
			<button
				onclick={openListSheet}
				class="flex items-center gap-1 rounded-lg px-2 py-1 text-left active:bg-[var(--color-surface)]"
				style="min-height: auto; min-width: auto;"
			>
				<ChevronDown size={12} class="text-[var(--color-text-secondary)]" />
				<span class="text-xs text-[var(--color-text-secondary)]">Switch list</span>
			</button>
		</div>
		<!-- Search + create: the SHARED ProductSearchCreate (Items 4 + 7) — the
		     same component the meals page uses. It owns the search input, the
		     clear (X) button, and the dashed "New …" create ZONE (shown only when
		     the query matches no existing product). The list page renders its own
		     grouped result rows BELOW (interleaved with the synthetic Meal Plan /
		     Suggested sections and preserving per-section ordering/collapse), so
		     we pass `items={[]}` (no duplicate flat rows here) and drive the create
		     zone explicitly with `isNew={isNewProduct}`. Selecting is a no-op on
		     this page (no flat rows); creating goes through `addNewProduct`. -->
		<div class="px-4 pb-2">
			<ProductSearchCreate
				bind:query={searchQuery}
				items={[]}
				isNew={isNewProduct}
				onSelect={() => {}}
				onCreate={addNewProduct}
				placeholder="Search or add items..."
				createLabel="New"
				searchTestId="search-input"
				createTestId="add-new-product"
			/>
		</div>

		<!-- Product catalog -->
		<div class="flex flex-col px-4 pb-24 pt-1">
			<!-- List summary -->
			{#if listStore.items.length > 0}
				<div class="mb-2 text-xs text-[var(--color-text-secondary)]">
					{listStore.items.length} item{listStore.items.length !== 1 ? 's' : ''} on list
				</div>
			{/if}

			<!-- The "New …" create row now lives in the shared ProductSearchCreate
			     above (create ZONE), so no per-page create button is rendered here. -->

			<!-- MEAL PLAN + SUGGESTED (synthetic sections, Phase 3).
			     Rendered FIRST, above all normal product groups. Hidden while
			     searching (search is for adding products; these are a planning
			     aid) and hidden entirely when no meals are selected. -->
			{#if !searchQuery.trim()}
				{#if showMealPlan}
					{@const mealPlanCollapsed = collapsedSections.has(MEAL_PLAN_KEY)}
					<div class="mt-3 first:mt-0" data-testid="meal-plan-section">
						<!-- Collapsible header: reuses the same collapsedSections/toggleSection
						     mechanism and chevron as the normal product groups (Item 6). -->
						<button
							onclick={() => toggleSection(MEAL_PLAN_KEY)}
							data-testid="meal-plan-collapse"
							class="flex w-full items-center gap-1 py-1.5 text-left"
							style="min-height: 32px; min-width: auto;"
						>
							<ChevronRight size={14} class="shrink-0 text-[var(--color-text-secondary)] transition-transform {mealPlanCollapsed ? '' : 'rotate-90'}" />
							<span class="flex-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
								Meal Plan
							</span>
							<span class="text-xs font-medium text-[var(--color-accent)]">{mealPlanRows.length}</span>
						</button>
						{#if !mealPlanCollapsed}
						{#each mealPlanRows as row (row.meal_id)}
							<div
								class="flex items-center gap-1 rounded-lg"
								data-testid="meal-plan-row"
								data-meal-name={row.name}
							>
								<span class="flex-1 px-2 py-2.5 text-sm font-medium text-[var(--color-text)]">
									{row.name}
								</span>
								<!-- Convenience deselect — reuses the Phase-2 deselect path. -->
								<button
									onclick={() => deselectMeal(row.meal_id)}
									data-testid="meal-plan-deselect"
									class="flex shrink-0 items-center justify-center rounded-full p-2 text-[var(--color-text-secondary)] active:bg-[var(--color-border)]"
									style="min-height: 36px; min-width: 36px;"
									aria-label={`Remove ${row.name} from meal plan`}
								>
									<X size={16} />
								</button>
							</div>
						{/each}
						{/if}
					</div>
				{/if}

				{#if showSuggested}
					{@const suggestedCollapsed = collapsedSections.has(SUGGESTED_KEY)}
					<div class="mt-3 first:mt-0" data-testid="suggested-section">
						<!-- Collapsible header, same mechanism as above (Item 6). -->
						<button
							onclick={() => toggleSection(SUGGESTED_KEY)}
							data-testid="suggested-collapse"
							class="flex w-full items-center gap-1 py-1.5 text-left"
							style="min-height: 32px; min-width: auto;"
						>
							<ChevronRight size={14} class="shrink-0 text-[var(--color-text-secondary)] transition-transform {suggestedCollapsed ? '' : 'rotate-90'}" />
							<span class="flex-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
								Suggested
							</span>
							<span class="text-xs font-medium text-[var(--color-accent)]">{suggestedRows.length}</span>
						</button>
						{#if !suggestedCollapsed}
						{#each suggestedRows as row (row.product_id)}
							<!-- Tap-to-add: adds the product to the active list with the
							     summed meal quantity. Afterwards the curation rule drops it
							     from Suggested (reactive recompute). -->
							<button
								onclick={() => addSuggested(row.product_id, row.quantity)}
								data-testid="suggested-row"
								data-product-name={row.name}
								data-quantity={row.quantity}
								class="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left active:bg-[var(--color-surface)]"
							>
								<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-[var(--color-primary)]" style="min-height: auto; min-width: auto;">
									<Plus size={14} class="text-[var(--color-primary)]" />
								</div>
								<span class="flex-1 text-sm text-[var(--color-text)]">{row.name}</span>
								<span class="rounded-lg px-3 text-base font-semibold text-[var(--color-accent)]">
									×{row.quantity}
								</span>
							</button>
						{/each}
						{/if}
					</div>
				{/if}
			{/if}

			<!-- Grouped products -->
			{#each groupedProducts as group}
				{#if group.products.length > 0}
					{@const sectionId = group.section?.id ?? null}
					{@const isCollapsed = collapsedSections.has(sectionId)}
					{@const onListCount = group.products.filter(p => p.onList).length}
					<div class="mt-3 first:mt-0">
						<button
							onclick={() => toggleSection(sectionId)}
							class="flex w-full items-center gap-1 py-1.5 text-left"
							style="min-height: 32px; min-width: auto;"
						>
							<ChevronRight size={14} class="shrink-0 text-[var(--color-text-secondary)] transition-transform {isCollapsed ? '' : 'rotate-90'}" />
							<span class="flex-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
								{group.section?.name ?? 'Uncategorized'}
							</span>
							{#if onListCount > 0}
								<span class="text-xs font-medium text-[var(--color-accent)]">{onListCount}</span>
							{/if}
						</button>
						{#if !isCollapsed}
							{#each group.products as { product, onList } (product.id)}
							<div class="flex items-center gap-1 rounded-lg transition-colors active:bg-[var(--color-surface)]" data-testid="product-row" data-product-name={product.name} data-on-list={onList}>
								<button
									onclick={() => toggleProduct(product)}
									class="flex flex-1 items-center gap-3 px-2 py-2.5 text-left"
								>
									<!-- Checkbox -->
									<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors {onList ? 'border-[var(--color-primary)] bg-[var(--color-primary)]' : 'border-[var(--color-border)]'}" style="min-height: auto; min-width: auto;">
										{#if onList}
											<svg class="h-3.5 w-3.5 text-white" viewBox="0 0 14 14" fill="none">
												<path d="M2 7l4 4 6-7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
											</svg>
										{/if}
									</div>
									<!-- Product name -->
									<span class="flex-1 text-sm {onList ? 'font-medium text-[var(--color-text)]' : 'text-[var(--color-text-secondary)]'}">
										{product.name}
									</span>
								</button>
								<!-- Quantity badge + inline control (on-list items only).
								     Distinct hit area; does not toggle the product on/off. -->
								{#if onList}
									{@const listItem = listStore.items.find((i) => i.product_id === product.id)}
									{#if listItem}
										<QuantityControl
											quantity={listItem.quantity}
											onAdjust={(delta) => listStore.adjustItemQuantity(listItem.id, delta)}
											label={product.name}
										/>
									{/if}
								{/if}
								<!-- Edit button -->
								<button
									onclick={() => openEditSheet(product)}
									class="flex shrink-0 items-center justify-center rounded-full p-2 text-[var(--color-text-secondary)] active:bg-[var(--color-border)]"
									style="min-height: 36px; min-width: 36px;"
									aria-label="Edit {product.name}"
								>
									<Pencil size={14} />
								</button>
							</div>
						{/each}
						{/if}
					</div>
				{/if}
			{/each}

			<!-- Empty state -->
			{#if allProducts.length === 0 && !searchQuery}
				<div class="flex flex-col items-center py-12 text-center">
					<p class="text-sm text-[var(--color-text-secondary)]">No products yet. Type a name above to add your first item.</p>
				</div>
			{:else if filteredProducts.length === 0 && searchQuery && !isNewProduct}
				<div class="flex flex-col items-center py-12 text-center">
					<p class="text-sm text-[var(--color-text-secondary)]">No matching products.</p>
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- List management sheet -->
{#if showListSheet}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[60] flex items-end"
		role="dialog"
		aria-modal="true"
		onkeydown={(e) => { if (e.key === 'Escape') closeListSheet(); }}
	>
		<div
			class="absolute inset-0 bg-black/50"
			onclick={closeListSheet}
			transition:fade={{ duration: 200 }}
		></div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="relative w-full rounded-t-3xl bg-[var(--color-bg)] px-5 pt-3 pb-6"
			style="padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px)); max-height: 70vh;"
			onclick={(e) => e.stopPropagation()}
			transition:fly={{ y: 300, duration: 250 }}
		>
			<div class="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--color-border)]"></div>

			<div class="flex items-center justify-between mb-4">
				<h2 class="text-lg font-semibold text-[var(--color-text)]">Lists</h2>
				<button
					onclick={createNewList}
					class="flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-medium text-white active:brightness-90"
					style="min-height: auto; min-width: auto;"
				>
					<Plus size={16} />
					New List
				</button>
			</div>

			<div class="overflow-y-auto" style="max-height: 40vh;">
				{#each allLists as list (list.id)}
					{@const isCurrent = list.id === listStore.activeList?.id}
					{#if editingListId === list.id}
						<div class="flex w-full items-center gap-2 rounded-lg px-3 py-2">
							<!-- svelte-ignore a11y_autofocus -->
							<input
								bind:value={editListName}
								onkeydown={handleListRenameKeydown}
								autofocus
								aria-label="List name"
								class="flex-1 rounded-md bg-[var(--color-bg)] px-2 py-1.5 text-sm text-[var(--color-text)] outline-none ring-1 ring-[var(--color-border)] focus:ring-[var(--color-accent)]"
							/>
							<button
								onclick={handleListRenameSave}
								class="rounded-md p-1.5 text-[var(--color-success)] active:bg-[var(--color-surface)]"
								aria-label="Save"
							>
								<Check size={16} />
							</button>
							<button
								onclick={cancelEditList}
								class="rounded-md p-1.5 text-[var(--color-text-secondary)] active:bg-[var(--color-surface)]"
								aria-label="Cancel"
							>
								<X size={16} />
							</button>
						</div>
					{:else}
						<div class="flex w-full items-center gap-1 rounded-lg {isCurrent ? 'bg-[var(--color-primary)]/10' : 'active:bg-[var(--color-surface)]'}">
							<button
								onclick={() => switchToList(list)}
								class="flex flex-1 min-w-0 items-center gap-3 px-3 py-3 text-left"
							>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2">
										<span class="truncate text-sm font-medium {isCurrent ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}">
											{list.name}
										</span>
										{#if list.status === 'ARCHIVED'}
											<span class="rounded bg-[var(--color-border)] px-1.5 py-0.5 text-xs text-[var(--color-text-secondary)]">archived</span>
										{/if}
									</div>
									<span class="text-xs text-[var(--color-text-secondary)]">
										{new Date(list.created_at).toLocaleDateString()}
									</span>
								</div>
								{#if isCurrent}
									<span class="text-xs font-medium text-[var(--color-accent)]">Current</span>
								{/if}
							</button>
							<button
								onclick={() => startEditList(list)}
								class="flex shrink-0 items-center justify-center rounded-full p-2 text-[var(--color-text-secondary)] active:bg-[var(--color-border)]"
								style="min-height: 36px; min-width: 36px;"
								aria-label={`Rename ${list.name}`}
							>
								<Pencil size={14} />
							</button>
						</div>
					{/if}
				{/each}
			</div>

			{#if listStore.activeList}
				<div class="mt-4 border-t border-[var(--color-border)] pt-3">
					<button
						onclick={archiveCurrentList}
						class="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-3 text-sm font-medium text-[var(--color-text-secondary)] active:bg-[var(--color-border)]"
					>
						<Archive size={16} />
						Archive current & start new
					</button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<!-- Edit product bottom sheet -->
{#if editingProduct}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[60] flex items-end"
		role="dialog"
		aria-modal="true"
		onkeydown={(e) => { if (e.key === 'Escape') closeEditSheet(); }}
	>
		<div
			class="absolute inset-0 bg-black/50"
			onclick={closeEditSheet}
			transition:fade={{ duration: 200 }}
		></div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="relative w-full rounded-t-3xl bg-[var(--color-bg)] px-5 pt-3 pb-6"
			style="padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px));"
			onclick={(e) => e.stopPropagation()}
			transition:fly={{ y: 300, duration: 250 }}
		>
			<div class="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--color-border)]"></div>

			<h2 class="mb-4 text-lg font-semibold text-[var(--color-text)]">{editingProduct.name}</h2>

			<!-- Reorder within section -->
			{#if editingProduct}
				{@const pos = getProductPositionInSection()}
				<div class="mb-4 flex items-center gap-2">
					<span class="flex-1 text-xs text-[var(--color-text-secondary)]">
						Position {pos.index + 1} of {pos.total} in section
					</span>
					<button
						onclick={moveProductUp}
						disabled={pos.index <= 0}
						class="flex items-center justify-center rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text)] disabled:opacity-30 active:bg-[var(--color-surface)]"
						style="min-height: 36px; min-width: 36px;"
						aria-label="Move up"
					>
						<ChevronUp size={18} />
					</button>
					<button
						onclick={moveProductDown}
						disabled={pos.index >= pos.total - 1}
						class="flex items-center justify-center rounded-lg border border-[var(--color-border)] p-2 text-[var(--color-text)] disabled:opacity-30 active:bg-[var(--color-surface)]"
						style="min-height: 36px; min-width: 36px;"
						aria-label="Move down"
					>
						<ChevronDown size={18} />
					</button>
				</div>
			{/if}

			<div class="flex flex-col gap-4">
				<div>
					<label for="edit-name" class="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Name</label>
					<input
						id="edit-name"
						type="text"
						bind:value={editName}
						placeholder="Product name"
						class="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-base text-[var(--color-text)] outline-none"
						onkeydown={(e) => { if (e.key === 'Enter') saveProductEdit(); }}
					/>
				</div>

				<div>
					<label for="edit-section" class="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Section</label>
					{#if addingNewSection}
						<div class="flex gap-2">
							<input
								type="text"
								bind:value={newSectionName}
								placeholder="Section name"
								class="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-base text-[var(--color-text)] outline-none"
								onkeydown={(e) => { if (e.key === 'Enter') createNewSection(); }}
							/>
							<button onclick={createNewSection} class="rounded-xl bg-[var(--color-primary)] px-4 py-3 text-sm font-medium text-white" style="min-width: auto;">Add</button>
						</div>
					{:else}
						<select
							id="edit-section"
							value={editSectionId}
							onchange={handleSectionChange}
							class="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-base text-[var(--color-text)] outline-none"
						>
							<option value="">None</option>
							{#each allSections as section (section.id)}
								<option value={section.id}>{section.name}</option>
							{/each}
							<option value="__new__">+ New section</option>
						</select>
					{/if}
				</div>

				<div>
					<label for="edit-store" class="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Default store</label>
					{#if addingNewStore}
						<div class="flex gap-2">
							<input
								type="text"
								bind:value={newStoreName}
								placeholder="Store name"
								class="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-base text-[var(--color-text)] outline-none"
								onkeydown={(e) => { if (e.key === 'Enter') createNewStore(); }}
							/>
							<button onclick={createNewStore} class="rounded-xl bg-[var(--color-primary)] px-4 py-3 text-sm font-medium text-white" style="min-width: auto;">Add</button>
						</div>
					{:else}
						<select
							id="edit-store"
							value={editStoreId}
							onchange={handleStoreChange}
							class="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-base text-[var(--color-text)] outline-none"
						>
							<option value="">None</option>
							{#each allStores as store (store.id)}
								<option value={store.id}>{store.name}</option>
							{/each}
							<option value="__new__">+ New store</option>
						</select>
					{/if}
				</div>

				<div class="flex gap-3 pt-1">
					<button
						onclick={closeEditSheet}
						class="flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-3 text-sm font-medium text-[var(--color-text)] active:bg-[var(--color-bg)]"
					>Cancel</button>
					<button
						onclick={saveProductEdit}
						class="flex-1 rounded-xl bg-[var(--color-primary)] py-3 text-sm font-medium text-white active:brightness-90"
					>Save</button>
				</div>
			</div>
		</div>
	</div>
{/if}
