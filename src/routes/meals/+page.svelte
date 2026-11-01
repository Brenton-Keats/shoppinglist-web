<script lang="ts">
	import { onMount } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { Plus, Pencil, Trash2, X, Check, ChevronRight, Search, UtensilsCrossed } from '@lucide/svelte';
	import { mealStore } from '$lib/stores/meal.svelte';
	import { listStore } from '$lib/stores/list.svelte';
	import { uiStore } from '$lib/stores/ui.svelte';
	import { syncStateStore } from '$lib/sync/state.svelte';
	import LoadingSpinner from '$lib/components/LoadingSpinner.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import QuantityControl from '$lib/components/QuantityControl.svelte';
	import type { Meal } from '$lib/types';

	uiStore.setHeaderTitle('Meals');
	uiStore.setShowBackButton(false);

	// Add-meal input
	let newMealName = $state('');

	// Expanded meal (only one open at a time for a clean mobile view)
	let expandedMealId = $state<string | null>(null);

	// Inline rename
	let editingMealId = $state<string | null>(null);
	let editMealName = $state('');

	// Delete confirmation (mirrors the app's confirm-before-destroy pattern)
	let confirmDeleteId = $state<string | null>(null);

	// Product picker sheet (per meal)
	let pickerMealId = $state<string | null>(null);
	let pickerQuery = $state('');

	const productsArray = $derived(Array.from(mealStore.products.values()));

	// The active list is the "week" meal selection is scoped to. If there is no
	// active list, the per-meal selection toggle is disabled with a hint.
	const activeList = $derived(listStore.activeList);

	onMount(async () => {
		await mealStore.loadMeals();
		// Ensure we know the active list and its current selections.
		if (!listStore.activeList) await listStore.loadActiveList();
		if (listStore.activeList) await mealStore.loadSelections(listStore.activeList.id);
	});

	// Reload when sync brings new data (mirrors the main list page pattern).
	let lastDataVersion = 0;
	$effect(() => {
		const version = syncStateStore.dataVersion;
		if (version > lastDataVersion) {
			lastDataVersion = version;
			mealStore.loadMeals();
			if (expandedMealId) mealStore.loadMealProducts(expandedMealId);
			if (listStore.activeList) mealStore.loadSelections(listStore.activeList.id);
		}
	});

	async function toggleSelection(mealId: string) {
		if (!activeList) return;
		await mealStore.toggleSelection(mealId, activeList.id);
	}

	async function addMeal() {
		const name = newMealName.trim();
		if (!name) return;
		const meal = await mealStore.createMeal(name);
		newMealName = '';
		if (meal) await toggleExpand(meal.id);
	}

	async function toggleExpand(mealId: string) {
		if (expandedMealId === mealId) {
			expandedMealId = null;
			return;
		}
		expandedMealId = mealId;
		await mealStore.loadMealProducts(mealId);
	}

	function startRename(meal: Meal) {
		editingMealId = meal.id;
		editMealName = meal.name;
	}

	function cancelRename() {
		editingMealId = null;
		editMealName = '';
	}

	async function saveRename() {
		if (!editingMealId) return;
		await mealStore.renameMeal(editingMealId, editMealName);
		editingMealId = null;
		editMealName = '';
	}

	function handleRenameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			saveRename();
		} else if (e.key === 'Escape') {
			cancelRename();
		}
	}

	async function confirmDelete() {
		if (!confirmDeleteId) return;
		const id = confirmDeleteId;
		confirmDeleteId = null;
		if (expandedMealId === id) expandedMealId = null;
		await mealStore.deleteMeal(id);
	}

	// Product picker
	async function openPicker(mealId: string) {
		pickerMealId = mealId;
		pickerQuery = '';
		await mealStore.loadMealProducts(mealId);
		uiStore.dialogOpen = true;
	}

	function closePicker() {
		pickerMealId = null;
		pickerQuery = '';
		uiStore.dialogOpen = false;
	}

	// Products not yet in the picker's meal, filtered by the query. Picking an
	// EXISTING product is the Phase-1 scope; creating brand-new products stays on
	// the main List screen (documented scope decision).
	const pickerProducts = $derived.by(() => {
		if (!pickerMealId) return [];
		const inMeal = new Set(
			mealStore.getMealProducts(pickerMealId).map((mp) => mp.product_id)
		);
		const q = pickerQuery.toLowerCase().trim();
		return productsArray
			.filter((p) => !inMeal.has(p.id))
			.filter((p) => !q || p.name.toLowerCase().includes(q))
			.sort((a, b) => a.name.localeCompare(b.name));
	});

	async function pickProduct(productId: string) {
		if (!pickerMealId) return;
		await mealStore.addProductToMeal(pickerMealId, productId);
	}
