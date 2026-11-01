import { describe, it, expect } from 'vitest';
import { compareSectionSortKeys } from '$lib/utils/ordering';
import { groupBySectionStore } from '$lib/view-modes/section-store';
import type { ListItem, Product, Section, Store } from '$lib/types';

/**
 * Item 10 — shop-mode ordering must match the product-list ordering.
 *
 * Root cause: the LIST page sorted its sections with `orderA - orderB` where
 * orderA/orderB are STRING fractional keys (e.g. 'a0', 'a1', 'a0V'). In JS
 * `'a1' - 'a0'` is `NaN`, so `Array.sort` treats every pair as "equal" and the
 * sections stay in insertion order — which diverges from shop mode, which orders
 * sections via `compareSortKeys` (through grouping.ts). The fix extracts the
 * list page's section comparison into the shared, fractional-aware
 * `compareSectionSortKeys` so both views share one ordering contract.
 *
 * This test reproduces the divergence (red against the old string-subtraction)
 * and locks the two orders together (green after the fix).
 */

const ts = '2026-01-01T00:00:00Z';

function section(id: string, name: string, sort_order: string): Section {
	return { id, name, sort_order, created_at: ts, updated_at: ts, deleted_at: null } as Section;
}

function product(id: string, name: string, sectionId: string | null, sort_order: string): Product {
	return {
		id,
		name,
		default_section_id: sectionId,
		default_store_id: null,
		sort_order,
		active: true,
		created_at: ts,
		updated_at: ts,
		deleted_at: null
	} as Product;
}

function listItem(id: string, productId: string, sectionId: string | null, sort_order: string): ListItem {
	return {
		id,
		list_id: 'list-1',
		product_id: productId,
		name_snapshot: productId,
		section_id: sectionId,
		store_id: null,
		quantity: 1,
		unit: null,
		completed: false,
		completed_at: null,
		sort_order,
		created_at: ts,
		updated_at: ts,
		deleted_at: null
	} as ListItem;
}

/**
 * The OLD (buggy) list-page section sort, kept here only to PROVE the bug: it
 * subtracts string keys and so returns NaN, leaving insertion order intact.
 */
function oldBuggySort(keys: Array<string | null>, sectionOrder: Map<string, string>): Array<string | null> {
	return [...keys].sort((a, b) => {
		const orderA = a ? ((sectionOrder.get(a) as unknown as number) ?? 999) : 999;
		const orderB = b ? ((sectionOrder.get(b) as unknown as number) ?? 999) : 999;
		return (orderA as number) - (orderB as number);
	});
}

describe('shop-mode vs list-view section ordering (Item 10)', () => {
	// Sections created in an insertion order that does NOT match their sort_order,
	// so a correct sort must reorder them.
	const produce = section('sec-produce', 'Produce', 'a2');
	const dairy = section('sec-dairy', 'Dairy', 'a0');
	const bakery = section('sec-bakery', 'Bakery', 'a1');
	// Insertion order (as a Map would iterate from first-seen): produce, dairy, bakery
	const sections = [produce, dairy, bakery];

	// One product + one list item per section so every section renders in both views.
	const products = [
		product('p-apple', 'Apple', produce.id, 'a0'),
		product('p-milk', 'Milk', dairy.id, 'a0'),
		product('p-bread', 'Bread', bakery.id, 'a0')
	];
	const items = [
		listItem('i-apple', 'p-apple', produce.id, 'a0'),
		listItem('i-milk', 'p-milk', dairy.id, 'a0'),
		listItem('i-bread', 'p-bread', bakery.id, 'a0')
	];
	const stores: Store[] = [];

	/** List-view section order using the SHARED fractional comparator (the fix). */
	function listViewSectionOrder(): string[] {
		const sectionOrder = new Map(sections.map((s) => [s.id, s.sort_order]));
		const keys: Array<string | null> = [produce.id, dairy.id, bakery.id]; // insertion order
		return [...keys]
			.sort((a, b) => compareSectionSortKeys(a ? sectionOrder.get(a) : null, b ? sectionOrder.get(b) : null))
			.map((k) => k ?? '__none__');
	}

	it('the old string-subtraction sort does NOT reorder sections (reproduces the bug)', () => {
		const sectionOrder = new Map(sections.map((s) => [s.id, s.sort_order]));
		const buggy = oldBuggySort([produce.id, dairy.id, bakery.id], sectionOrder);
		// NaN comparator → insertion order preserved → WRONG (dairy 'a0' should be first).
		expect(buggy).toEqual([produce.id, dairy.id, bakery.id]);
	});

	it('list-view section order matches shop-mode group order', async () => {
		const shopGroups = await groupBySectionStore(items, products, sections, stores);
		const shopOrder = shopGroups.map((g) => g.id);

		const listOrder = listViewSectionOrder();

		// Correct order follows sort_order: dairy (a0), bakery (a1), produce (a2).
		expect(listOrder).toEqual(['sec-dairy', 'sec-bakery', 'sec-produce']);
		expect(listOrder).toEqual(shopOrder);
	});

	it('places the unassigned/null section last, like shop mode', () => {
		// a null section key must sort after every real key.
		expect(compareSectionSortKeys(null, 'a0')).toBeGreaterThan(0);
		expect(compareSectionSortKeys('a9', null)).toBeLessThan(0);
	});
});
