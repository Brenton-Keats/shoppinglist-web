import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/db/database';
import { mealStore } from '$lib/stores/meal.svelte';
import { getEntityById } from '$lib/db/operations';
import { isSoftDeleted } from '$lib/db/utils';
import type { MealProduct, Product } from '$lib/types';

/**
 * Store-level coverage for MealStore (Phase 1): create a meal, add a product
 * (capturing name_snapshot), the duplicate-product no-op, quantity clamp/floor
 * reuse (same helpers as list items), remove a product, and the cascade
 * deletion of a meal's products.
 */
describe('MealStore', () => {
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

	beforeEach(async () => {
		await db.changes.clear();
		await db.meals.clear();
		await db.mealProducts.clear();
		await db.products.clear();

		// Reset in-memory store state between tests.
		mealStore.meals = [];
		mealStore.mealProducts = new Map();
		mealStore.products = new Map();
	});

	it('createMeal creates an active meal and tracks it in memory', async () => {
		const meal = await mealStore.createMeal('Taco Night');

		expect(meal).toBeDefined();
		expect(meal!.name).toBe('Taco Night');
		expect(meal!.active).toBe(true);
		expect(mealStore.meals.map((m) => m.id)).toContain(meal!.id);

		const persisted = await getEntityById('meals', meal!.id);
		expect(persisted).toBeDefined();

		// A create change was recorded for sync.
		const changes = await db.changes.toArray();
		const change = changes.find((c) => c.entity_id === meal!.id);
		expect(change?.entity_type).toBe('Meal');
		expect(change?.operation).toBe('create');
	});

	it('createMeal rejects an empty/whitespace name (no row created)', async () => {
		const meal = await mealStore.createMeal('   ');
		expect(meal).toBeUndefined();
		expect(await db.meals.count()).toBe(0);
	});

	it('addProductToMeal captures name_snapshot from the product current name', async () => {
		await seedProduct('p1', 'Eggs');
		await mealStore.loadMeals();
		const meal = await mealStore.createMeal('Breakfast');
		await mealStore.loadMealProducts(meal!.id);

		const mp = await mealStore.addProductToMeal(meal!.id, 'p1', 2);

		expect(mp).toBeDefined();
		expect(mp!.name_snapshot).toBe('Eggs');
		expect(mp!.quantity).toBe(2);
		expect(mealStore.getMealProducts(meal!.id).map((r) => r.id)).toContain(mp!.id);

		const persisted = await getEntityById<MealProduct>('mealProducts', mp!.id);
		expect(persisted?.name_snapshot).toBe('Eggs');
	});

	it('addProductToMeal is a NO-OP for a product already in the meal (no duplicate row)', async () => {
		await seedProduct('p1', 'Eggs');
		await mealStore.loadMeals();
		const meal = await mealStore.createMeal('Breakfast');
		await mealStore.loadMealProducts(meal!.id);

		const first = await mealStore.addProductToMeal(meal!.id, 'p1', 1);
		const second = await mealStore.addProductToMeal(meal!.id, 'p1', 5);

		// Same row returned; no second row created.
		expect(second!.id).toBe(first!.id);
		expect(mealStore.getMealProducts(meal!.id)).toHaveLength(1);
		const activeRows = (await db.mealProducts.toArray()).filter((r) => !isSoftDeleted(r));
		expect(activeRows).toHaveLength(1);
		// Quantity is NOT bumped by the duplicate add (user adjusts it instead).
		expect(mealStore.getMealProducts(meal!.id)[0].quantity).toBe(1);
	});

	it('setMealProductQuantity clamps below-floor values up to 1', async () => {
		await seedProduct('p1', 'Eggs');
		await mealStore.loadMeals();
		const meal = await mealStore.createMeal('Breakfast');
		await mealStore.loadMealProducts(meal!.id);
		const mp = await mealStore.addProductToMeal(meal!.id, 'p1', 3);

		await mealStore.setMealProductQuantity(mp!.id, 0);

		expect(mealStore.getMealProducts(meal!.id)[0].quantity).toBe(1);
		const persisted = await getEntityById<MealProduct>('mealProducts', mp!.id);
		expect(persisted?.quantity).toBe(1);
	});

	it('adjustMealProductQuantity(+1) raises and (-1) at 1 floors (no-op)', async () => {
		await seedProduct('p1', 'Eggs');
		await mealStore.loadMeals();
		const meal = await mealStore.createMeal('Breakfast');
		await mealStore.loadMealProducts(meal!.id);
		const mp = await mealStore.addProductToMeal(meal!.id, 'p1', 1);

		await mealStore.adjustMealProductQuantity(mp!.id, 1);
		expect(mealStore.getMealProducts(meal!.id)[0].quantity).toBe(2);

		await mealStore.adjustMealProductQuantity(mp!.id, -1); // → 1
		await mealStore.adjustMealProductQuantity(mp!.id, -1); // floors at 1
		expect(mealStore.getMealProducts(meal!.id)[0].quantity).toBe(1);
		const persisted = await getEntityById<MealProduct>('mealProducts', mp!.id);
		expect(persisted?.quantity).toBe(1);
	});

	it('removeProductFromMeal soft-deletes the row and drops it from memory', async () => {
		await seedProduct('p1', 'Eggs');
		await mealStore.loadMeals();
		const meal = await mealStore.createMeal('Breakfast');
		await mealStore.loadMealProducts(meal!.id);
		const mp = await mealStore.addProductToMeal(meal!.id, 'p1', 1);

		await mealStore.removeProductFromMeal(mp!.id);

		expect(mealStore.getMealProducts(meal!.id)).toHaveLength(0);
		const persisted = await getEntityById<MealProduct>('mealProducts', mp!.id);
		expect(isSoftDeleted(persisted!)).toBe(true);
	});

	it('deleteMeal cascades: soft-deletes the meal AND its products', async () => {
		await seedProduct('p1', 'Eggs');
		await seedProduct('p2', 'Milk');
		await mealStore.loadMeals();
		const meal = await mealStore.createMeal('Breakfast');
		await mealStore.loadMealProducts(meal!.id);
		const mp1 = await mealStore.addProductToMeal(meal!.id, 'p1', 1);
		const mp2 = await mealStore.addProductToMeal(meal!.id, 'p2', 2);

		// Simulate the meal + products having been synced already (a prior session):
		// clear the pending create changes so the subsequent delete records cleanly
		// rather than coalescing create+delete away (the documented cancel case).
		await db.changes.clear();

		await mealStore.deleteMeal(meal!.id);

		// Meal removed from memory.
		expect(mealStore.meals.map((m) => m.id)).not.toContain(meal!.id);

		// Meal and both products are soft-deleted in the DB (the cascade).
		const persistedMeal = await getEntityById('meals', meal!.id);
		expect(isSoftDeleted(persistedMeal as never)).toBe(true);
		const pmp1 = await getEntityById<MealProduct>('mealProducts', mp1!.id);
		const pmp2 = await getEntityById<MealProduct>('mealProducts', mp2!.id);
		expect(isSoftDeleted(pmp1!)).toBe(true);
		expect(isSoftDeleted(pmp2!)).toBe(true);

		// Delete changes recorded for sync (meal + each product).
		const deleteChanges = (await db.changes.toArray()).filter((c) => c.operation === 'delete');
		const deletedIds = deleteChanges.map((c) => c.entity_id);
		expect(deletedIds).toContain(meal!.id);
		expect(deletedIds).toContain(mp1!.id);
		expect(deletedIds).toContain(mp2!.id);
	});

	it('deleteMeal of an unsynced meal cancels its pending changes (create+delete coalesce)', async () => {
		await seedProduct('p1', 'Eggs');
		await mealStore.loadMeals();
		const meal = await mealStore.createMeal('Scratch');
		await mealStore.loadMealProducts(meal!.id);
		await mealStore.addProductToMeal(meal!.id, 'p1', 1);

		// Meal + product were never synced; deleting them should coalesce the
		// create+delete pairs away, leaving no pending changes for those ids.
		await mealStore.deleteMeal(meal!.id);

		const changes = await db.changes.toArray();
		const mealChanges = changes.filter((c) => c.entity_type === 'Meal');
		const mpChanges = changes.filter((c) => c.entity_type === 'MealProduct');
		expect(mealChanges).toHaveLength(0);
		expect(mpChanges).toHaveLength(0);
	});

	it('loadMeals sorts active meals by sort_order', async () => {
		const a = await mealStore.createMeal('Alpha');
		const b = await mealStore.createMeal('Bravo');
		const c = await mealStore.createMeal('Charlie');

		await mealStore.loadMeals();

		// Created at-end → stable ascending sort_order order.
		expect(mealStore.meals.map((m) => m.id)).toEqual([a!.id, b!.id, c!.id]);
	});

	it('renameMeal updates the name in DB and memory', async () => {
		const meal = await mealStore.createMeal('Old Name');
		await mealStore.renameMeal(meal!.id, 'New Name');

		expect(mealStore.meals.find((m) => m.id === meal!.id)?.name).toBe('New Name');
		const persisted = await getEntityById('meals', meal!.id);
		expect((persisted as { name: string }).name).toBe('New Name');
	});
});
