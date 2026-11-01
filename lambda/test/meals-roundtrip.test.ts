import { describe, expect, it } from 'vitest';
import { handleGetData, handlePostSync } from '../src/handlers';
import { InMemoryStore } from './inMemoryStore';
import type { ClientChange } from '../src/types';

/**
 * Phase 0 GATE (server side): prove the three meal entities round-trip through
 * the server apply + full-fetch path intact. This exercises every server-side
 * enumeration point for the new types:
 *   - EntityType union (types.ts)        — change is accepted, not dropped
 *   - ENTITY_COLUMNS whitelist (config)  — fields survive computeEntityWrite
 *   - ENTITY_TYPES array                 — (consistency with the whitelist)
 *   - handleGetData full dump (handlers) — rows come back on GET
 *   - ServerDataResponse shape (types)   — meals/mealProducts/mealSelections keys
 *
 * If ENTITY_COLUMNS is missing an entry, applyChange returns null and the write
 * is silently dropped — the GET assertions below then fail. If a column is
 * missing from a whitelist, that field is dropped and the field assertion fails.
 * If handleGetData doesn't enumerate the type, the array is absent/empty and the
 * length assertions fail. So a missed enumeration breaks this test.
 */

const UPDATED = '2026-09-01T10:00:00.000Z';

function change(overrides: Partial<ClientChange>): ClientChange {
  return {
    id: 'chg-' + Math.random().toString(36).slice(2),
    entityType: 'Meal',
    entityId: 'meal-1',
    operation: 'create',
    ...overrides,
  };
}

describe('meals phase 0 — server round-trip', () => {
  it('creates Meal + MealProduct + MealSelection, applies, and returns them intact on GET', async () => {
    const store = new InMemoryStore();

    const changes: ClientChange[] = [
      change({
        entityType: 'Meal',
        entityId: 'meal-1',
        operation: 'create',
        data: { name: 'Taco Night', sort_order: 'a1', active: true, updated_at: UPDATED },
      }),
      change({
        entityType: 'MealProduct',
        entityId: 'mp-1',
        operation: 'create',
        data: {
          meal_id: 'meal-1',
          product_id: 'prod-1',
          name_snapshot: 'Eggs',
          quantity: 12,
          updated_at: UPDATED,
        },
      }),
      change({
        entityType: 'MealSelection',
        entityId: 'ms-1',
        operation: 'create',
        data: { meal_id: 'meal-1', list_id: 'list-1', updated_at: UPDATED },
      }),
    ];

    const res = await handlePostSync(store, {
      deviceId: 'dev-a',
      baseRevision: 0,
      changes,
    });

    // All three changes must be accepted (not silently dropped by applyChange).
    expect(res.success).toBe(true);
    expect(res.acceptedChanges).toHaveLength(3);
    expect(res.acceptedChanges).toEqual(
      expect.arrayContaining([changes[0].id, changes[1].id, changes[2].id]),
    );

    const data = await handleGetData(store);

    // The response shape exposes each new collection.
    expect(data.meals).toHaveLength(1);
    expect(data.mealProducts).toHaveLength(1);
    expect(data.mealSelections).toHaveLength(1);

    const meal = data.meals[0];
    expect(meal.id).toBe('meal-1');
    expect(meal.name).toBe('Taco Night');
    // sort_order is preserved as a STRING (not coerced to a number).
    expect(meal.sort_order).toBe('a1');
    expect(typeof meal.sort_order).toBe('string');
    expect(meal.active).toBe(true);
    expect(meal.deleted_at).toBeNull();

    const mealProduct = data.mealProducts[0];
    expect(mealProduct.id).toBe('mp-1');
    expect(mealProduct.meal_id).toBe('meal-1');
    expect(mealProduct.product_id).toBe('prod-1');
    // name_snapshot is preserved.
    expect(mealProduct.name_snapshot).toBe('Eggs');
    // quantity is preserved as a NUMBER.
    expect(mealProduct.quantity).toBe(12);
    expect(typeof mealProduct.quantity).toBe('number');
    expect(mealProduct.deleted_at).toBeNull();

    const mealSelection = data.mealSelections[0];
    expect(mealSelection.id).toBe('ms-1');
    expect(mealSelection.meal_id).toBe('meal-1');
    expect(mealSelection.list_id).toBe('list-1');
    expect(mealSelection.deleted_at).toBeNull();
  });

  it('round-trips meal entities through the change log payload (second device pull)', async () => {
    const store = new InMemoryStore();

    await handlePostSync(store, {
      deviceId: 'dev-a',
      baseRevision: 0,
      changes: [
        change({
          entityType: 'MealProduct',
          entityId: 'mp-9',
          operation: 'create',
          data: {
            meal_id: 'meal-9',
            product_id: 'prod-9',
            name_snapshot: 'Flour',
            // Client sends a numeric string; server must store a number.
            quantity: '3',
            updated_at: UPDATED,
          },
        }),
      ],
    });

    // A second device at baseRevision 0 pulls the change log. The payload must
    // carry the canonical, type-enforced record for the new entity type.
    const resB = await handlePostSync(store, {
      deviceId: 'dev-b',
      baseRevision: 0,
      changes: [],
    });

    const mpChange = resB.changes.find((c) => c.entity_id === 'mp-9');
    expect(mpChange).toBeDefined();
    expect(mpChange!.entity_type).toBe('MealProduct');
    const payload = mpChange!.payload as Record<string, unknown>;
    expect(payload.name_snapshot).toBe('Flour');
    expect(payload.quantity).toBe(3);
    expect(typeof payload.quantity).toBe('number');
  });

  it('soft-deletes a meal entity (tombstone) through the apply path', async () => {
    const store = new InMemoryStore();
    await handlePostSync(store, {
      deviceId: 'dev-a',
      baseRevision: 0,
      changes: [
        change({
          entityType: 'MealSelection',
          entityId: 'ms-del',
          operation: 'create',
          data: { meal_id: 'meal-1', list_id: 'list-1', updated_at: UPDATED },
        }),
      ],
    });

    const res = await handlePostSync(store, {
      deviceId: 'dev-a',
      baseRevision: 1,
      changes: [
        change({
          entityType: 'MealSelection',
          entityId: 'ms-del',
          operation: 'delete',
          data: {},
        }),
      ],
    });
    expect(res.acceptedChanges).toHaveLength(1);

    const data = await handleGetData(store);
    expect(data.mealSelections[0].deleted_at).not.toBeNull();
  });
});
