import { describe, expect, it } from 'vitest';
import {
	sortKeyAfter,
	sortKeyBefore,
	sortKeyBetween,
	sortKeysBetween,
	generateInitialKeys,
	compareSortKeys
} from '$lib/utils/ordering';

describe('fractional-indexing sort keys', () => {
	describe('key generation', () => {
		it('first key is alphanumeric and appends predictably', () => {
			const first = sortKeyAfter(null);
			expect(first).toBe('a0');
			expect(first).toMatch(/^[0-9A-Za-z]+$/);
			expect(sortKeyAfter('a0')).toBe('a1');
		});

		it('prepends before an existing key', () => {
			const before = sortKeyBefore('a0');
			expect(before < 'a0').toBe(true);
			expect(before).toMatch(/^[0-9A-Za-z]+$/);
		});

		it('inserts roughly half-way between two adjacent keys', () => {
			const mid = sortKeyBetween('a0', 'a1');
			expect(mid > 'a0').toBe(true);
			expect(mid < 'a1').toBe(true);
			expect(mid).toMatch(/^[0-9A-Za-z]+$/);
		});

		it('favours a shorter key when a gap exists between neighbours', () => {
			// Between a0 and a2 there is room for the single-char-tier key a1,
			// so the generator should pick it rather than lengthening the key.
			expect(sortKeyBetween('a0', 'a2')).toBe('a1');
		});

		it('generates N evenly spaced ordered keys', () => {
			const keys = generateInitialKeys(5);
			expect(keys).toHaveLength(5);
			const sorted = [...keys].sort();
			expect(keys).toEqual(sorted); // already in ascending order
			expect(new Set(keys).size).toBe(5); // all distinct
		});

		it('generates N keys between two bounds, all strictly ordered', () => {
			const keys = sortKeysBetween('a0', 'a1', 3);
			expect(keys).toHaveLength(3);
			expect('a0' < keys[0]).toBe(true);
			expect(keys[0] < keys[1]).toBe(true);
			expect(keys[1] < keys[2]).toBe(true);
			expect(keys[2] < 'a1').toBe(true);
		});

		it('treats empty/undefined neighbours as null (first key)', () => {
			// Empty strings are not valid keys; they collapse to null, so a between
			// with both "empty" neighbours is just the first key.
			expect(sortKeyBetween('', undefined)).toBe('a0');
		});
	});

	describe('compareSortKeys', () => {
		it('orders string keys lexicographically', () => {
			const input = ['a2', 'a0', 'a1', 'a0V'];
			const sorted = [...input].sort(compareSortKeys);
			expect(sorted).toEqual(['a0', 'a0V', 'a1', 'a2']);
		});

		it('sorts null/empty/undefined last, real keys first', () => {
			const input = ['a1', null, 'a0', undefined, ''];
			const sorted = [...input].sort(compareSortKeys);
			// Real keys lead in order; the three "empty" values trail (in any order).
			expect(sorted.slice(0, 2)).toEqual(['a0', 'a1']);
			expect(sorted.slice(2).every((v) => v === null || v === undefined || v === '')).toBe(true);
		});

		it('is a stable, total order usable by Array.sort', () => {
			const keys = generateInitialKeys(10);
			const shuffled = [...keys].reverse();
			const resorted = [...shuffled].sort(compareSortKeys);
			expect(resorted).toEqual(keys);
		});
	});

	describe('repeated insertion between neighbours stays ordered', () => {
		it('keeps a correct total order after many midpoint insertions', () => {
			// Simulate dragging an item repeatedly into the same gap.
			let lo = 'a0';
			const hi = 'a1';
			const inserted: string[] = [];
			for (let i = 0; i < 20; i++) {
				const key = sortKeyBetween(lo, hi);
				expect(lo < key).toBe(true);
				expect(key < hi).toBe(true);
				inserted.push(key);
				lo = key;
			}
			// Every generated key is strictly ordered and distinct.
			const sorted = [...inserted].sort(compareSortKeys);
			expect(inserted).toEqual(sorted);
			expect(new Set(inserted).size).toBe(inserted.length);
		});
	});
});
