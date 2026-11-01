import { describe, it, expect } from 'vitest';
import { compareItemsForDisplay, compareSortKeys } from '$lib/utils/ordering';
import { groupBySectionStore } from '$lib/view-modes/section-store';
import type { ListItem, Product, Section, Store } from '$lib/types';

/**
 * Within-SECTION item order must be IDENTICAL on the list builder and shop mode.
 *
 * Root cause (see .agents/tasks/shop-vs-list-item-order-investigation.md):
 * the two screens sorted a section's items by DIFFERENT fields with DIFFERENT
 * tiebreaks — the list builder by `Product.sort_order` (+ name tiebreak), shop
 * mode by `ListItem.sort_order` (NO tiebreak). On fresh data the two fields are
 * written in lockstep and distinct, so both agree. On AGED data they drift and
 * carry legacy duplicate `a0` keys, so the different field+tiebreak on each
 * screen resolves the moved item differently.
 *
 * The fix routes BOTH screens through one shared comparator
 * (`compareItemsForDisplay`) over one shared field (the on-list item's
 * `ListItem.sort_order`) with one deterministic `id` tiebreak. These tests model
 * the investigation §3 aged-data key set and lock the two orders together.
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

function listItem(
	id: string,
	productId: string,
	sectionId: string | null,
	sort_order: string
): ListItem {
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

describe('within-section item order: list builder vs shop mode (aged data)', () => {
	// Investigation §3 aged-data state: five products in ONE section with DISTINCT
	// Product.sort_order but DUPLICATE/legacy `a0` ListItem.sort_order keys, plus
	// one mirrored move (item 5 moved to position 2 → list item 5 got the clean
	// mirrored key `a0V`). The two `a0` list items (I1, I2) collide; the moved
	// item lands between them by key only.
	//
	//  entity | Product.sort_order | ListItem.sort_order
	//    1    |        a0          |  a0
	//    2    |        a1          |  a0   <- legacy duplicate
	//    3    |        a2          |  a1
	//    4    |        a3          |  a2
	//    5    |        a0V         |  a0V  (mirrored move to position 2)
	const sec = section('sec-1', 'Produce', 'a0');
	const sections = [sec];
	const stores: Store[] = [];

	const products = [
		product('p1', 'One', sec.id, 'a0'),
		product('p2', 'Two', sec.id, 'a1'),
		product('p3', 'Three', sec.id, 'a2'),
		product('p4', 'Four', sec.id, 'a3'),
		product('p5', 'Five', sec.id, 'a0V')
	];

	// Items deliberately supplied in the ARRIVAL/query order of the investigation
	// §3 second variant: the moved item i5 shares a legacy duplicate `a0` with i1
	// and ARRIVES FIRST (as `getItemsByList`'s stable sort would leave an equal
	// pair). With no tiebreak, shop mode leaves them in this arrival order and
	// renders the reported 5,1,2,3,4; the id tiebreak in `compareItemsForDisplay`
	// instead resolves i1 before i5 → the intended 1,5,2,3,4. (p5's distinct
	// Product.sort_order `a0V` is what let the list builder render 1,5,2,3,4 all
	// along; the divergence is purely the shop-side missing tiebreak.)
	const items = [
		listItem('i5', 'p5', sec.id, 'a0'),
		listItem('i1', 'p1', sec.id, 'a0'),
		listItem('i2', 'p2', sec.id, 'a1'),
		listItem('i3', 'p3', sec.id, 'a2'),
		listItem('i4', 'p4', sec.id, 'a3')
	];

	// Map product id -> visible position number (1..5) for readable assertions.
	const positionOf = new Map<string, number>([
		['p1', 1],
		['p2', 2],
		['p3', 3],
		['p4', 4],
		['p5', 5]
	]);

	/**
	 * SHOP MODE order — driven through the REAL grouping pipeline the screen uses
	 * (`groupBySectionStore` → `groupItems` → `sortGroupedItems`). We read the
	 * flattened leaf order for the single section.
	 */
	async function shopModeOrder(): Promise<number[]> {
		const groups = await groupBySectionStore(items, products, sections, stores);
		const section = groups.find((g) => g.id === sec.id)!;
		const flat = section.secondaryGroups.flatMap((sg) => sg.items);
		return flat.map((gi) => positionOf.get(gi.item.product_id)!);
	}

	/**
	 * LIST BUILDER on-list order — all five products are on the list, so the
	 * on-list block orders by the matching `ListItem.sort_order` via the shared
	 * `compareItemsForDisplay` (exactly what the component does after the fix).
	 */
	function listBuilderOrder(): number[] {
		const byProduct = new Map(items.map((i) => [i.product_id, i]));
		return [...products]
			.sort((a, b) => {
				const ia = byProduct.get(a.id)!;
				const ib = byProduct.get(b.id)!;
				return compareItemsForDisplay(
					{ sort_order: ia.sort_order, id: ia.id },
					{ sort_order: ib.sort_order, id: ib.id }
				);
			})
			.map((p) => positionOf.get(p.id)!);
	}

	it('shop-mode within-section order equals list-builder order (and the intended 1,5,2,3,4)', async () => {
		const shop = await shopModeOrder();
		const list = listBuilderOrder();
		// RED before the fix: shop mode (no tiebreak) renders 5,1,2,3,4 while the
		// list builder renders 1,5,2,3,4. GREEN after: both 1,5,2,3,4.
		expect(list).toEqual([1, 5, 2, 3, 4]);
		expect(shop).toEqual([1, 5, 2, 3, 4]);
		expect(shop).toEqual(list);
	});

	it('both screens agree after a lazy-heal rewrites the group to distinct keys', async () => {
		// Models the HEALED list-item key set a lazy rebalance would write (distinct,
		// strictly-increasing keys), with the moved item 5 sitting at position 2.
		// Both screens resolve this identically to the intended 1,5,2,3,4.
		const healedItems = [
			listItem('i1', 'p1', sec.id, 'a0'),
			listItem('i2', 'p2', sec.id, 'a1'),
			listItem('i3', 'p3', sec.id, 'a2'),
			listItem('i4', 'p4', sec.id, 'a3'),
			// moved item 5 sits between item 1 and item 2 (position 2):
			listItem('i5', 'p5', sec.id, 'a0V')
		];
		const byProduct = new Map(healedItems.map((i) => [i.product_id, i]));

		const list = [...products]
			.sort((a, b) => {
				const ia = byProduct.get(a.id)!;
				const ib = byProduct.get(b.id)!;
				return compareItemsForDisplay(
					{ sort_order: ia.sort_order, id: ia.id },
					{ sort_order: ib.sort_order, id: ib.id }
				);
			})
			.map((p) => positionOf.get(p.id)!);

		const groups = await groupBySectionStore(healedItems, products, sections, stores);
		const sectionGroup = groups.find((g) => g.id === sec.id)!;
		const shop = sectionGroup.secondaryGroups
			.flatMap((sg) => sg.items)
			.map((gi) => positionOf.get(gi.item.product_id)!);

		expect(list).toEqual([1, 5, 2, 3, 4]);
		expect(shop).toEqual([1, 5, 2, 3, 4]);
		expect(shop).toEqual(list);
	});
});

