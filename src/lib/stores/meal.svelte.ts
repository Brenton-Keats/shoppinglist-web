import type { Meal, MealProduct, MealSelection, Product } from '$lib/types';
import { db } from '$lib/db/database';
import {
	createMealAtEnd,
	createMealProduct,
	createMealSelection,
	updateMeal,
	updateMealProduct,
	updateMealSelection,
	softDeleteMeal,
	softDeleteMealProduct,
	softDeleteMealSelection,
	getActiveEntities
} from '$lib/db/operations';
import { compareSortKeys } from '$lib/utils/ordering';
import { adjustQuantity, clampQuantity, effectiveQuantity } from '$lib/utils/quantity';
import { isSoftDeleted } from '$lib/db/utils';
import { computeSuggested, type SuggestedProduct } from '$lib/meals/suggested';
import { syncStore } from './sync.svelte';
import { toastStore } from './toast.svelte';

/**
 * DEFAULTS-ON-READ for the two independent Meal flags (assessment §1.7, task
 * "Set defaults for existing rows"). Legacy Meal rows written before this
 * feature have no `is_usual` / `in_meal_plan` field. Rather than run a data
 * migration, we coerce missing values at READ time into the canonical defaults:
 *   - `is_usual`      missing → false (not a usual)
 *   - `in_meal_plan`  missing → true  (a normal planned meal)
 * The two are coerced INDEPENDENTLY — a missing field for one never derives
 * from the other. New meals are created with explicit values (see createMeal),
 * so this only ever fills in genuinely-absent legacy fields.
 */
export function normalizeMeal(meal: Meal): Meal {
	const is_usual = meal.is_usual === true; // missing/undefined/false → false
	const in_meal_plan = meal.in_meal_plan !== false; // missing/undefined/true → true
	if (meal.is_usual === is_usual && meal.in_meal_plan === in_meal_plan) return meal;
	return { ...meal, is_usual, in_meal_plan };
}

/**
 * Store for the Phase-1 Meals management screen. Mirrors ListStore patterns:
 * Svelte 5 runes ($state), reactive arrays/maps, immutable updates, and a
 * pending-sync-count refresh through syncStore after every write (matching how
 * list.svelte.ts keeps the sync badge current).
 *
 * Scope decisions (Phase 1):
 *  - deleteMeal CASCADES: it soft-deletes the meal AND its MealProducts. This
 *    mirrors how the app treats dependent rows and keeps mealProducts free of
 *    orphan rows pointing at a deleted meal. (The alternative — leaving orphans
 *    to be filtered out — was rejected as less clean.)
 *  - addProductToMeal DEDUPES: if the product is already an active member of the
 *    meal it is a NO-OP (the user adjusts the existing row's quantity instead of
 *    creating a second row). name_snapshot is captured from the product's
 *    current name at add time, so a later product rename/delete can't break the
 *    meal display (mirrors ListItem.name_snapshot).
 *  - Quantity uses the SAME clamp/floor helpers as list items (quantity.ts):
 *    integer, floored at 1.
 */
class MealStore {
	meals = $state<Meal[]>([]);
	/** MealProducts for the currently-loaded meal, keyed by meal id. */
	mealProducts = $state<Map<string, MealProduct[]>>(new Map());
	/** All active products, for the add-product picker and name snapshots. */
	products = $state<Map<string, Product>>(new Map());
	loading = $state(false);

	/**
	 * Active MealSelections for the CURRENTLY-LOADED list, keyed by meal_id (one
	 * active selection per meal per list). `selectionListId` records which list
	 * these selections were loaded for, so the selection UI only reflects the
	 * active list and we don't mix selections across lists.
	 */
	selections = $state<Map<string, MealSelection>>(new Map());
	selectionListId = $state<string | null>(null);

	get mealCount() {
		return this.meals.length;
	}

	/** Is meal X currently selected for the loaded list? */
	isSelected(mealId: string): boolean {
		return this.selections.has(mealId);
	}

	/**
	 * The meals currently selected for the loaded list, resolved to the live
	 * Meal rows (so the name reflects any rename). Derived from the reactive
	 * `selections` map + `meals` list, so it recomputes automatically when a meal
	 * is selected/deselected — this feeds the Phase-3 "Meal Plan" section. A
	 * selected meal whose Meal row isn't loaded is skipped (defensive; it would
	 * reappear once meals load).
	 */
	get selectedMeals(): Meal[] {
		return this.meals.filter((m) => this.selections.has(m.id));
	}

