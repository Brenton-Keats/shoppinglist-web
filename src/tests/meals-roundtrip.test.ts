import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/db/database';
import {
	createMealAtEnd,
	createMealProduct,
	createMealSelection,
	getEntityById
} from '$lib/db/operations';
import { applyServerChanges } from '$lib/sync/engine';
import type { ServerChange } from '$lib/sync/conflict';
import type { Meal, MealProduct, MealSelection } from '$lib/types';

/**
 * Phase 0 GATE (client side): prove the three meal entities round-trip through
 * the client plumbing intact. This exercises every client-side enumeration
 * point for the new types:
 *   - Dexie v3 store map + class fields (database.ts) — create/get hit real tables
 *   - operations.ts CRUD wrappers with the right recordChange literals
 *   - ChangeRecord['entity_type'] union (types.ts) — recordChange typing
 *   - ENTITY_TABLE_MAP (engine.ts) — applyServerChanges maps type → table
 *   - normalizeEntity (normalize.ts) — sort_order stays string, quantity number
 *
 * The round trip: create locally → read the recorded change payloads (what a
 * submit would send) → feed them back through applyServerChanges as if the
 * server echoed them → confirm each entity re-hydrates into its Dexie table
 * with all fields intact. If ENTITY_TABLE_MAP is missing an entry,
 * applyServerChanges logs "Unknown entity type" and SKIPS — the re-hydration
 * assertions then fail. So a missed enumeration breaks this test.
 */
describe('meals phase 0 — client round-trip', () => {
	beforeEach(async () => {
		await db.changes.clear();
		await db.meals.clear();
		await db.mealProducts.clear();
		await db.mealSelections.clear();
	});

	/** Turn locally-recorded changes into the ServerChange shape applyServerChanges consumes. */
	async function recordedChangesAsServerChanges(): Promise<ServerChange[]> {
		const changes = await db.changes.toArray();
		return changes.map((c, i) => ({
			revision: i + 1,
			entityType: c.entity_type,
			entityId: c.entity_id,
			operation: c.operation,
			data: { ...c.payload, id: c.entity_id },
			timestamp: c.timestamp
		}));
	}

	it('creates Meal + MealProduct + MealSelection and re-hydrates them intact', async () => {
		const meal = await createMealAtEnd({
			name: 'Taco Night',
			active: true,
			is_usual: false,
			in_meal_plan: true
		});
		const mealProduct = await createMealProduct({
			meal_id: meal.id,
			product_id: 'prod-1',
			name_snapshot: 'Eggs',
			quantity: 12
		});
		const selection = await createMealSelection({ meal_id: meal.id, list_id: 'list-1' });

		// Each create recorded a change under the correct entity_type literal.
		const changes = await db.changes.toArray();
		const byId = (id: string) => changes.find((c) => c.entity_id === id);
		expect(byId(meal.id)?.entity_type).toBe('Meal');
		expect(byId(mealProduct.id)?.entity_type).toBe('MealProduct');
		expect(byId(selection.id)?.entity_type).toBe('MealSelection');

		// Snapshot the server-shaped changes, then wipe local state so the
		// re-hydration genuinely comes from applyServerChanges, not leftover rows.
		const serverChanges = await recordedChangesAsServerChanges();
		await db.meals.clear();
		await db.mealProducts.clear();
		await db.mealSelections.clear();

		await applyServerChanges(serverChanges);

		// Meal re-hydrated with sort_order preserved as a STRING.
		const rehydratedMeal = await getEntityById<Meal>('meals', meal.id);
		expect(rehydratedMeal).toBeDefined();
		expect(rehydratedMeal!.name).toBe('Taco Night');
		expect(rehydratedMeal!.active).toBe(true);
		expect(typeof rehydratedMeal!.sort_order).toBe('string');
		expect(rehydratedMeal!.sort_order).toBe(meal.sort_order);

		// MealProduct re-hydrated with quantity as a NUMBER and name_snapshot kept.
		const rehydratedMp = await getEntityById<MealProduct>('mealProducts', mealProduct.id);
		expect(rehydratedMp).toBeDefined();
		expect(rehydratedMp!.meal_id).toBe(meal.id);
		expect(rehydratedMp!.product_id).toBe('prod-1');
		expect(rehydratedMp!.name_snapshot).toBe('Eggs');
		expect(rehydratedMp!.quantity).toBe(12);
		expect(typeof rehydratedMp!.quantity).toBe('number');

		// MealSelection re-hydrated with both FKs intact.
		const rehydratedSel = await getEntityById<MealSelection>('mealSelections', selection.id);
		expect(rehydratedSel).toBeDefined();
		expect(rehydratedSel!.meal_id).toBe(meal.id);
		expect(rehydratedSel!.list_id).toBe('list-1');
	});

	it('coerces a numeric-string quantity to a number on the ingestion boundary', async () => {
		const meal = await createMealAtEnd({
			name: 'Pasta',
			active: true,
			is_usual: false,
			in_meal_plan: true
		});
		await createMealProduct({
			meal_id: meal.id,
			product_id: 'prod-2',
			name_snapshot: 'Flour',
			quantity: 3
		});

		// Simulate a server echo that sent quantity as a string (legacy row).
		const changes = await db.changes.toArray();
		const mpChange = changes.find((c) => c.entity_type === 'MealProduct')!;
		const serverChange: ServerChange = {
			revision: 1,
			entityType: 'MealProduct',
			entityId: mpChange.entity_id,
			operation: 'update',
			data: { quantity: '5' },
			timestamp: new Date(Date.now() + 60_000).toISOString()
		};

		await applyServerChanges([serverChange]);

		const mp = await getEntityById<MealProduct>('mealProducts', mpChange.entity_id);
		expect(mp!.quantity).toBe(5);
		expect(typeof mp!.quantity).toBe('number');
	});
});
