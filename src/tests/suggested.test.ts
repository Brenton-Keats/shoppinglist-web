import { describe, it, expect } from 'vitest';
import {
	computeSuggested,
	type SuggestedContribution
} from '$lib/meals/suggested';

/**
 * Exhaustive coverage of the PURE suggested-products summation
 * (src/lib/meals/suggested.ts). These are the heart of Phase 2:
 *  (a) two meals contributing the same product SUM their quantities
 *  (b) deselecting a meal removes exactly its contribution (recompute drops it)
 *  (c) a product already on the active list is EXCLUDED entirely (not zeroed)
 *  (d) a product in a meal but not on the list appears with the summed quantity
 *  (e) deterministic ordering
 *  (f) empty / no-selection → empty result
 * Plus edge cases (non-positive, non-finite, purity).
 */
describe('computeSuggested (pure summation)', () => {
	const names: Record<string, string> = {
		eggs: 'Eggs',
		milk: 'Milk',
		flour: 'Flour',
		apples: 'Apples',
		bread: 'Bread'
	};
	const productName = (id: string) => names[id];

	it('(a) sums quantities when two meals contribute the same product', () => {
		// Meal 1: 2 eggs. Meal 2: 2 eggs. → 4 eggs.
		const contributions: SuggestedContribution[] = [
			{ product_id: 'eggs', quantity: 2 },
			{ product_id: 'eggs', quantity: 2 }
		];
		const result = computeSuggested({
			contributions,
			productIdsOnList: new Set(),
			productName
		});
		expect(result).toEqual([{ product_id: 'eggs', quantity: 4 }]);
	});

	it('(a) sums across many meals and products independently', () => {
		const contributions: SuggestedContribution[] = [
			{ product_id: 'eggs', quantity: 2 },
			{ product_id: 'milk', quantity: 1 },
			{ product_id: 'eggs', quantity: 3 },
			{ product_id: 'milk', quantity: 4 }
		];
		const result = computeSuggested({
			contributions,
			productIdsOnList: new Set(),
			productName
		});
		// Ordered by name: Eggs(5) then Milk(5).
		expect(result).toEqual([
			{ product_id: 'eggs', quantity: 5 },
			{ product_id: 'milk', quantity: 5 }
		]);
	});

	it('(b) deselecting a meal drops exactly its contribution on recompute', () => {
		// Two meals selected: eggs from both, milk only from meal 2.
		const withBoth: SuggestedContribution[] = [
			{ product_id: 'eggs', quantity: 2 }, // meal 1
			{ product_id: 'eggs', quantity: 2 }, // meal 2
			{ product_id: 'milk', quantity: 1 } // meal 2
		];
		const both = computeSuggested({
			contributions: withBoth,
			productIdsOnList: new Set(),
			productName
		});
		expect(both).toEqual([
			{ product_id: 'eggs', quantity: 4 },
			{ product_id: 'milk', quantity: 1 }
		]);

		// Deselect meal 2 → only meal 1's contributions remain (2 eggs, no milk).
		const onlyMeal1: SuggestedContribution[] = [{ product_id: 'eggs', quantity: 2 }];
		const after = computeSuggested({
			contributions: onlyMeal1,
			productIdsOnList: new Set(),
			productName
		});
		expect(after).toEqual([{ product_id: 'eggs', quantity: 2 }]);
	});

	it('(c) excludes a product already on the active list ENTIRELY (omitted, not zeroed)', () => {
		const contributions: SuggestedContribution[] = [
			{ product_id: 'eggs', quantity: 2 },
			{ product_id: 'eggs', quantity: 2 }, // would be 4
			{ product_id: 'milk', quantity: 1 }
		];
		const result = computeSuggested({
			contributions,
			productIdsOnList: new Set(['eggs']),
			productName
		});
		// Eggs is on the list → omitted entirely. Only milk remains.
		expect(result).toEqual([{ product_id: 'milk', quantity: 1 }]);
		expect(result.find((r) => r.product_id === 'eggs')).toBeUndefined();
	});

	it('(c) if every contributed product is already on the list → empty result', () => {
		const contributions: SuggestedContribution[] = [
			{ product_id: 'eggs', quantity: 2 },
			{ product_id: 'milk', quantity: 1 }
		];
		const result = computeSuggested({
			contributions,
			productIdsOnList: new Set(['eggs', 'milk']),
			productName
		});
		expect(result).toEqual([]);
	});

	it('(d) a product in a meal but not on the list appears with the summed quantity', () => {
		const contributions: SuggestedContribution[] = [
			{ product_id: 'eggs', quantity: 2 }, // on list → excluded
			{ product_id: 'flour', quantity: 3 }, // not on list → summed
			{ product_id: 'flour', quantity: 1 }
		];
		const result = computeSuggested({
			contributions,
			productIdsOnList: new Set(['eggs']),
			productName
		});
		expect(result).toEqual([{ product_id: 'flour', quantity: 4 }]);
	});

	it('(e) deterministic ordering: case-insensitive name ascending', () => {
		const contributions: SuggestedContribution[] = [
			{ product_id: 'milk', quantity: 1 },
			{ product_id: 'apples', quantity: 1 },
			{ product_id: 'bread', quantity: 1 },
			{ product_id: 'eggs', quantity: 1 }
		];
		const result = computeSuggested({
			contributions,
			productIdsOnList: new Set(),
			productName
		});
		// Apples, Bread, Eggs, Milk regardless of input order.
		expect(result.map((r) => r.product_id)).toEqual(['apples', 'bread', 'eggs', 'milk']);
	});

	it('(e) ordering is stable regardless of contribution input order', () => {
		const a = computeSuggested({
			contributions: [
				{ product_id: 'milk', quantity: 1 },
				{ product_id: 'eggs', quantity: 1 }
			],
			productIdsOnList: new Set(),
			productName
		});
		const b = computeSuggested({
			contributions: [
				{ product_id: 'eggs', quantity: 1 },
				{ product_id: 'milk', quantity: 1 }
			],
			productIdsOnList: new Set(),
			productName
		});
		expect(a).toEqual(b);
		expect(a.map((r) => r.product_id)).toEqual(['eggs', 'milk']);
	});

	it('(e) falls back to product_id ordering when no name lookup is supplied', () => {
		const result = computeSuggested({
			contributions: [
				{ product_id: 'zeta', quantity: 1 },
				{ product_id: 'alpha', quantity: 1 }
			],
			productIdsOnList: new Set()
		});
		expect(result.map((r) => r.product_id)).toEqual(['alpha', 'zeta']);
	});

	it('(e) product_id breaks ties when names are equal', () => {
		const result = computeSuggested({
			contributions: [
				{ product_id: 'b-id', quantity: 1 },
				{ product_id: 'a-id', quantity: 1 }
			],
			productIdsOnList: new Set(),
			productName: () => 'Same Name'
		});
		expect(result.map((r) => r.product_id)).toEqual(['a-id', 'b-id']);
	});

	it('(f) empty contributions → empty result', () => {
		expect(
			computeSuggested({ contributions: [], productIdsOnList: new Set(), productName })
		).toEqual([]);
	});

	it('(f) no selection (empty) with items already on the list → still empty', () => {
		expect(
			computeSuggested({
				contributions: [],
				productIdsOnList: new Set(['eggs', 'milk']),
				productName
			})
		).toEqual([]);
	});

	it('drops non-positive summed quantities defensively (omitted)', () => {
		const result = computeSuggested({
			contributions: [
				{ product_id: 'eggs', quantity: 0 },
				{ product_id: 'milk', quantity: 2 }
			],
			productIdsOnList: new Set(),
			productName
		});
		expect(result).toEqual([{ product_id: 'milk', quantity: 2 }]);
	});

	it('treats non-finite contribution quantities as 0', () => {
		const result = computeSuggested({
			contributions: [
				{ product_id: 'eggs', quantity: Number.NaN },
				{ product_id: 'eggs', quantity: 3 }
			],
			productIdsOnList: new Set(),
			productName
		});
		expect(result).toEqual([{ product_id: 'eggs', quantity: 3 }]);
	});

	it('is pure: does not mutate its inputs', () => {
		const contributions: SuggestedContribution[] = [
			{ product_id: 'eggs', quantity: 2 },
			{ product_id: 'eggs', quantity: 2 }
		];
		const onList = new Set(['milk']);
		const snapshot = JSON.parse(JSON.stringify(contributions));
		computeSuggested({ contributions, productIdsOnList: onList, productName });
		expect(contributions).toEqual(snapshot);
		expect(onList.has('milk')).toBe(true);
		expect(onList.size).toBe(1);
	});
});