</script>

<div class="flex min-h-full flex-col" data-testid="meals-page">
	{#if mealStore.loading}
		<div class="flex flex-1 items-center justify-center py-16">
			<LoadingSpinner />
		</div>
	{:else}
		<!-- Add meal -->
		<div class="px-4 pt-3 pb-2">
			<div class="flex items-center gap-2 rounded-2xl bg-[var(--color-surface)] px-4 py-3 shadow-sm ring-1 ring-[var(--color-border)]">
				<input
					type="text"
					placeholder="Add a meal..."
					bind:value={newMealName}
					data-testid="meal-name-input"
					onkeydown={(e) => { if (e.key === 'Enter') addMeal(); }}
					class="flex-1 bg-transparent text-base text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-secondary)]/60"
				/>
				<button
					onclick={addMeal}
					disabled={!newMealName.trim()}
					data-testid="add-meal"
					class="flex shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)] px-3 py-2 text-sm font-medium text-white disabled:opacity-40 active:brightness-90"
					style="min-height: auto; min-width: auto;"
					aria-label="Add meal"
				>
					<Plus size={16} />
				</button>
			</div>
		</div>

		<div class="flex flex-col px-4 pb-24 pt-1">
			{#if mealStore.meals.length === 0}
				<EmptyState
					icon={UtensilsCrossed}
					title="No meals yet"
					description="Add a meal above, then add the products it needs."
				/>
			{:else}
				{#each mealStore.meals as meal (meal.id)}
					{@const isExpanded = expandedMealId === meal.id}
					{@const mealProducts = mealStore.getMealProducts(meal.id)}
					<div
						class="mt-3 overflow-hidden rounded-xl bg-[var(--color-surface)] ring-1 ring-[var(--color-border)] first:mt-0"
						data-testid="meal-row"
						data-meal-name={meal.name}
					>
						{#if editingMealId === meal.id}
							<div class="flex w-full items-center gap-2 px-3 py-3">
								<!-- svelte-ignore a11y_autofocus -->
								<input
									bind:value={editMealName}
									onkeydown={handleRenameKeydown}
									autofocus
									aria-label="Meal name"
									data-testid="meal-rename-input"
									class="flex-1 rounded-md bg-[var(--color-bg)] px-2 py-1.5 text-sm text-[var(--color-text)] outline-none ring-1 ring-[var(--color-border)] focus:ring-[var(--color-accent)]"
								/>
								<button
									onclick={saveRename}
									class="rounded-md p-1.5 text-[var(--color-success)] active:bg-[var(--color-bg)]"
									aria-label="Save"
									data-testid="meal-rename-save"
								>
									<Check size={16} />
								</button>
								<button
									onclick={cancelRename}
									class="rounded-md p-1.5 text-[var(--color-text-secondary)] active:bg-[var(--color-bg)]"
									aria-label="Cancel"
								>
									<X size={16} />
								</button>
							</div>
						{:else}
							{@const isSelected = mealStore.isSelected(meal.id)}
							<div class="flex w-full items-center gap-1">
								<button
									onclick={() => toggleExpand(meal.id)}
									class="flex flex-1 min-w-0 items-center gap-2 px-3 py-3 text-left"
									data-testid="meal-toggle"
									aria-expanded={isExpanded}
								>
									<ChevronRight
										size={16}
										class="shrink-0 text-[var(--color-text-secondary)] transition-transform {isExpanded ? 'rotate-90' : ''}"
									/>
									<span class="flex-1 truncate text-sm font-medium text-[var(--color-text)]">{meal.name}</span>
									{#if mealProducts.length > 0}
										<span class="text-xs font-medium text-[var(--color-accent)]">{mealProducts.length}</span>
									{/if}
								</button>
								<button
									onclick={() => toggleSelection(meal.id)}
									disabled={!activeList}
									data-testid="meal-select-toggle"
									data-selected={isSelected ? 'true' : 'false'}
									aria-pressed={isSelected}
									title={activeList
										? isSelected
											? 'Selected for this list'
											: 'Add to this list'
										: 'No active list to add to'}
									class="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 {isSelected
										? 'bg-[var(--color-primary)] text-white active:brightness-90'
										: 'bg-[var(--color-bg)] text-[var(--color-text-secondary)] ring-1 ring-[var(--color-border)] active:bg-[var(--color-border)]'}"
									style="min-height: 36px;"
									aria-label={isSelected ? `Remove ${meal.name} from this list` : `Add ${meal.name} to this list`}
								>
									{#if isSelected}
										<Check size={14} />
										<span>Selected</span>
									{:else}
										<Plus size={14} />
										<span>Add</span>
									{/if}
								</button>
								<button
									onclick={() => startRename(meal)}
									class="flex shrink-0 items-center justify-center rounded-full p-2 text-[var(--color-text-secondary)] active:bg-[var(--color-border)]"
									style="min-height: 36px; min-width: 36px;"
									aria-label={`Rename ${meal.name}`}
									data-testid="meal-rename"
								>
									<Pencil size={14} />
								</button>
								<button
									onclick={() => (confirmDeleteId = meal.id)}
									class="flex shrink-0 items-center justify-center rounded-full p-2 text-[var(--color-text-secondary)] active:bg-[var(--color-border)]"
									style="min-height: 36px; min-width: 36px;"
									aria-label={`Delete ${meal.name}`}
									data-testid="meal-delete"
								>
									<Trash2 size={14} />
								</button>
							</div>
						{/if}

						{#if isExpanded}
							<div class="border-t border-[var(--color-border)] px-3 py-2" data-testid="meal-products">
								{#if mealProducts.length === 0}
									<p class="py-2 text-sm text-[var(--color-text-secondary)]">
										No products yet. Add one below.
									</p>
								{:else}
									{#each mealProducts as mp (mp.id)}
										<div
											class="flex items-center gap-1 py-1.5"
											data-testid="meal-product-row"
											data-product-name={mealStore.getProductName(mp)}
										>
											<span class="flex-1 truncate text-sm text-[var(--color-text)]">
												{mealStore.getProductName(mp)}
											</span>
											<QuantityControl
												quantity={mp.quantity}
												onAdjust={(delta) => mealStore.adjustMealProductQuantity(mp.id, delta)}
												label={mealStore.getProductName(mp)}
											/>
											<button
												onclick={() => mealStore.removeProductFromMeal(mp.id)}
												class="flex shrink-0 items-center justify-center rounded-full p-2 text-[var(--color-text-secondary)] active:bg-[var(--color-border)]"
												style="min-height: 36px; min-width: 36px;"
												aria-label={`Remove ${mealStore.getProductName(mp)}`}
												data-testid="meal-product-remove"
											>
												<X size={16} />
											</button>
										</div>
									{/each}
								{/if}
								<button
									onclick={() => openPicker(meal.id)}
									data-testid="meal-add-product"
									class="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-[var(--color-primary)] bg-[var(--color-primary)]/5 px-3 py-2.5 text-left text-sm font-medium text-[var(--color-accent)] active:bg-[var(--color-primary)]/10"
								>
									<Plus size={16} />
									Add product
								</button>
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<!-- Delete confirmation -->
{#if confirmDeleteId}
	{@const meal = mealStore.meals.find((m) => m.id === confirmDeleteId)}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="fixed inset-0 z-[70] flex items-center justify-center p-6"
		role="dialog"
		aria-modal="true"
		onkeydown={(e) => { if (e.key === 'Escape') (confirmDeleteId = null); }}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="absolute inset-0 bg-black/50" onclick={() => (confirmDeleteId = null)} transition:fade={{ duration: 150 }}></div>
		<div
			class="relative w-full max-w-sm rounded-2xl bg-[var(--color-bg)] p-5 shadow-xl"
			transition:fly={{ y: 20, duration: 200 }}
		>
			<h2 class="mb-1 text-lg font-semibold text-[var(--color-text)]">Delete meal?</h2>
			<p class="mb-4 text-sm text-[var(--color-text-secondary)]">
				"{meal?.name}" and its products will be removed. This can be undone by re-adding the meal.
			</p>
			<div class="flex justify-end gap-2">
				<button
					onclick={() => (confirmDeleteId = null)}
					class="rounded-xl bg-[var(--color-surface)] px-4 py-2.5 text-sm font-medium text-[var(--color-text)] ring-1 ring-[var(--color-border)] active:bg-[var(--color-bg)]"
				>
					Cancel
				</button>
				<button
					onclick={confirmDelete}
					data-testid="meal-delete-confirm"
					class="rounded-xl bg-[var(--color-error)] px-4 py-2.5 text-sm font-medium text-white active:brightness-90"
				>
					Delete
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Product picker bottom sheet -->
{#if pickerMealId}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="fixed inset-0 z-[60] flex items-end"
		role="dialog"
		aria-modal="true"
		onkeydown={(e) => { if (e.key === 'Escape') closePicker(); }}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="absolute inset-0 bg-black/50" onclick={closePicker} transition:fade={{ duration: 200 }}></div>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="relative w-full rounded-t-3xl bg-[var(--color-bg)] px-5 pt-3 pb-6"
			style="padding-bottom: calc(1.5rem + env(safe-area-inset-bottom, 0px)); max-height: 70vh;"
			onclick={(e) => e.stopPropagation()}
			transition:fly={{ y: 300, duration: 250 }}
		>
			<div class="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--color-border)]"></div>

			<div class="mb-3 flex items-center justify-between">
				<h2 class="text-lg font-semibold text-[var(--color-text)]">Add product</h2>
				<button
					onclick={closePicker}
					class="rounded-full p-1.5 text-[var(--color-text-secondary)] active:bg-[var(--color-surface)]"
					aria-label="Close"
				>
					<X size={18} />
				</button>
			</div>

			<div class="mb-3 flex items-center gap-2 rounded-2xl bg-[var(--color-surface)] px-4 py-3 ring-1 ring-[var(--color-border)]">
				<Search size={18} class="shrink-0 text-[var(--color-text-secondary)]" />
				<input
					type="text"
					placeholder="Search products..."
					bind:value={pickerQuery}
					data-testid="meal-product-search"
					class="flex-1 bg-transparent text-base text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-secondary)]/60"
				/>
			</div>

			<div class="overflow-y-auto" style="max-height: 45vh;">
				{#if pickerProducts.length === 0}
					<p class="py-6 text-center text-sm text-[var(--color-text-secondary)]">
						{productsArray.length === 0
							? 'No products yet. Add products from the List screen first.'
							: 'No matching products.'}
					</p>
				{:else}
					{#each pickerProducts as product (product.id)}
						<button
							onclick={() => pickProduct(product.id)}
							data-testid="meal-product-option"
							data-product-name={product.name}
							class="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left active:bg-[var(--color-surface)]"
						>
							<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--color-primary)] text-white" style="min-height: auto; min-width: auto;">
								<Plus size={14} />
							</div>
							<span class="flex-1 truncate text-sm text-[var(--color-text)]">{product.name}</span>
						</button>
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}
