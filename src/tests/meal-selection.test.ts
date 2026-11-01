import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/db/database';
import { mealStore } from '$lib/stores/meal.svelte';
import {
	createListItem,
	getEntityById
} from '$lib/db/operations';
import { isSoftDeleted } from '$lib/db/utils';
import type { ListItem, MealSelection, Product } from '$lib/types';

/**
 * Phase-2 store coverage for meal SELECTION and the Dexie-gathering selector
 * (computeSuggestedForList). The pure summation itself is covered exhaustively
 * in suggested.test.ts; here we prove the store wiring:
 *  - select/deselect create/soft-delete MealSelection rows (meal_id + list_id)
 *    through the Phase-0 wrappers + recordChange
 *  - re-selecting a soft-deleted row UN-DELETES it (stable id) rather than
 *    creating a duplicate
 *  - isSelected / loadSelections reflect the active list only
 *  - computeSuggestedForList gathers real inputs and applies the curation rule
 */
describe('MealStore — selection (Phase 2)', () => {
	const LIST = 'list-1';
	const OTHER_LIST = 'list-2';

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

	/** Add an active ListItem for a product on a list (minimal fields). */
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

	beforeEach(async () => {
		await db.changes.clear();
		await db.meals.clear();
		await db.mealProducts.clear();
		await db.mealSelections.clear();
		await db.listItems.clear();
		await db.products.clear();

		mealStore.meals = [];
		mealStore.mealProducts = new Map();
		mealStore.products = new Map();
		mealStore.selections = new Map();
		mealStore.selectionListId = null;
	});

	it('selectMeal creates a MealSelection (meal_id + list_id) and records a change', async () => {
		const meal = await mealStore.createMeal('Breakfast');

		await mealStore.selectMeal(meal!.id, LIST);

		expect(mealStore.isSelected(meal!.id)).toBe(true);

		const rows = await db.mealSelections.toArray();
		expect(rows).toHaveLength(1);
		expect(rows[0].meal_id).toBe(meal!.id);
		expect(rows[0].list_id).toBe(LIST);
		expect(isSoftDeleted(rows[0])).toBe(false);

		const change = (await db.changes.toArray()).find((c) => c.entity_id === rows[0].id);
		expect(change?.entity_type).toBe('MealSelection');
		expect(change?.operation).toBe('create');
	});

	it('selectMeal is a NO-OP when already actively selected (no duplicate row)', async () => {
		const meal = await mealStore.createMeal('Breakfast');
		await mealStore.selectMeal(meal!.id, LIST);
		await mealStore.selectMeal(meal!.id, LIST);

		const active = (await db.mealSelections.toArray()).filter((s) => !isSoftDeleted(s));
		expect(active).toHaveLength(1);
	});

	it('deselectMeal soft-deletes the active selection and records a delete', async () => {
		const meal = await mealStore.createMeal('Breakfast');
		await mealStore.selectMeal(meal!.id, LIST);
		// Simulate a prior sync so the delete records cleanly (not coalesced away).
		await db.changes.clear();
		const selId = [...mealStore.selections.values()][0].id;

		await mealStore.deselectMeal(meal!.id, LIST);

		expect(mealStore.isSelected(meal!.id)).toBe(false);
		const persisted = await getEntityById<MealSelection>('mealSelections', selId);
		expect(isSoftDeleted(persisted!)).toBe(true);

		const change = (await db.changes.toArray()).find((c) => c.entity_id === selId);
		expect(change?.operation).toBe('delete');
	});

	it('re-selecting a soft-deleted selection UN-DELETES the same row (stable id, no duplicate)', async () => {
		const meal = await mealStore.createMeal('Breakfast');
		await mealStore.selectMeal(meal!.id, LIST);
		const originalId = [...mealStore.selections.values()][0].id;

		// Simulate the create having synced, so the soft-delete leaves a physical
		// tombstone (create+delete would otherwise coalesce the row away).
		await db.changes.clear();
		await mealStore.deselectMeal(meal!.id, LIST);
		await db.changes.clear();

		await mealStore.selectMeal(meal!.id, LIST);

		expect(mealStore.isSelected(meal!.id)).toBe(true);
		const rows = await db.mealSelections.toArray();
		// Still exactly one physical row, reused.
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe(originalId);
		expect(isSoftDeleted(rows[0])).toBe(false);
		// The revive recorded as an update on the same id.
		const change = (await db.changes.toArray()).find((c) => c.entity_id === originalId);
		expect(change?.operation).toBe('update');
	});

	it('loadSelections reflects only the loaded list; selection is scoped per list', async () => {
		const meal = await mealStore.createMeal('Breakfast');
		await mealStore.selectMeal(meal!.id, LIST);

		// Load selections for a DIFFERENT list → the meal is not selected there.
		await mealStore.loadSelections(OTHER_LIST);
		expect(mealStore.isSelected(meal!.id)).toBe(false);
		expect(mealStore.selectionListId).toBe(OTHER_LIST);

		// Back to the original list → selected again.
		await mealStore.loadSelections(LIST);
		expect(mealStore.isSelected(meal!.id)).toBe(true);
	});

	it('toggleSelection flips selection on and off', async () => {
		const meal = await mealStore.createMeal('Breakfast');

		await mealStore.toggleSelection(meal!.id, LIST);
		expect(mealStore.isSelected(meal!.id)).toBe(true);

		await mealStore.toggleSelection(meal!.id, LIST);
		expect(mealStore.isSelected(meal!.id)).toBe(false);
	});

	it('computeSuggestedForList sums selected meals and excludes products already on the list', async () => {
		await seedProduct('eggs', 'Eggs');
		await seedProduct('milk', 'Milk');
		await seedProduct('flour', 'Flour');
		await mealStore.loadMeals();

		// Meal A: 2 eggs, 1 milk. Meal B: 2 eggs, 3 flour.
		const mealA = await mealStore.createMeal('A');
		const mealB = await mealStore.createMeal('B');
		await mealStore.loadMealProducts(mealA!.id);
		await mealStore.loadMealProducts(mealB!.id);
		await mealStore.addProductToMeal(mealA!.id, 'eggs', 2);
		await mealStore.addProductToMeal(mealA!.id, 'milk', 1);
		await mealStore.addProductToMeal(mealB!.id, 'eggs', 2);
		await mealStore.addProductToMeal(mealB!.id, 'flour', 3);

		// Milk is already on the list → must be excluded entirely.
		await seedListItem('milk');

		await mealStore.selectMeal(mealA!.id, LIST);
		await mealStore.selectMeal(mealB!.id, LIST);

		const suggested = await mealStore.computeSuggestedForList(LIST);

		// Eggs summed to 4 (2+2), Flour 3; Milk excluded. Ordered by name.
		expect(suggested).toEqual([
			{ product_id: 'eggs', quantity: 4 },
			{ product_id: 'flour', quantity: 3 }
		]);
	});

	it('computeSuggestedForList drops a meal contribution after it is deselected', async () => {
		await seedProduct('eggs', 'Eggs');
		await seedProduct('flour', 'Flour');
		await mealStore.loadMeals();

		const mealA = await mealStore.createMeal('A');
		const mealB = await mealStore.createMeal('B');
		await mealStore.loadMealProducts(mealA!.id);
		await mealStore.loadMealProducts(mealB!.id);
		await mealStore.addProductToMeal(mealA!.id, 'eggs', 2);
		await mealStore.addProductToMeal(mealB!.id, 'flour', 3);

		await mealStore.selectMeal(mealA!.id, LIST);
		await mealStore.selectMeal(mealB!.id, LIST);
		expect(await mealStore.computeSuggestedForList(LIST)).toEqual([
			{ product_id: 'eggs', quantity: 2 },
			{ product_id: 'flour', quantity: 3 }
		]);

		await mealStore.deselectMeal(mealB!.id, LIST);
		expect(await mealStore.computeSuggestedForList(LIST)).toEqual([
			{ product_id: 'eggs', quantity: 2 }
		]);
	});

	it('computeSuggestedForList is empty with no selections', async () => {
		await seedProduct('eggs', 'Eggs');
		await mealStore.loadMeals();
		const meal = await mealStore.createMeal('A');
		await mealStore.loadMealProducts(meal!.id);
		await mealStore.addProductToMeal(meal!.id, 'eggs', 2);
		// No selectMeal call.
		expect(await mealStore.computeSuggestedForList(LIST)).toEqual([]);
	});
});
