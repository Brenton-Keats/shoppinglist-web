import { describe, expect, it } from 'vitest';
import { groupByStoreSection } from '$lib/view-modes/store-section';
import { groupBySectionStore } from '$lib/view-modes/section-store';
import { UNASSIGNED_ID } from '$lib/view-modes/types';
import type { ListItem, Product, Section, Store } from '$lib/types';

const base = {
	created_at: '2026-01-01T00:00:00.000Z',
	updated_at: '2026-01-01T00:00:00.000Z',
	deleted_at: null
};

function store(id: string, name: string, sort_order: string): Store {
	return { ...base, id, name, sort_order, active: true };
}
function section(id: string, name: string, sort_order: string): Section {
	return { ...base, id, name, sort_order, active: true, list_id: null };
}
function product(id: string, name: string): Product {
	return { ...base, id, name, sort_order: 'a0', active: true, default_section_id: null, default_store_id: null };
}
function item(
	id: string,
	product_id: string,
	section_id: string | null,
	store_id: string | null,
	sort_order: string
): ListItem {
	return {
		...base,
		id,
		list_id: 'list-1',
		product_id,
		name_snapshot: id,
		section_id,
		store_id,
		quantity: null,
		unit: null,
		completed: false,
		completed_at: null,
		sort_order
	};
}

// Two stores (Coles before Woolies), two sections (Produce before Dairy).
const stores = [store('coles', 'Coles', 'a0'), store('woolies', 'Woolies', 'a1')];
const sections = [section('produce', 'Produce', 'a0'), section('dairy', 'Dairy', 'a1')];

/** Flatten a projection into "<primary>/<secondary>/<itemId>" strings in order. */
function flatten(groups: Awaited<ReturnType<typeof groupByStoreSection>>): string[] {
	const out: string[] = [];
	for (const g of groups) {
		for (const sg of g.secondaryGroups) {
			for (const gi of sg.items) {
				out.push(`${g.name}/${sg.name}/${gi.item.id}`);
			}
		}
	}
	return out;
}

describe('STORE_SECTION grouping', () => {
	it('orders stores, then sections within a store, then items within a bucket', async () => {
		const products = [product('p1', 'Apple'), product('p2', 'Milk')];
		const items = [
			// Deliberately shuffled input order.
			item('i-w-dairy', 'p2', 'dairy', 'woolies', 'a0'),
			item('i-c-dairy-2', 'p2', 'dairy', 'coles', 'a1'),
			item('i-c-produce', 'p1', 'produce', 'coles', 'a0'),
			item('i-c-dairy-1', 'p2', 'dairy', 'coles', 'a0')
		];

		const groups = await groupByStoreSection(items, products, sections, stores);

		expect(flatten(groups)).toEqual([
			// Coles first (store sort a0), Produce before Dairy (section sort),
			// items within Coles/Dairy ordered by item sort_order (a0 before a1).
			'Coles/Produce/i-c-produce',
			'Coles/Dairy/i-c-dairy-1',
			'Coles/Dairy/i-c-dairy-2',
			// Then Woolies.
			'Woolies/Dairy/i-w-dairy'
		]);
	});
});

describe('SECTION_STORE grouping', () => {
	it('groups products in the same section together, then orders by store', async () => {
		const products = [product('p1', 'Apple'), product('p2', 'Milk')];
		const items = [
			item('i-w-produce', 'p1', 'produce', 'woolies', 'a0'),
			item('i-c-produce', 'p1', 'produce', 'coles', 'a0'),
			item('i-c-dairy', 'p2', 'dairy', 'coles', 'a0')
		];

		const groups = await groupBySectionStore(items, products, sections, stores);

		// Primary = section (Produce before Dairy); all produce items are adjacent,
		// sub-ordered by store (Coles before Woolies).
		expect(flatten(groups)).toEqual([
			'Produce/Coles/i-c-produce',
			'Produce/Woolies/i-w-produce',
			'Dairy/Coles/i-c-dairy'
		]);
	});
});

describe('grouping is item-driven and loses nothing', () => {
	it('folds items with unknown/inactive/null store or section into the fallback bucket', async () => {
		const products = [product('p1', 'Apple')];
		const deletedStore = { ...store('gone', 'Gone', 'a2'), deleted_at: '2026-01-02T00:00:00.000Z' };
		const items = [
			item('i-null', 'p1', null, null, 'a0'), // no store/section
			item('i-missing', 'p1', 'produce', 'does-not-exist', 'a1'), // unknown store
			item('i-deleted', 'p1', 'produce', 'gone', 'a2') // soft-deleted store
		];

		const groups = await groupByStoreSection(items, products, sections, [...stores, deletedStore]);

		const total = groups.reduce(
			(n, g) => n + g.secondaryGroups.reduce((m, sg) => m + sg.items.length, 0),
			0
		);
		expect(total).toBe(3); // nothing dropped

		// All three orphaned items land under the "Any Store" primary fallback.
		const fallback = groups.find((g) => g.id === UNASSIGNED_ID);
		expect(fallback).toBeDefined();
		const fallbackCount = fallback!.secondaryGroups.reduce((m, sg) => m + sg.items.length, 0);
		expect(fallbackCount).toBe(3);
	});

	it('places the unassigned group last', async () => {
		const products = [product('p1', 'Apple')];
		const items = [
			item('i-null', 'p1', null, null, 'a0'),
			item('i-coles', 'p1', 'produce', 'coles', 'a0')
		];
		const groups = await groupByStoreSection(items, products, sections, stores);
		expect(groups[groups.length - 1].id).toBe(UNASSIGNED_ID);
		expect(groups[0].name).toBe('Coles');
	});
});

describe('grouping respects fractional store/section ordering', () => {
	it('reorders primary groups when the underlying sort keys change', async () => {
		const products = [product('p1', 'Apple')];
		const items = [
			item('i-coles', 'p1', 'produce', 'coles', 'a0'),
			item('i-woolies', 'p1', 'produce', 'woolies', 'a0')
		];

		// Swap store order via sort keys: Woolies now before Coles.
		const swapped = [store('coles', 'Coles', 'a1'), store('woolies', 'Woolies', 'a0')];
		const groups = await groupByStoreSection(items, products, sections, swapped);
		expect(groups.map((g) => g.name)).toEqual(['Woolies', 'Coles']);
	});
});