	/**
	 * The meals shown in the "Meal Plan" section: the selected meals, FILTERED to
	 * those with `in_meal_plan === true`. This is a PURE DISPLAY FILTER for the
	 * Meal Plan list only — it does NOT affect Suggested contributions (those come
	 * from the MealSelection rows via `computeSuggestedForList`, which is
	 * unchanged). A selected meal with `in_meal_plan=false` still contributes to
	 * Suggested; it is simply hidden here.
	 *
	 * The filter keys PURELY on `in_meal_plan` — `is_usual` is never special-cased
	 * here. Usuals typically have `in_meal_plan=false` and so won't appear, but
	 * only because the user set that flag, not because they are usual.
	 */
	get mealPlanMeals(): Meal[] {
		return this.selectedMeals.filter((m) => m.in_meal_plan);
	}

	private async refreshPending(): Promise<void> {
		await syncStore.refreshPendingCount();
	}

	/** Load all active meals (sorted by sort_order) and the active product catalogue. */
	async loadMeals(): Promise<void> {
		this.loading = true;
		try {
			const [meals, allProducts] = await Promise.all([
				getActiveEntities<Meal>('meals'),
				getActiveEntities<Product>('products')
			]);
			this.meals = meals
				.map(normalizeMeal)
				.sort((a, b) => compareSortKeys(a.sort_order, b.sort_order));
			this.products = new Map(allProducts.map((p) => [p.id, p]));
		} finally {
			this.loading = false;
		}
	}

	/** Load (and cache) the active MealProducts for a given meal. */
	async loadMealProducts(mealId: string): Promise<void> {
		const rows = await db.mealProducts
			.where('meal_id')
			.equals(mealId)
			.and((mp) => !mp.deleted_at)
			.toArray();
		this.mealProducts = new Map(this.mealProducts).set(mealId, rows);
	}

	/** The cached (active) MealProducts for a meal, or an empty array. */
	getMealProducts(mealId: string): MealProduct[] {
		return this.mealProducts.get(mealId) ?? [];
	}

	async createMeal(name: string): Promise<Meal | undefined> {
		const trimmed = name.trim();
		if (!trimmed) {
			toastStore.error('Meal name cannot be empty.');
			return undefined;
		}
		// New meals default to a normal planned meal: NOT a usual, DOES appear in
		// the Meal Plan. The two flags are set independently and explicitly here.
		const meal = await createMealAtEnd({
			name: trimmed,
			active: true,
			is_usual: false,
			in_meal_plan: true
		});
		this.meals = [...this.meals, meal];
		await this.refreshPending();
		return meal;
	}

	async renameMeal(id: string, name: string): Promise<void> {
		const trimmed = name.trim();
		if (!trimmed) {
			toastStore.error('Meal name cannot be empty.');
			return;
		}
		await updateMeal(id, { name: trimmed });
		this.meals = this.meals.map((m) => (m.id === id ? { ...m, name: trimmed } : m));
		await this.refreshPending();
	}

	/**
	 * Set a meal's `is_usual` flag. Writes ONLY `is_usual` (plus the auto-select
	 * side effect below). It MUST NOT read or write `in_meal_plan` — the two flags
	 * are fully independent (the common pairing is the user's choice, never
	 * implied by code).
	 *
	 * Side effect of turning a meal INTO a usual: ensure it is selected for the
	 * active list so it behaves as a usual immediately (it becomes a real
	 * selection, defaulted on, still opt-out-able per list). This mirrors the
	 * new-list auto-select and only ADDS a selection; it never touches
	 * `in_meal_plan`. Turning `is_usual` OFF does NOT deselect — a deliberate
	 * selection is the user's to remove.
	 */
	async setUsual(id: string, isUsual: boolean, activeListId?: string | null): Promise<void> {
		await updateMeal(id, { is_usual: isUsual });
		this.meals = this.meals.map((m) => (m.id === id ? { ...m, is_usual: isUsual } : m));
		if (isUsual && activeListId) {
			await this.selectMeal(id, activeListId);
		}
		await this.refreshPending();
	}

