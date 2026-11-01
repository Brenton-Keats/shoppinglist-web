import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/db/database';
import { mealStore } from '$lib/stores/meal.svelte';
import { listStore } from '$lib/stores/list.svelte';
import { syncStore } from '$lib/stores/sync.svelte';
import { recordChange, markChangesSynced } from '$lib/db/changes';
import { getPendingChanges } from '$lib/db/queries';
import type { List, Product } from '$lib/types';

/**
 * Item 1 — the header "synced/pending" indicator must count ALL record changes
 * (every entity type, including Meal / MealProduct / MealSelection) as pending
 * until synced.
 *
 * Root cause this guards against: the stores previously refreshed the badge via
 * `db.changes.where('synced').equals(0).count()`. `recordChange` stores
 * `synced: false` (a BOOLEAN), and Dexie's `.equals(0)` (integer) never matches
 * boolean `false` — so meal/list writes left the count at 0/stale. The fix
 * routes every refresh through the boolean-consistent `getPendingChanges()`
 * path via `syncStore.refreshPendingCount()`.
 */
describe('pending-sync count (Item 1)', () => {
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

	async function seedActiveList(id: string): Promise<List> {
		const ts = new Date().toISOString();
		const list = {
			id,
			name: 'This list',
			status: 'ACTIVE',
			sort_order: 'a0',
			created_at: ts,
			updated_at: ts,
			deleted_at: null
		} as unknown as List;
		await db.lists.add(list);
		return list;
	}

	beforeEach(async () => {
		await db.changes.clear();
		await db.meals.clear();
		await db.mealProducts.clear();
		await db.mealSelections.clear();
		await db.products.clear();
		await db.lists.clear();
		await db.listItems.clear();

		// Reset in-memory store state.
		mealStore.meals = [];
		mealStore.mealProducts = new Map();
		mealStore.products = new Map();
		mealStore.selections = new Map();
		mealStore.selectionListId = null;
		listStore.activeList = null;
		listStore.items = [];
		listStore.products = new Map();
		syncStore.setPendingCount(0);
	});

	it('counts a Meal create as a pending change (fails today)', async () => {
		expect(syncStore.pendingCount).toBe(0);

		await mealStore.createMeal('Taco Night');

		// A change was recorded...
		expect((await getPendingChanges()).length).toBeGreaterThan(0);
		// ...and the badge reflects it.
		expect(syncStore.pendingCount).toBeGreaterThan(0);
	});

	it('counts a MealProduct add as a pending change (fails today)', async () => {
		const meal = await mealStore.createMeal('Taco Night');
		expect(meal).toBeDefined();
		await seedProduct('prod-1', 'Beef');
		mealStore.products = new Map([['prod-1', mealStore.products.get('prod-1') ?? (await db.products.get('prod-1'))!]]);

		const before = syncStore.pendingCount;
		await mealStore.addProductToMeal(meal!.id, 'prod-1', 2);

		expect(syncStore.pendingCount).toBeGreaterThan(before);
	});

	it('counts a list item add as a pending change', async () => {
		const list = await seedActiveList('list-1');
		listStore.activeList = list;
		const product = await seedProduct('prod-list-1', 'Milk');
		listStore.products = new Map([[product.id, product]]);

		expect(syncStore.pendingCount).toBe(0);
		await listStore.addItem(product.id);
		expect(syncStore.pendingCount).toBeGreaterThan(0);
	});

	it('clears the count after changes are synced', async () => {
		const c1 = await recordChange('Meal', 'meal-x', 'create', { name: 'X' });
		const c2 = await recordChange('MealProduct', 'mp-x', 'create', { meal_id: 'meal-x' });
		await syncStore.refreshPendingCount();
		expect(syncStore.pendingCount).toBe(2);

		await markChangesSynced([c1.id, c2.id], 7);
		await syncStore.refreshPendingCount();
		expect(syncStore.pendingCount).toBe(0);
	});
});
