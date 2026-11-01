import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/db/database';
import {
	createProductAtEnd,
	moveEntityToGroupEnd,
	getEntityById
} from '$lib/db/operations';
import { compareSortKeys } from '$lib/utils/ordering';
import type { Product } from '$lib/types';

/**
 * Tests for the shared, atomic "append an existing row to the end of a group"
 * operation (moveEntityToGroupEnd) that saveProductEdit's section-change path
 * routes through. The key property under test: the assigned key is derived from
 * the current group MAX and is therefore strictly greater than every existing
 * key in the destination group AND distinct from them — even when that group
 * has drifted into duplicate/degenerate keys.
 */
describe('moveEntityToGroupEnd (shared group-end assignment)', () => {
	beforeEach(async () => {
		await db.changes.clear();
		await db.products.clear();
	});

	/** Seed a product directly with an explicit key + section (bypasses create-at-end). */
	async function seedProduct(id: string, sectionId: string | null, sort_order: string) {
		const ts = new Date().toISOString();
		await db.products.add({
			id,
			name: id,
			default_section_id: sectionId,
			default_store_id: null,
			sort_order,
			active: true,
			created_at: ts,
			updated_at: ts,
			deleted_at: null
		} as Product);
	}

	const sectionMax = (group: Product[]) =>
		group.reduce<string | null>(
			(max, p) => (max === null || compareSortKeys(p.sort_order, max) > 0 ? p.sort_order : max),
			null
		);

	it('assigns a key strictly greater than the destination group max', async () => {
		// Destination section S has healthy keys a0, a1, a2.
		await seedProduct('p-a', 'S', 'a0');
		await seedProduct('p-b', 'S', 'a1');
		await seedProduct('p-c', 'S', 'a2');
		// The moving product currently lives in a different section.
		await seedProduct('p-move', 'OTHER', 'a0');

		const newKey = await moveEntityToGroupEnd<Product>(
			'products',
			'Product',
			'p-move',
			(p) => (p.default_section_id ?? null) === 'S',
			{ default_section_id: 'S' }
		);

		const dest = (await db.products.toArray()).filter(
			(p) => p.default_section_id === 'S' && p.id !== 'p-move'
		);
		const max = sectionMax(dest)!;
		expect(compareSortKeys(newKey, max)).toBeGreaterThan(0);

		// Row actually moved and carries the new key + section.
		const moved = await getEntityById<Product>('products', 'p-move');
		expect(moved?.default_section_id).toBe('S');
		expect(moved?.sort_order).toBe(newKey);
	});

	it('assigns a NON-colliding key when the destination group has duplicate/degenerate keys', async () => {
		// Drifted destination: three products all sharing "a0" (the duplicate case
		// that makes array-position sortKeyAfter(lastKey) collide).
		await seedProduct('d-1', 'DRIFT', 'a0');
		await seedProduct('d-2', 'DRIFT', 'a0');
		await seedProduct('d-3', 'DRIFT', 'a0');
		await seedProduct('d-move', null, 'a0');

		const newKey = await moveEntityToGroupEnd<Product>(
			'products',
			'Product',
			'd-move',
			(p) => (p.default_section_id ?? null) === 'DRIFT',
			{ default_section_id: 'DRIFT' }
		);

		const dest = (await db.products.toArray()).filter((p) => p.default_section_id === 'DRIFT');
		const existingKeys = dest.filter((p) => p.id !== 'd-move').map((p) => p.sort_order);

		// New key is distinct from every existing (duplicate) key in the group...
		expect(existingKeys).not.toContain(newKey);
		// ...and strictly greater than their max ("a0"), so it sorts to the end.
		expect(compareSortKeys(newKey, 'a0')).toBeGreaterThan(0);

		// The whole destination group now has a unique key for the moved row.
		const allKeys = dest.map((p) => p.sort_order);
		expect(allKeys.filter((k) => k === newKey)).toHaveLength(1);
	});

	it('appends after remaining siblings when re-appending within the current group (excludes self)', async () => {
		// Group with a product that currently holds the max key; moving it to the
		// end must NOT key off its own (excluded) value — it lands after a1.
		await seedProduct('s-a', 'G', 'a0');
		await seedProduct('s-b', 'G', 'a1');
		await seedProduct('s-top', 'G', 'a9'); // currently the max

		const newKey = await moveEntityToGroupEnd<Product>(
			'products',
			'Product',
			's-a',
			(p) => (p.default_section_id ?? null) === 'G'
		);

		// Derived from the max of the OTHER siblings (a9), so strictly greater.
		expect(compareSortKeys(newKey, 'a9')).toBeGreaterThan(0);
	});

	it('records an update change for sync with the resolved sort_order', async () => {
		await seedProduct('c-1', 'S', 'a0');
		await seedProduct('c-move', 'OTHER', 'a0');

		const newKey = await moveEntityToGroupEnd<Product>(
			'products',
			'Product',
			'c-move',
			(p) => (p.default_section_id ?? null) === 'S',
			{ default_section_id: 'S' }
		);

		const changes = await db.changes.toArray();
		const moveChange = changes.find((c) => c.entity_id === 'c-move');
		expect(moveChange?.operation).toBe('update');
		expect(moveChange?.payload.sort_order).toBe(newKey);
		expect(moveChange?.payload.default_section_id).toBe('S');
	});

	it('createProductAtEnd and moveEntityToGroupEnd derive keys the same way (shared path)', async () => {
		// Create two products into an empty section via the create-at-end path.
		const p1 = await createProductAtEnd({
			name: 'first',
			default_section_id: 'SHARED',
			default_store_id: null,
			active: true
		});
		const p2 = await createProductAtEnd({
			name: 'second',
			default_section_id: 'SHARED',
			default_store_id: null,
			active: true
		});
		expect(compareSortKeys(p2.sort_order, p1.sort_order)).toBeGreaterThan(0);

		// Move an outside product to the end of the same section.
		await seedProduct('mv', 'ELSEWHERE', 'a0');
		const movedKey = await moveEntityToGroupEnd<Product>(
			'products',
			'Product',
			'mv',
			(p) => (p.default_section_id ?? null) === 'SHARED',
			{ default_section_id: 'SHARED' }
		);
		// It lands strictly after the last-created product.
		expect(compareSortKeys(movedKey, p2.sort_order)).toBeGreaterThan(0);
	});
});