	/**
	 * Set a meal's `in_meal_plan` flag. Writes ONLY `in_meal_plan`. It MUST NOT
	 * read or write `is_usual` — the two flags are fully independent. This is a
	 * pure display filter for the Meal Plan section and has no effect on Suggested
	 * contributions.
	 */
	async setInMealPlan(id: string, inMealPlan: boolean): Promise<void> {
		await updateMeal(id, { in_meal_plan: inMealPlan });
		this.meals = this.meals.map((m) => (m.id === id ? { ...m, in_meal_plan: inMealPlan } : m));
		await this.refreshPending();
	}

	/**
	 * Soft-delete a meal AND cascade-soft-delete its (active) MealProducts, so no
	 * orphan membership rows linger pointing at a deleted meal.
	 */
	async deleteMeal(id: string): Promise<void> {
		const rows = this.mealProducts.get(id) ?? (await this.loadMealProductsInternal(id));
		await softDeleteMeal(id);
		for (const mp of rows) {
			await softDeleteMealProduct(mp.id);
		}
		this.meals = this.meals.filter((m) => m.id !== id);
		const next = new Map(this.mealProducts);
		next.delete(id);
		this.mealProducts = next;
		await this.refreshPending();
	}

	private async loadMealProductsInternal(mealId: string): Promise<MealProduct[]> {
		return db.mealProducts
			.where('meal_id')
			.equals(mealId)
			.and((mp) => !mp.deleted_at)
			.toArray();
	}

	/**
	 * Add a product to a meal with an integer quantity (default 1). Captures
	 * name_snapshot from the product's current name. If the product is already an
	 * active member of the meal, this is a NO-OP (returns the existing row) — the
	 * user adjusts its quantity instead of creating a duplicate.
	 */
	async addProductToMeal(
		mealId: string,
		productId: string,
		quantity = 1
	): Promise<MealProduct | undefined> {
		const existing = this.getMealProducts(mealId).find((mp) => mp.product_id === productId);
		if (existing) return existing; // dedupe: no second row

		const product = this.products.get(productId) ?? (await db.products.get(productId));
		if (!product) {
			toastStore.error('Product not found.');
			return undefined;
		}

		const mealProduct = await createMealProduct({
			meal_id: mealId,
			product_id: productId,
			name_snapshot: product.name,
			quantity: clampQuantity(quantity)
		});

		const rows = [...this.getMealProducts(mealId), mealProduct];
		this.mealProducts = new Map(this.mealProducts).set(mealId, rows);
		await this.refreshPending();
		return mealProduct;
	}

	/**
	 * Set a MealProduct's quantity to an explicit value, clamped to a positive
	 * integer floored at 1 (same logic as list items). No-op if unchanged.
	 */
	async setMealProductQuantity(mealProductId: string, quantity: number): Promise<void> {
		const entry = this.findMealProduct(mealProductId);
		if (!entry) return;
		const { mealId, mp } = entry;

		const next = clampQuantity(quantity);
		if (next === effectiveQuantity(mp.quantity)) return;

		try {
			await updateMealProduct(mealProductId, { quantity: next });
			this.updateLocalMealProduct(mealId, mealProductId, { quantity: next });
			await this.refreshPending();
		} catch (err) {
			console.error('Failed to set meal product quantity:', err);
			toastStore.error('Could not update quantity. Please try again.');
		}
	}

	/**
	 * Adjust a MealProduct's quantity by a delta (+1 / -1), treating the stored
	 * value as >=1 and flooring the result at 1. Decrementing at 1 is a no-op.
	 */
	async adjustMealProductQuantity(mealProductId: string, delta: number): Promise<void> {
		const entry = this.findMealProduct(mealProductId);
		if (!entry) return;
		await this.setMealProductQuantity(mealProductId, adjustQuantity(entry.mp.quantity, delta));
	}

	async removeProductFromMeal(mealProductId: string): Promise<void> {
		const entry = this.findMealProduct(mealProductId);
		if (!entry) return;
		const { mealId } = entry;

		await softDeleteMealProduct(mealProductId);
		const rows = this.getMealProducts(mealId).filter((mp) => mp.id !== mealProductId);
		this.mealProducts = new Map(this.mealProducts).set(mealId, rows);
		await this.refreshPending();
	}

