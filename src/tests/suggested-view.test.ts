import { describe, it, expect } from 'vitest';
import {
	buildSuggestedRows,
	buildMealPlanRows,
	hasMealPlan,
	hasSuggested,
	type SelectedMealInput
} from '$lib/meals/suggested-view';
import type { SuggestedProduct } from '$lib/meals/suggested';

/**
 * Coverage for the Phase-3 rendering ADAPTER (src/lib/meals/suggested-view.ts).
 * The adapter is the thin bridge from the Phase-2 outputs to the two synthetic
 * view sections. It must NOT re-sort or recompute the suggested products — it
 * only resolves names and preserves the Phase-2 order — and it must implement
 * the locked empty-state hiding rule.
 */
describe('buildSuggestedRows', () => {
	it('resolves display names and PRESERVES the Phase-2 order (no re-sort)', () => {
		// Deliberately NOT in name order — the adapter must keep this exact order
		// because computeSuggested is the single source of truth for ordering.
		const suggested: SuggestedProduct[] = [
			{ product_id: 'milk', quantity: 5 },
			{ product_id: 'apples', quantity: 2 }
		];
		const names: Record<string, string> = { milk: 'Milk', apples: 'Apples' };
		const rows = buildSuggestedRows(suggested, (id) => names[id]);
		expect(rows).toEqual([
			{ product_id: 'milk', name: 'Milk', quantity: 5 },
			{ product_id: 'apples', name: 'Apples', quantity: 2 }
		]);
	});

	it('carries the summed quantity straight through', () => {
		const rows = buildSuggestedRows([{ product_id: 'eggs', quantity: 4 }], () => 'Eggs');
		expect(rows[0].quantity).toBe(4);
	});

	it('falls back to the product_id when no name is known', () => {
		const rows = buildSuggestedRows([{ product_id: 'p-xyz', quantity: 1 }], () => undefined);
		expect(rows[0].name).toBe('p-xyz');
	});

	it('empty input → empty rows', () => {
		expect(buildSuggestedRows([], () => 'X')).toEqual([]);
	});
});

describe('buildMealPlanRows', () => {
	it('orders selected meals by case-insensitive name, then meal_id', () => {
		const meals: SelectedMealInput[] = [
			{ id: 'm3', name: 'taco night' },
			{ id: 'm1', name: 'Breakfast' },
			{ id: 'm2', name: 'Breakfast' } // same name → tiebreak by id (m1 < m2)
		];
		const rows = buildMealPlanRows(meals);
		expect(rows.map((r) => r.meal_id)).toEqual(['m1', 'm2', 'm3']);
		expect(rows.map((r) => r.name)).toEqual(['Breakfast', 'Breakfast', 'taco night']);
	});

	it('does not mutate its input', () => {
		const meals: SelectedMealInput[] = [
			{ id: 'b', name: 'B' },
			{ id: 'a', name: 'A' }
		];
		const snapshot = JSON.parse(JSON.stringify(meals));
		buildMealPlanRows(meals);
		expect(meals).toEqual(snapshot);
	});

	it('empty input → empty rows', () => {
		expect(buildMealPlanRows([])).toEqual([]);
	});
});

describe('empty-state hiding rules', () => {
	it('hasMealPlan: hidden with zero selected meals, shown otherwise', () => {
		expect(hasMealPlan(0)).toBe(false);
		expect(hasMealPlan(1)).toBe(true);
		expect(hasMealPlan(3)).toBe(true);
	});

	it('hasSuggested: hidden with zero rows, shown otherwise', () => {
		expect(hasSuggested(0)).toBe(false);
		expect(hasSuggested(1)).toBe(true);
	});

	it('plan with meals but all products already on list: Meal Plan shows, Suggested hides', () => {
		// 2 meals selected (plan visible) but computeSuggested returned nothing
		// (every product already curated onto the list).
		expect(hasMealPlan(2)).toBe(true);
		expect(hasSuggested(0)).toBe(false);
	});
});
