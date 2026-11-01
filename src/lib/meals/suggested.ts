/**
 * PURE suggested-products summation for the Meals feature (Phase 2).
 *
 * This module is deliberately framework- and storage-free: NO Dexie, NO DOM, NO
 * Svelte. It takes plain data in and returns plain data out, so it is trivially
 * unit-testable and the derivation can be reasoned about in isolation from the
 * store-gathering code that feeds it (see meal.svelte.ts `suggestedProducts`).
 *
 * Design (locked decisions, implemented exactly):
 *  - A "week" == the active List; the caller supplies only the contributions of
 *    the meals selected FOR that list, so scoping lives in the caller.
 *  - QUANTITY MODEL = Design A: this is a PURE DERIVED view. Nothing here is ever
 *    written back onto a ListItem. ListItem.quantity is untouched by meals.
 *  - SUMMATION across selected meals: for each product, the suggested quantity is
 *    the Σ of every selected meal's contribution for that product. Two meals each
 *    needing 2 eggs → 4 eggs.
 *  - CURATION RULE (critical): if a product is ALREADY on the active list (an
 *    active, non-deleted ListItem exists for it), the meal contributes NOTHING for
 *    that product and it is EXCLUDED from the result ENTIRELY — omitted, not zeroed.
 *    The result only ever contains products NOT already on the list.
 */

/**
 * A single product→quantity contribution from one selected meal. A flat list of
 * these (one per selected meal × product) is the input to `computeSuggested`;
 * flattening the MealSelections → their MealProducts into this shape is the
 * caller's job (keeps this module free of the join shapes).
 */
export interface SuggestedContribution {
	product_id: string;
	/** Quantity this meal contributes for the product (expected positive integer). */
	quantity: number;
}

/**
 * One row of the derived suggested result: a product NOT already on the list,
 * with the summed quantity across all selected meals. Minimal on purpose — any
 * display name is looked up by the CALLER (we don't carry names through the pure
 * math, mirroring how ListItem/MealProduct keep a product_id and resolve names
 * at the edge).
 */
export interface SuggestedProduct {
	product_id: string;
	/** Σ of contributions for this product across all selected meals. */
	quantity: number;
}

export interface ComputeSuggestedParams {
	/**
	 * Flat contributions from the meals selected for the active list. May contain
	 * multiple entries for the same product_id (one per meal); they are summed.
	 */
	contributions: SuggestedContribution[];
	/**
	 * product_ids that already have an ACTIVE (non-deleted) ListItem on the active
	 * list. Any product in this set is EXCLUDED from the result entirely.
	 */
	productIdsOnList: ReadonlySet<string>;
	/**
	 * Optional stable display-name lookup used ONLY to order the result
	 * deterministically (case-insensitive by name, then product_id as a tiebreak).
	 * When omitted, ordering falls back to product_id alone. Names are not carried
	 * into the output.
	 */
	productName?: (productId: string) => string | undefined;
}

/**
 * Derive the suggested products for the active list from the selected meals'
 * contributions and the set of products already on the list.
 *
 * Steps:
 *  1. Group contributions by product_id and SUM their quantities.
 *  2. EXCLUDE any product already on the list (curation rule) — omitted entirely.
 *  3. Drop non-positive sums (defensive; a product that nets <= 0 is not suggested).
 *  4. Return in a DETERMINISTIC order: case-insensitive product name ascending
 *     (via `productName` when supplied), with product_id as a stable tiebreak so
 *     the order is total and reproducible for Phase 3 rendering and tests.
 *
 * Pure: no side effects, inputs are not mutated.
 */
export function computeSuggested(params: ComputeSuggestedParams): SuggestedProduct[] {
	const { contributions, productIdsOnList, productName } = params;

	// 1. Group + sum by product_id (insertion-independent).
	const totals = new Map<string, number>();
	for (const c of contributions) {
		// Skip products already on the list before summing — cheaper and makes the
		// exclusion unambiguous (their contributions never enter the map).
		if (productIdsOnList.has(c.product_id)) continue;
		const qty = Number.isFinite(c.quantity) ? c.quantity : 0;
		totals.set(c.product_id, (totals.get(c.product_id) ?? 0) + qty);
	}

	// 2 + 3. Materialise rows, dropping non-positive sums.
	const rows: SuggestedProduct[] = [];
	for (const [product_id, quantity] of totals) {
		if (quantity <= 0) continue;
		rows.push({ product_id, quantity });
	}

	// 4. Deterministic total order: name (case-insensitive) then product_id.
	rows.sort((a, b) => {
		const nameA = (productName?.(a.product_id) ?? '').toLowerCase();
		const nameB = (productName?.(b.product_id) ?? '').toLowerCase();
		if (nameA !== nameB) return nameA < nameB ? -1 : 1;
		return a.product_id < b.product_id ? -1 : a.product_id > b.product_id ? 1 : 0;
	});

	return rows;
}