	/** Locate a MealProduct (and its meal id) across the cached map. */
	private findMealProduct(
		mealProductId: string
	): { mealId: string; mp: MealProduct } | undefined {
		for (const [mealId, rows] of this.mealProducts) {
			const mp = rows.find((r) => r.id === mealProductId);
			if (mp) return { mealId, mp };
		}
		return undefined;
	}

	private updateLocalMealProduct(
		mealId: string,
		mealProductId: string,
		updates: Partial<MealProduct>
	): void {
		const rows = this.getMealProducts(mealId).map((mp) =>
			mp.id === mealProductId ? { ...mp, ...updates } : mp
		);
		this.mealProducts = new Map(this.mealProducts).set(mealId, rows);
	}

	// ---------------------------------------------------------------------------
	// Meal SELECTION (Phase 2): a meal is "selected for a list" via a MealSelection
	// row (meal_id + list_id). Selection is scoped to the active List ("a week ==
	// a list"), so the suggested list resets naturally per list and archived lists
	// keep their selections (we never delete selections on archive).
	//
	// UN-DELETE DECISION: when a user re-selects a meal whose selection was
	// previously soft-deleted, we UN-DELETE the existing row (clear deleted_at via
	// updateMealSelection) rather than create a fresh row. Rationale:
	//   - It keeps a STABLE id for the (meal, list) pair, so sync history stays
	//     coherent and we never accumulate multiple tombstoned rows for the same
	//     pair.
	//   - It plays correctly with recordChange's coalescing: a delete followed by
	//     this un-delete merges into a single clean "update" (or, for a row that
	//     only ever existed locally, the create+delete already cancelled, so the
	//     row is physically gone and we fall through to createMealSelection).
	// We only un-delete a row that still PHYSICALLY exists; if coalescing already
	// removed it, there is nothing to revive and we create cleanly.
	// ---------------------------------------------------------------------------

	/**
	 * Load the active MealSelections for a list into `selections` (keyed by
	 * meal_id) and record `selectionListId`. Non-deleted rows only.
	 */
	async loadSelections(listId: string): Promise<void> {
		const rows = await db.mealSelections
			.where('list_id')
			.equals(listId)
			.and((s) => !s.deleted_at)
			.toArray();
		const map = new Map<string, MealSelection>();
		for (const s of rows) map.set(s.meal_id, s);
		this.selections = map;
		this.selectionListId = listId;
	}

	/**
	 * Select a meal for a list. No-op if an active selection already exists for
	 * (meal, list). If a soft-deleted row exists physically, un-delete it (see the
	 * UN-DELETE DECISION note above); otherwise create a fresh selection.
	 */
	async selectMeal(mealId: string, listId: string): Promise<void> {
		// Already active for this list → nothing to do.
		if (this.selectionListId === listId && this.selections.has(mealId)) return;

		// Look for any physical row for this (meal, list) pair, active or deleted.
		const existing = await db.mealSelections
			.where('meal_id')
			.equals(mealId)
			.and((s) => s.list_id === listId)
			.first();

		let selection: MealSelection;
		if (existing && isSoftDeleted(existing)) {
			// Revive the tombstoned row cleanly (stable id, coalesces to an update).
			selection = await updateMealSelection(existing.id, { deleted_at: null });
		} else if (existing) {
			// Active row exists in DB but wasn't in our in-memory map (e.g. selections
			// for this list weren't loaded yet) — adopt it, no write needed.
			selection = existing;
		} else {
			selection = await createMealSelection({ meal_id: mealId, list_id: listId });
		}

		const next = new Map(this.selections);
		next.set(mealId, selection);
		this.selections = next;
		this.selectionListId = listId;
		await this.refreshPending();
	}

	/**
	 * Deselect a meal for a list: soft-delete the active MealSelection for
	 * (meal, list). No-op if no active selection exists.
	 */
	async deselectMeal(mealId: string, listId: string): Promise<void> {
		const inMap = this.selectionListId === listId ? this.selections.get(mealId) : undefined;
		const row =
			inMap ??
			(await db.mealSelections
				.where('meal_id')
				.equals(mealId)
				.and((s) => s.list_id === listId && !s.deleted_at)
				.first());
		if (!row) return;

		await softDeleteMealSelection(row.id);
		const next = new Map(this.selections);
		next.delete(mealId);
		this.selections = next;
		this.selectionListId = listId;
		await this.refreshPending();
	}

