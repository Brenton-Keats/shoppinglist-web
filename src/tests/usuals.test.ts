import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/db/database';
import { mealStore, normalizeMeal } from '$lib/stores/meal.svelte';
import { createListItem, getEntityById } from '$lib/db/operations';
import { isSoftDeleted } from '$lib/db/utils';
import type { ListItem, Meal, Product } from '$lib/types';

/**
 * Coverage for "THE USUALS" + the independent Meal Plan visibility flag.
 *
 * Two orthogonal booleans on Meal:
 *   - is_usual      — auto-selected on new lists (default false)
 *   - in_meal_plan  — pure display filter for the Meal Plan section (default true)
 *
 * These tests prove: the create defaults, the INDEPENDENCE of the two flags
 * (toggling one never changes the other), ensureUsualsSelected (selects active
 * usuals lacking a selection, idempotent), the Meal Plan filter (excludes
 * in_meal_plan=false while those meals STILL contribute to Suggested), and
 * defaults-on-read for legacy rows missing the fields.
 */
describe('Meals — the usuals + in_meal_plan flag', () => {
	const LIST = 'list-usuals';

	async function seedProduct(id: string, name: string): Promise<Product> {
		const ts = new Date().toISOString();
		const product = {
			id,
			name,
			default_section_id: null,
			default_store_id: null,
			sort_order: 'a0',
			active: true,
			created_at: ts,
			updated_at: ts,
			deleted_at: null
		} as Product;
		await db.products.add(product);
		return product;
	}

	async function seedListItem(productId: string, listId = LIST): Promise<ListItem> {
		return createListItem({
			list_id: listId,
			product_id: productId,
			name_snapshot: productId,
			section_id: null,
			store_id: null,
			quantity: 1,
			unit: null,
			completed: false,
			completed_at: null,
			sort_order: 'a0'
		});
	}

	/** Insert a Meal row directly, optionally omitting the new flag fields to
	 * simulate a legacy row written before this feature. */
	async function seedRawMeal(id: string, overrides: Partial<Meal> = {}): Promise<void> {
		const ts = new Date().toISOString();
		await db.meals.add({
			id,
			name: id,
			sort_order: 'a0',
			active: true,
			created_at: ts,
			updated_at: ts,
			deleted_at: null,
			...overrides
		} as Meal);
	}

	beforeEach(async () => {
		await db.changes.clear();
		await db.meals.clear();
		await db.mealProducts.clear();
		await db.mealSelections.clear();
		await db.products.clear();
		await db.listItems.clear();

		mealStore.meals = [];
		mealStore.mealProducts = new Map();
		mealStore.products = new Map();
		mealStore.selections = new Map();
		mealStore.selectionListId = null;
	});

	// --- Create defaults ------------------------------------------------------

	it('createMeal defaults a new meal to is_usual=false and in_meal_plan=true', async () => {
		const meal = await mealStore.createMeal('Taco Night');
		expect(meal).toBeDefined();
		expect(meal!.is_usual).toBe(false);
		expect(meal!.in_meal_plan).toBe(true);

		const persisted = await getEntityById<Meal>('meals', meal!.id);
		expect(persisted!.is_usual).toBe(false);
		expect(persisted!.in_meal_plan).toBe(true);
	});

	// --- Independence of the two flags ---------------------------------------

	it('setUsual changes ONLY is_usual, never in_meal_plan (both start default)', async () => {
		const meal = await mealStore.createMeal('Breakfast');
		await mealStore.loadMeals();

		await mealStore.setUsual(meal!.id, true); // no active list → no auto-select
		const after = mealStore.meals.find((m) => m.id === meal!.id)!;
		expect(after.is_usual).toBe(true);
		expect(after.in_meal_plan).toBe(true); // UNCHANGED

		const persisted = await getEntityById<Meal>('meals', meal!.id);
		expect(persisted!.is_usual).toBe(true);
		expect(persisted!.in_meal_plan).toBe(true);
	});

	it('setInMealPlan changes ONLY in_meal_plan, never is_usual', async () => {
		const meal = await mealStore.createMeal('Breakfast');
		await mealStore.loadMeals();

		await mealStore.setInMealPlan(meal!.id, false);
		const after = mealStore.meals.find((m) => m.id === meal!.id)!;
		expect(after.in_meal_plan).toBe(false);
		expect(after.is_usual).toBe(false); // UNCHANGED

		const persisted = await getEntityById<Meal>('meals', meal!.id);
		expect(persisted!.in_meal_plan).toBe(false);
		expect(persisted!.is_usual).toBe(false);
	});

	it('toggling is_usual then in_meal_plan keeps each independent (no coupling)', async () => {
		const meal = await mealStore.createMeal('Weekly Staples');
		await mealStore.loadMeals();

		// Mark usual — in_meal_plan must stay at its default true.
		await mealStore.setUsual(meal!.id, true);
		expect(mealStore.meals.find((m) => m.id === meal!.id)!.in_meal_plan).toBe(true);

		// Now hide from meal plan — is_usual must stay true.
		await mealStore.setInMealPlan(meal!.id, false);
		const m = mealStore.meals.find((x) => x.id === meal!.id)!;
		expect(m.is_usual).toBe(true);
		expect(m.in_meal_plan).toBe(false);

		// Unmark usual — in_meal_plan must stay false (not reset).
		await mealStore.setUsual(meal!.id, false);
		const m2 = mealStore.meals.find((x) => x.id === meal!.id)!;
		expect(m2.is_usual).toBe(false);
		expect(m2.in_meal_plan).toBe(false);

		const persisted = await getEntityById<Meal>('meals', meal!.id);
		expect(persisted!.is_usual).toBe(false);
		expect(persisted!.in_meal_plan).toBe(false);
	});

	it('setUsual(true) with an active list auto-selects the meal (side effect) but still never touches in_meal_plan', async () => {
		const meal = await mealStore.createMeal('Snacks');
		await mealStore.loadMeals();
		await mealStore.loadSelections(LIST);

		await mealStore.setUsual(meal!.id, true, LIST);

		// Auto-selected for the active list.
		expect(mealStore.isSelected(meal!.id)).toBe(true);
		const sel = await db.mealSelections
			.where('meal_id')
			.equals(meal!.id)
			.and((s) => s.list_id === LIST && !s.deleted_at)
			.first();
		expect(sel).toBeDefined();

		// in_meal_plan still default true.
		expect(mealStore.meals.find((m) => m.id === meal!.id)!.in_meal_plan).toBe(true);
	});

	// --- ensureUsualsSelected -------------------------------------------------

	it('ensureUsualsSelected selects every active usual lacking a selection', async () => {
		const u1 = await mealStore.createMeal('Usual A');
		const u2 = await mealStore.createMeal('Usual B');
		const normal = await mealStore.createMeal('Normal');
		await mealStore.loadMeals();
		await mealStore.setUsual(u1!.id, true);
		await mealStore.setUsual(u2!.id, true);

		await mealStore.ensureUsualsSelected(LIST);
		await mealStore.loadSelections(LIST);

		expect(mealStore.isSelected(u1!.id)).toBe(true);
		expect(mealStore.isSelected(u2!.id)).toBe(true);
		// Non-usual meal is NOT auto-selected.
		expect(mealStore.isSelected(normal!.id)).toBe(false);
	});

	it('ensureUsualsSelected is idempotent — a second call creates no duplicate selections', async () => {
		const u1 = await mealStore.createMeal('Usual A');
		await mealStore.loadMeals();
		await mealStore.setUsual(u1!.id, true);

		await mealStore.ensureUsualsSelected(LIST);
		await mealStore.ensureUsualsSelected(LIST);

		const rows = (await db.mealSelections.toArray()).filter(
			(s) => s.meal_id === u1!.id && s.list_id === LIST && !isSoftDeleted(s)
		);
		expect(rows).toHaveLength(1);
	});

	it('ensureUsualsSelected does NOT resurrect a deliberate per-list opt-out', async () => {
		const u1 = await mealStore.createMeal('Usual A');
		await mealStore.loadMeals();
		await mealStore.setUsual(u1!.id, true);

		// New list: usual auto-selected, then user opts it out for THIS list.
		await mealStore.ensureUsualsSelected(LIST);
		await mealStore.loadSelections(LIST);
		await mealStore.deselectMeal(u1!.id, LIST);
		expect(mealStore.isSelected(u1!.id)).toBe(false);

		// Re-running ensure for the SAME list must respect the opt-out: the task's
		// policy is to call ensure only at creation, but even if called again it
		// must only add a selection where NONE exists. A soft-deleted (opted-out)
		// row counts as "exists", so it is left alone.
		await mealStore.ensureUsualsSelected(LIST);
		await mealStore.loadSelections(LIST);
		expect(mealStore.isSelected(u1!.id)).toBe(false);
	});

	it('ensureUsualsSelected ignores legacy usual rows correctly (is_usual missing → not a usual)', async () => {
		// Legacy row with NO is_usual field: must be treated as non-usual.
		await seedRawMeal('legacy-1', { name: 'Legacy' });
		await mealStore.ensureUsualsSelected(LIST);
		await mealStore.loadSelections(LIST);
		expect(mealStore.isSelected('legacy-1')).toBe(false);
	});

	// --- Meal Plan filter (in_meal_plan) + Suggested independence -------------

	it('mealPlanMeals excludes selected meals with in_meal_plan=false', async () => {
		const shown = await mealStore.createMeal('Shown');
		const hidden = await mealStore.createMeal('Hidden');
		await mealStore.loadMeals();
		await mealStore.setInMealPlan(hidden!.id, false);

		await mealStore.selectMeal(shown!.id, LIST);
		await mealStore.selectMeal(hidden!.id, LIST);

		const planIds = mealStore.mealPlanMeals.map((m) => m.id);
		expect(planIds).toContain(shown!.id);
		expect(planIds).not.toContain(hidden!.id);

		// But BOTH are still genuinely selected.
		expect(mealStore.selectedMeals.map((m) => m.id).sort()).toEqual(
			[shown!.id, hidden!.id].sort()
		);
	});

	it('a selected meal with in_meal_plan=false still contributes to Suggested', async () => {
		await seedProduct('p-eggs', 'Eggs');
		const hidden = await mealStore.createMeal('Hidden');
		await mealStore.loadMeals();
		await mealStore.loadMealProducts(hidden!.id);
		await mealStore.addProductToMeal(hidden!.id, 'p-eggs', 3);

		// Hide it from the Meal Plan, then select it.
		await mealStore.setInMealPlan(hidden!.id, false);
		await mealStore.selectMeal(hidden!.id, LIST);

		// Not in the Meal Plan...
		expect(mealStore.mealPlanMeals.map((m) => m.id)).not.toContain(hidden!.id);
		// ...but its products STILL flow into Suggested (unchanged summation).
		const suggested = await mealStore.computeSuggestedForList(LIST);
		const eggs = suggested.find((s) => s.product_id === 'p-eggs');
		expect(eggs).toBeDefined();
		expect(eggs!.quantity).toBe(3);
	});

	it('a usual product already on the list is excluded from Suggested (curation)', async () => {
		await seedProduct('p-eggs', 'Eggs');
		const usual = await mealStore.createMeal('Usual');
		await mealStore.loadMeals();
		await mealStore.loadMealProducts(usual!.id);
		await mealStore.addProductToMeal(usual!.id, 'p-eggs', 2);
		await mealStore.setUsual(usual!.id, true, LIST); // auto-selects

		// Eggs already curated onto the list.
		await seedListItem('p-eggs', LIST);

		const suggested = await mealStore.computeSuggestedForList(LIST);
		expect(suggested.find((s) => s.product_id === 'p-eggs')).toBeUndefined();
	});

	// --- Defaults-on-read for legacy rows -------------------------------------

	it('normalizeMeal fills missing flags: is_usual→false, in_meal_plan→true', () => {
		const raw = { id: 'm', name: 'M', sort_order: 'a0', active: true } as unknown as Meal;
		const normalized = normalizeMeal(raw);
		expect(normalized.is_usual).toBe(false);
		expect(normalized.in_meal_plan).toBe(true);
	});

	it('normalizeMeal preserves explicit flag values independently', () => {
		const raw = {
			id: 'm',
			name: 'M',
			sort_order: 'a0',
			active: true,
			is_usual: true,
			in_meal_plan: false
		} as Meal;
		const normalized = normalizeMeal(raw);
		expect(normalized.is_usual).toBe(true);
		expect(normalized.in_meal_plan).toBe(false);
	});

	it('loadMeals applies defaults-on-read for legacy rows missing the fields', async () => {
		await seedRawMeal('legacy-1', { name: 'Legacy' }); // no flags
		await seedRawMeal('legacy-2', {
			name: 'Legacy Usual',
			is_usual: true,
			in_meal_plan: false
		} as Partial<Meal>);

		await mealStore.loadMeals();

		const legacy1 = mealStore.meals.find((m) => m.id === 'legacy-1')!;
		expect(legacy1.is_usual).toBe(false);
		expect(legacy1.in_meal_plan).toBe(true);

		const legacy2 = mealStore.meals.find((m) => m.id === 'legacy-2')!;
		expect(legacy2.is_usual).toBe(true);
		expect(legacy2.in_meal_plan).toBe(false);
	});
});