describe('compareItemsForDisplay', () => {
	it('matches compareSortKeys on distinct keys', () => {
		const a = { sort_order: 'a0', id: 'x' };
		const b = { sort_order: 'a1', id: 'y' };
		expect(Math.sign(compareItemsForDisplay(a, b))).toBe(
			Math.sign(compareSortKeys(a.sort_order, b.sort_order))
		);
		expect(compareItemsForDisplay(a, b)).toBeLessThan(0);
		expect(compareItemsForDisplay(b, a)).toBeGreaterThan(0);
	});

	it('breaks equal keys deterministically by id (strict total order)', () => {
		const a = { sort_order: 'a0', id: 'aaa' };
		const b = { sort_order: 'a0', id: 'bbb' };
		expect(compareSortKeys(a.sort_order, b.sort_order)).toBe(0); // core unchanged
		expect(compareItemsForDisplay(a, b)).toBeLessThan(0); // id tiebreak
		expect(compareItemsForDisplay(b, a)).toBeGreaterThan(0);
		expect(compareItemsForDisplay(a, a)).toBe(0);
	});

	it('gives a stable total order on an all-equal-key group', () => {
		const group = [
			{ sort_order: 'a0', id: 'c' },
			{ sort_order: 'a0', id: 'a' },
			{ sort_order: 'a0', id: 'b' }
		];
		const sorted = [...group].sort(compareItemsForDisplay);
		expect(sorted.map((g) => g.id)).toEqual(['a', 'b', 'c']);
		// Re-sorting a reversed copy yields the same order (deterministic).
		const resorted = [...group].reverse().sort(compareItemsForDisplay);
		expect(resorted.map((g) => g.id)).toEqual(['a', 'b', 'c']);
	});

	it('treats null/empty keys consistently (sorted last, id-stable among them)', () => {
		const group = [
			{ sort_order: null, id: 'z' },
			{ sort_order: 'a0', id: 'real' },
			{ sort_order: '', id: 'a' },
			{ sort_order: undefined, id: 'm' }
		];
		const sorted = [...group].sort(compareItemsForDisplay);
		expect(sorted[0].id).toBe('real'); // the only real key leads
		// the three empty keys trail, ordered by id: a, m, z
		expect(sorted.slice(1).map((g) => g.id)).toEqual(['a', 'm', 'z']);
	});
});