	/** Toggle a meal's selection for a list (select if not selected, else deselect). */
	async toggleSelection(mealId: string, listId: string): Promise<void> {
		if (this.selectionListId === listId && this.selections.has(mealId)) {
			await this.deselectMeal(mealId, listId);
		} else {
			await this.selectMeal(mealId, listId);
		}
	}

	/**
	 * Ensure every active `is_usual` meal has a MealSelection for `listId`. This
	 * implements "auto-select the usuals" — a usual is a genuinely-selected meal,
	 * so its products flow into Suggested with no change to the summation.
	 *
	 * TRIGGER POLICY (critical — "don't resurrect a deliberate skip"): callers
	 * MUST invoke this ONLY at genuine NEW-LIST creation (see +page.svelte
	 * `ensureActiveList` / `createNewList` / `archiveCurrentList`), NOT on every
	 * `loadSelections` of an existing list. Running it on ordinary load would undo
	 * a user's per-list opt-out of a usual.
	 *
	 * Idempotent and safe: it reuses `selectMeal`, which is a no-op when an active
	 * selection already exists and revives a tombstone otherwise. So calling it
	 * twice for the same list adds nothing the second time. It reads `is_usual`
	 * through the defaults-on-read normaliser so legacy rows (missing the field)
	 * are correctly treated as non-usual.
	 */
	async ensureUsualsSelected(listId: string): Promise<void> {
		const meals = (await getActiveEntities<Meal>('meals')).map(normalizeMeal);
		const usuals = meals.filter((m) => m.is_usual);
		if (usuals.length === 0) return;

		// Load ALL this list's selection rows — active AND soft-deleted. A
		// tombstoned row means the user DELIBERATELY opted the usual out for this
		// list; we must NOT revive it (that would resurrect a deliberate skip). So
		// we only create a selection for a usual that has NO physical row at all.
		const existing = await db.mealSelections
			.where('list_id')
			.equals(listId)
			.toArray();
		const seenMealIds = new Set(existing.map((s) => s.meal_id));

		for (const meal of usuals) {
			if (!seenMealIds.has(meal.id)) {
				await this.selectMeal(meal.id, listId);
			}
		}
	}

	/**
	 * Gather the real inputs from Dexie and run the PURE `computeSuggested` to get
	 * the suggested products for a list. This is the thin store-level selector that
	 * keeps the Dexie-gathering OUTSIDE the pure math:
	 *   selected meals → their active MealProducts → flat contributions, and
	 *   the list's active ListItems → the product_ids already on the list.
	 * Phase 2 does NOT render this anywhere (Phase 3 does); it is exposed so the
	 * selector is usable and unit-testable now.
	 */
	async computeSuggestedForList(listId: string): Promise<SuggestedProduct[]> {
		// Active selections for the list.
		const selections = await db.mealSelections
			.where('list_id')
			.equals(listId)
			.and((s) => !s.deleted_at)
			.toArray();
		const selectedMealIds = selections.map((s) => s.meal_id);

		// Flatten the selected meals' active MealProducts into contributions.
		const contributions: { product_id: string; quantity: number }[] = [];
		for (const mealId of selectedMealIds) {
			const mps = await db.mealProducts
				.where('meal_id')
				.equals(mealId)
				.and((mp) => !mp.deleted_at)
				.toArray();
			for (const mp of mps) {
				contributions.push({ product_id: mp.product_id, quantity: mp.quantity });
			}
		}

		// product_ids already present as ACTIVE ListItems on the list.
		const items = await db.listItems
			.where('list_id')
			.equals(listId)
			.and((i) => !i.deleted_at)
			.toArray();
		const productIdsOnList = new Set(items.map((i) => i.product_id));

		return computeSuggested({
			contributions,
			productIdsOnList,
			productName: (id) => this.products.get(id)?.name
		});
	}

	/** Resolve a display name for a MealProduct, preferring the live product name. */
	getProductName(mp: MealProduct): string {
		const product = this.products.get(mp.product_id);
		return product?.name ?? mp.name_snapshot ?? 'Unknown';
	}

	async refresh(): Promise<void> {
		await this.loadMeals();
	}
}

export const mealStore = new MealStore();
