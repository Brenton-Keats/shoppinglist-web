/**
 * Fractional indexing utilities for sort order.
 *
 * Uses lexicographically sortable string keys that allow insertion
 * between any two items without renumbering others.
 *
 * Examples: "a0", "a1", "a0V" (between a0 and a1), "Zz" (before a0)
 */

import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Generate a sort key that comes after the given key.
 * Use when appending to the end of a list.
 */
export function sortKeyAfter(lastKey: string | null | undefined): string {
	const clean = typeof lastKey === 'string' && lastKey.length > 0 ? lastKey : null;
	return generateKeyBetween(clean, null);
}

/**
 * Generate a sort key that comes before the given key.
 * Use when prepending to the start of a list.
 */
export function sortKeyBefore(firstKey: string | null | undefined): string {
	const clean = typeof firstKey === 'string' && firstKey.length > 0 ? firstKey : null;
	return generateKeyBetween(null, clean);
}

/**
 * Generate a sort key between two existing keys.
 * Use when inserting between two items.
 * Handles undefined/numeric legacy values by treating them as null.
 */
export function sortKeyBetween(before: string | null | undefined, after: string | null | undefined): string {
	const cleanBefore = typeof before === 'string' && before.length > 0 ? before : null;
	const cleanAfter = typeof after === 'string' && after.length > 0 ? after : null;
	return generateKeyBetween(cleanBefore, cleanAfter);
}

/**
 * Generate N sort keys between two existing keys.
 * Use when inserting multiple items at once.
 */
export function sortKeysBetween(before: string | null, after: string | null, count: number): string[] {
	return generateNKeysBetween(before, after, count);
}

/**
 * Generate initial sort keys for a list of items that don't have keys yet.
 * Returns N evenly-spaced keys starting from "a0".
 */
export function generateInitialKeys(count: number): string[] {
	if (count === 0) return [];
	return generateNKeysBetween(null, null, count);
}

/**
 * Compare function for sorting by fractional index string.
 * Use with Array.sort(): items.sort((a, b) => compareSortKeys(a.sort_order, b.sort_order))
 */
export function compareSortKeys(a: string | null | undefined, b: string | null | undefined): number {
	const keyA = a === null || a === undefined || a === '' ? null : a;
	const keyB = b === null || b === undefined || b === '' ? null : b;
	if (keyA === keyB) return 0;
	if (keyA === null) return 1; // null/empty sorts last
	if (keyB === null) return -1;
	return keyA < keyB ? -1 : 1;
}

/**
 * A planned write: assign `sort_order` to the row with `id`.
 */
export interface SortKeyAssignment {
	id: string;
	sort_order: string;
}

/**
 * Normalize a possibly empty/legacy key to null (matches sortKeyBetween/compareSortKeys).
 */
function normalizeKey(key: string | null | undefined): string | null {
	return typeof key === 'string' && key.length > 0 ? key : null;
}

/**
 * Detect whether generating a key between two neighbours would be degenerate —
 * i.e. the two neighbour keys are non-null and equal, which makes
 * generateKeyBetween throw (`a0 >= a0`). Empty/null neighbours are NOT
 * degenerate on their own because sortKeyBetween collapses them to null.
 */
export function keysAreDegenerate(
	before: string | null | undefined,
	after: string | null | undefined
): boolean {
	const b = normalizeKey(before);
	const a = normalizeKey(after);
	// Only a problem when both are real keys and they are not strictly increasing:
	// generateKeyBetween throws on `before >= after`.
	return b !== null && a !== null && b >= a;
}

/**
 * A group is "healthy" when every row has a non-empty key and the keys are
 * strictly increasing in the given (already-sorted) order — i.e. no duplicates,
 * no empties, no drift. Only a healthy group can be reordered with a single
 * fractional insert; a drifted group must be rebalanced.
 */
export function groupIsHealthy(ordered: Array<{ sort_order: string }>): boolean {
	for (let i = 0; i < ordered.length; i++) {
		const key = normalizeKey(ordered[i].sort_order);
		if (key === null) return false;
		if (i > 0) {
			const prev = normalizeKey(ordered[i - 1].sort_order);
			if (prev === null || prev >= key) return false;
		}
	}
	return true;
}

/**
 * Plan a reorder of `movingId` to `newIndex` within `ordered` (already sorted by
 * compareSortKeys with a stable tiebreak applied by the caller).
 *
 * Returns the set of `{ id, sort_order }` writes needed. In the happy path that
 * is a single write for the moved row. When the destination neighbours are
 * degenerate (equal keys) or key generation otherwise fails, the WHOLE group is
 * rebalanced with a fresh, strictly-increasing, evenly-spaced key set that
 * preserves the intended visual order (the order after the move) — so the write
 * set covers every row whose key changed.
 *
 * Returns an empty array when the move is a true no-op.
 */
export function planReorder(
	ordered: Array<{ id: string; sort_order: string }>,
	movingId: string,
	newIndex: number
): SortKeyAssignment[] {
	const oldIndex = ordered.findIndex((e) => e.id === movingId);
	if (oldIndex === -1) return [];

	const without = ordered.filter((e) => e.id !== movingId);
	const clampedIndex = Math.max(0, Math.min(newIndex, without.length));

	// True no-op: landing exactly where it already sits.
	if (clampedIndex === oldIndex) return [];

	const before = clampedIndex > 0 ? without[clampedIndex - 1].sort_order : null;
	const after = clampedIndex < without.length ? without[clampedIndex].sort_order : null;

	// Happy path: a single fractional key between the destination neighbours —
	// only safe when the whole group is healthy (all keys present and strictly
	// increasing) and the destination neighbours are not degenerate. Otherwise a
	// single insert could collide with a duplicate/empty key elsewhere, so we
	// rebalance the whole group instead.
	if (groupIsHealthy(ordered) && !keysAreDegenerate(before, after)) {
		try {
			const newKey = sortKeyBetween(before, after);
			if (newKey === ordered[oldIndex].sort_order) return [];
			return [{ id: movingId, sort_order: newKey }];
		} catch {
			// fall through to rebalance
		}
	}

	// Degenerate / failed: rebalance the whole group in the intended order.
	const finalOrder = without.slice();
	finalOrder.splice(clampedIndex, 0, ordered[oldIndex]);

	const freshKeys = generateInitialKeys(finalOrder.length);
	const writes: SortKeyAssignment[] = [];
	for (let i = 0; i < finalOrder.length; i++) {
		if (finalOrder[i].sort_order !== freshKeys[i]) {
			writes.push({ id: finalOrder[i].id, sort_order: freshKeys[i] });
		}
	}
	return writes;
}
