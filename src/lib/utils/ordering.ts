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
