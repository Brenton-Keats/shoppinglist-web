/**
 * Rendering ADAPTER for the Meals feature (Phase 3).
 *
 * This module is the thin, PURE bridge between the Phase-2 outputs and the
 * Phase-3 view. It does NOT recompute anything the earlier phases already
 * computed:
 *   - the summed/curated suggested products come straight from Phase 2's pure
 *     `computeSuggested` (via the store selector `computeSuggestedForList`);
 *   - the selected meals come straight from the Phase-2 MealSelection state.
 *
 * Its only job is to turn those two already-derived inputs into the two
 * SYNTHETIC view groups the page renders ABOVE the normal sections:
 *   1. "Meal Plan" — the selected meals, by name (deterministic order).
 *   2. "Suggested" — the suggested products, each resolved to a display name,
 *      preserving the Phase-2 deterministic order exactly (we do NOT re-sort,
 *      so the single source of truth for ordering stays `computeSuggested`).
 *
 * Framework-free (no Svelte, no Dexie, no DOM) so it is trivially unit-testable
 * and cannot disturb `grouping.ts` / the one-bucket-per-item contract — these
 * groups live entirely outside `groupItems` (assessment §4).
 */

import type { SuggestedProduct } from '$lib/meals/suggested';

/** One row of the rendered "Suggested" section. */
export interface SuggestedRow {
	product_id: string;
	/** Resolved display name (falls back to the product_id if unknown). */
	name: string;
	/** Σ suggested quantity across the selected meals (from computeSuggested). */
	quantity: number;
}

/** One row of the rendered "Meal Plan" section. */
export interface MealPlanRow {
	meal_id: string;
	name: string;
}

/** A selected meal as seen by the view (minimal shape — id + name). */
export interface SelectedMealInput {
	id: string;
	name: string;
}

/**
 * Build the "Suggested" rows from the Phase-2 selector output by resolving a
 * display name for each product. ORDER IS PRESERVED from the input — the
 * Phase-2 `computeSuggested` already returns a deterministic total order
 * (case-insensitive name, then product_id), so re-sorting here would duplicate
 * (and risk diverging from) that single source of truth.
 */
export function buildSuggestedRows(
	suggested: readonly SuggestedProduct[],
	productName: (productId: string) => string | undefined
): SuggestedRow[] {
	return suggested.map((s) => ({
		product_id: s.product_id,
		name: productName(s.product_id) ?? s.product_id,
		quantity: s.quantity
	}));
}

/**
 * Build the "Meal Plan" rows from the selected meals, ordered deterministically
 * by case-insensitive name (then meal_id as a stable tiebreak) so the planned
 * list is reproducible for rendering and tests. Inputs are not mutated.
 */
export function buildMealPlanRows(selectedMeals: readonly SelectedMealInput[]): MealPlanRow[] {
	return selectedMeals
		.map((m) => ({ meal_id: m.id, name: m.name }))
		.sort((a, b) => {
			const nameA = a.name.toLowerCase();
			const nameB = b.name.toLowerCase();
			if (nameA !== nameB) return nameA < nameB ? -1 : 1;
			return a.meal_id < b.meal_id ? -1 : a.meal_id > b.meal_id ? 1 : 0;
		});
}

/**
 * Whether the Meal Plan / Suggested sections should be shown at all. The locked
 * empty-state choice is: if NO meals are selected for the active list, HIDE
 * both sections entirely (keep the list clean). Note this keys off selection,
 * not off the suggested rows — a plan with meals whose every product is already
 * on the list still shows "Meal Plan" (so the user sees what they planned) even
 * though "Suggested" is empty; the Suggested section hides itself when it has no
 * rows (see `hasSuggested`).
 */
export function hasMealPlan(selectedMealCount: number): boolean {
	return selectedMealCount > 0;
}

/** Whether the "Suggested" section has any rows to render. */
export function hasSuggested(suggestedRowCount: number): boolean {
	return suggestedRowCount > 0;
}
