<script lang="ts">
	import { onMount } from 'svelte';
	import { Search, X, ChevronUp, ChevronDown, ChevronRight, Plus, Archive, Pencil } from '@lucide/svelte';
	import { fly, fade } from 'svelte/transition';
	import { listStore } from '$lib/stores/list.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { preferencesStore } from '$lib/stores/preferences.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import { db } from '$lib/db/database';
	import { getActiveEntities, createList, updateProduct, updateList, createSection, createStore } from '$lib/db/operations';
	import { compareSortKeys, sortKeyBetween, sortKeyAfter } from '$lib/utils/ordering';
	import type { Product, Section, Store, List } from '$lib/types';

	uiStore.setHeaderTitle('');
	uiStore.setShowBackButton(false);

	// List management
	let showListSheet = $state(false);
	let allLists = $state<List[]>([]);

	let allProducts = $state<Product[]>([]);
	let allSections = $state<Section[]>([]);
	let searchQuery = $state('');
	let collapsedSections = $state<Set<string | null>>(new Set());

	const sectionsArray = $derived(Array.from(listStore.sections.values()));

	// Set of product IDs currently on the active list
	const onListProductIds = $derived(new Set(listStore.items.map(i => i.product_id)));

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

		// Sort sections by sort_order
		const sectionOrder = new Map(allSections.map(s => [s.id, s.sort_order]));
		const sortedKeys = [...sectionMap.keys()].sort((a, b) => {
			const orderA = a ? (sectionOrder.get(a) ?? 999) : 999;
			const orderB = b ? (sectionOrder.get(b) ?? 999) : 999;
			return orderA - orderB;
		});

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
				sort_order: 0,
				started_at: new Date().toISOString(),
				archived_at: null
			});
			listStore.activeList = list;
			await listStore.loadListData(list.id);
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
	}

	async function switchToList(list: List) {
		listStore.activeList = list;
		await listStore.loadListData(list.id);
		closeListSheet();
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
			sort_order: 0,
			started_at: new Date().toISOString(),
			archived_at: null
		});

		listStore.activeList = list;
		await listStore.loadListData(list.id);
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
			sort_order: 0,
			started_at: new Date().toISOString(),
			archived_at: null
		});

		listStore.activeList = list;
		await listStore.loadListData(list.id);
		closeListSheet();
	}

	onMount(async () => {
		await listStore.loadActiveList();
		await ensureActiveList();
		await loadProducts();
	});

	// Reload products when sync brings new data
	import { syncStateStore } from '$lib/sync/state.svelte';
	let lastDataVersion = 0;
	$effect(() => {
		const version = syncStateStore.dataVersion;
		if (version > lastDataVersion) {
			lastDataVersion = version;
			loadProducts();
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

	async function addNewProduct() {
		const name = searchQuery.trim();
		if (!name) return;

		// Generate a sort key after the last product (appends to end)
		const lastKey = allProducts.length > 0
			? allProducts.sort((a, b) => compareSortKeys(a.sort_order, b.sort_order)).at(-1)?.sort_order
			: null;
		const newSortKey = sortKeyAfter(typeof lastKey === 'string' ? lastKey : null);

		// Create product with sort key and add to list
		await listStore.addNewProductAndItem(name, null, null);

		// Update the product's sort_order (addNewProductAndItem uses items.length as sort_order)
		const product = (await getActiveEntities<Product>('products')).find(p => p.name.toLowerCase() === name.toLowerCase());
		if (product) {
			await updateProduct(product.id, { sort_order: newSortKey });
		}

		searchQuery = '';
		await loadProducts();

		// Immediately open the edit sheet for the new product
		const newProduct = allProducts.find(p => p.name.toLowerCase() === name.toLowerCase());
		if (newProduct) {
			openEditSheet(newProduct);
		}
	}

	function clearSearch() {
		searchQuery = '';
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
	let editSectionId = $state<string>('');
	let editStoreId = $state<string>('');
	let addingNewSection = $state(false);
	let addingNewStore = $state(false);
	let newSectionName = $state('');
	let newStoreName = $state('');

	async function openEditSheet(product: Product) {
		allStores = await getActiveEntities<Store>('stores');
		editingProduct = product;
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
		const section = await createSection({
			list_id: null,
			name,
			sort_order: sortKeyAfter(allSections.length > 0 ? allSections[allSections.length - 1].sort_order : null),
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
		const store = await createStore({
			name,
			sort_order: sortKeyAfter(allStores.length > 0 ? allStores[allStores.length - 1].sort_order : null),
			active: true
		});
		allStores = [...allStores, store];
		editStoreId = store.id;
		addingNewStore = false;
		newStoreName = '';
	}

	async function saveProductEdit() {
		if (!editingProduct) return;
		const newSectionId = editSectionId || null;
		const newStoreId = editStoreId || null;

		// If section changed, generate a sort key for the end of the new section
		let newSortOrder = editingProduct.sort_order;
		if (newSectionId !== (editingProduct.default_section_id || null)) {
			const productsInNewSection = allProducts
				.filter(p => (p.default_section_id || null) === newSectionId && p.id !== editingProduct!.id)
				.sort((a, b) => compareSortKeys(a.sort_order, b.sort_order));
			const lastKey = productsInNewSection.length > 0
				? productsInNewSection[productsInNewSection.length - 1].sort_order
				: null;
			newSortOrder = sortKeyAfter(lastKey);
		}

		// Update the product defaults
		await updateProduct(editingProduct.id, {
			default_section_id: newSectionId,
			default_store_id: newStoreId,
			sort_order: newSortOrder
		});

		// Also update any existing ListItem for this product on the active list
		const { updateListItem } = await import('$lib/db/operations');
		const listItem = listStore.items.find(i => i.product_id === editingProduct!.id);
		if (listItem) {
			await updateListItem(listItem.id, {
				section_id: newSectionId,
				store_id: newStoreId,
				sort_order: newSortOrder
			});
			await listStore.loadActiveList();
		}

		await loadProducts();
		closeEditSheet();
	}

	// Reordering within section
	function getProductPositionInSection(): { index: number; total: number; siblings: Product[] } {
		if (!editingProduct) return { index: -1, total: 0, siblings: [] };
		const sectionId = editingProduct.default_section_id || null;
		const siblings = allProducts
			.filter(p => (p.default_section_id || null) === sectionId)
			.sort((a, b) => compareSortKeys(a.sort_order, b.sort_order));
		const index = siblings.findIndex(p => p.id === editingProduct!.id);
		return { index, total: siblings.length, siblings };
	}

	async function moveProductUp() {
		if (!editingProduct) return;
		const { index, siblings } = getProductPositionInSection();
		if (index <= 0) return;

		// Generate a key between the item two above and the item above
		const keyAboveAbove = index >= 2 ? siblings[index - 2].sort_order as any : null;
		const keyAbove = siblings[index - 1].sort_order as any;
		const newKey = sortKeyBetween(keyAboveAbove, keyAbove);

		await updateProduct(editingProduct.id, { sort_order: newKey });

		// Update ListItem sort_order too
		const { updateListItem } = await import('$lib/db/operations');
		const myListItem = listStore.items.find(i => i.product_id === editingProduct!.id);
		if (myListItem) await updateListItem(myListItem.id, { sort_order: newKey });

		await loadProducts();
		await listStore.loadActiveList();
	}

	async function moveProductDown() {
		if (!editingProduct) return;
		const { index, siblings } = getProductPositionInSection();
		if (index >= siblings.length - 1) return;

		// Generate a key between the item below and the item two below
		const keyBelow = siblings[index + 1].sort_order as any;
		const keyBelowBelow = index + 2 < siblings.length ? siblings[index + 2].sort_order as any : null;
		const newKey = sortKeyBetween(keyBelow, keyBelowBelow);

		await updateProduct(editingProduct.id, { sort_order: newKey });

		// Update ListItem sort_order too
		const { updateListItem } = await import('$lib/db/operations');
		const myListItem = listStore.items.find(i => i.product_id === editingProduct!.id);
		if (myListItem) await updateListItem(myListItem.id, { sort_order: newKey });

		await loadProducts();
		await listStore.loadActiveList();
	}
</script>

<div class="flex min-h-full flex-col">
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
		<div class="px-4 pb-2">
			<div class="flex items-center gap-2 rounded-2xl bg-[var(--color-surface)] px-4 py-3 shadow-sm ring-1 ring-[var(--color-border)]">
				<Search size={18} class="shrink-0 text-[var(--color-text-secondary)]" />
				<input
					type="text"
					placeholder="Search or add items..."
					bind:value={searchQuery}
					class="flex-1 bg-transparent text-base text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-secondary)]/60"
				/>
				{#if searchQuery}
					<button
						onclick={clearSearch}
						class="flex shrink-0 items-center justify-center rounded-full p-1 text-[var(--color-text-secondary)] active:bg-[var(--color-border)]"
						aria-label="Clear search"
					>
						<X size={16} />
					</button>
				{/if}
			</div>
		</div>

		<!-- Product catalog -->
		<div class="flex flex-col px-4 pb-24 pt-1">
			<!-- List summary -->
			{#if listStore.items.length > 0}
				<div class="mb-2 text-xs text-[var(--color-text-secondary)]">
					{listStore.items.length} item{listStore.items.length !== 1 ? 's' : ''} on list
				</div>
			{/if}

			<!-- "New" item row when search doesn't match -->
			{#if isNewProduct && searchQuery.trim()}
				<button
					onclick={addNewProduct}
					class="mb-3 flex w-full items-center gap-3 rounded-xl border border-dashed border-[var(--color-primary)] bg-[var(--color-primary)]/5 px-4 py-3 text-left active:bg-[var(--color-primary)]/10"
				>
					<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary)] text-white" style="min-height: auto; min-width: auto;">
						<span class="text-xs font-bold">+</span>
					</div>
					<div class="flex-1">
						<span class="text-sm font-medium text-[var(--color-text)]">{searchQuery.trim()}</span>
						<span class="ml-2 rounded bg-[var(--color-primary)]/10 px-1.5 py-0.5 text-xs font-medium text-[var(--color-accent)]">New</span>
					</div>
				</button>
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
							<div class="flex items-center gap-1 rounded-lg transition-colors active:bg-[var(--color-surface)]">
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
					<button
						onclick={() => switchToList(list)}
						class="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left {isCurrent ? 'bg-[var(--color-primary)]/10' : 'active:bg-[var(--color-surface)]'}"
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
