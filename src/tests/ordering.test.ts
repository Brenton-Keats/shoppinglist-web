import { describe, expect, it } from 'vitest';
import {
	sortKeyAfter,
	sortKeyBefore,
	sortKeyBetween,
	sortKeysBetween,
	generateInitialKeys,
	compareSortKeys,
	keysAreDegenerate,
	planReorder
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

	describe('keysAreDegenerate', () => {
		it('flags two equal non-null keys (would throw a0 >= a0)', () => {
			expect(keysAreDegenerate('a0', 'a0')).toBe(true);
		});

		it('flags non-increasing neighbours (before > after)', () => {
			expect(keysAreDegenerate('a1', 'a0')).toBe(true);
		});

		it('does not flag a valid strictly-increasing pair', () => {
			expect(keysAreDegenerate('a0', 'a1')).toBe(false);
		});

		it('does not flag empty/null neighbours (they collapse to null)', () => {
			expect(keysAreDegenerate('', '')).toBe(false);
			expect(keysAreDegenerate(null, null)).toBe(false);
			expect(keysAreDegenerate('a0', null)).toBe(false);
			expect(keysAreDegenerate(null, 'a0')).toBe(false);
		});
	});

	describe('planReorder', () => {
		it('moves a single row with one write in the happy path', () => {
			const ordered = [
				{ id: 'x', sort_order: 'a0' },
				{ id: 'y', sort_order: 'a1' },
				{ id: 'z', sort_order: 'a2' }
			];
			// Move z up one (to index 1).
			const writes = planReorder(ordered, 'z', 1);
			expect(writes).toHaveLength(1);
			expect(writes[0].id).toBe('z');
			expect('a0' < writes[0].sort_order).toBe(true);
			expect(writes[0].sort_order < 'a1').toBe(true);
		});

		it('returns no writes for a true no-op move', () => {
			const ordered = [
				{ id: 'x', sort_order: 'a0' },
				{ id: 'y', sort_order: 'a1' }
			];
			// Moving y to its own index is a no-op.
			expect(planReorder(ordered, 'y', 1)).toEqual([]);
		});

		it('REBALANCES a degenerate all-"a0" group instead of throwing, and reorders correctly', () => {
			const ordered = [
				{ id: 'x', sort_order: 'a0' },
				{ id: 'y', sort_order: 'a0' },
				{ id: 'z', sort_order: 'a0' }
			];
			// Move z up to the front (index 0). All neighbours are "a0" → degenerate.
			let writes: ReturnType<typeof planReorder> = [];
			expect(() => {
				writes = planReorder(ordered, 'z', 0);
			}).not.toThrow();

			// A rebalance rewrites the whole group with distinct, ordered keys.
			expect(writes.length).toBeGreaterThan(0);

			// Apply the writes and confirm the intended final order: z, x, y.
			const byId = new Map(ordered.map((e) => [e.id, { ...e }]));
			for (const w of writes) byId.get(w.id)!.sort_order = w.sort_order;
			const finalOrder = [...byId.values()].sort((a, b) =>
				compareSortKeys(a.sort_order, b.sort_order)
			);
			expect(finalOrder.map((e) => e.id)).toEqual(['z', 'x', 'y']);
			// Keys are strictly increasing and distinct.
			const keys = finalOrder.map((e) => e.sort_order);
			expect(new Set(keys).size).toBe(keys.length);
			expect([...keys].sort()).toEqual(keys);
		});

		// Lazy self-healing: the user chose Part 1 (shared comparator) over a
		// migration BECAUSE a normal reorder already heals a degenerate group. The
		// within-section reorder path (`applyProductReorder` in src/routes/+page.svelte)
		// drives `planReorder` over the sorted group; when that group is degenerate
		// (duplicate/legacy `a0` keys) planReorder rebalances it to clean, distinct,
		// strictly-increasing keys, and every changed row is written (and recorded
		// for sync via updateProduct/updateListItem → recordChange). This test proves
		// the rebalance is genuinely reached for a degenerate LIST-ITEM group of the
		// §3 aged-data shape (mix of duplicate `a0` and real keys).
		it('lazy-heals a degenerate LIST-ITEM group on a normal reorder (distinct keys written)', () => {
			// Aged list-item group for one section: i1=a0, i2=a0 (duplicate), i3=a1,
			// i4=a2, i5=a3 — already sorted by compareSortKeys with an id tiebreak as
			// the reorder path supplies it.
			const ordered = [
				{ id: 'i1', sort_order: 'a0' },
				{ id: 'i2', sort_order: 'a0' },
				{ id: 'i3', sort_order: 'a1' },
				{ id: 'i4', sort_order: 'a2' },
				{ id: 'i5', sort_order: 'a3' }
			];
			// User moves i5 to position 2 (index 1) — the reported scenario.
			const writes = planReorder(ordered, 'i5', 1);

			// Because the group is degenerate (i1/i2 share `a0`), planReorder must
			// rebalance the WHOLE group rather than attempt a single colliding insert.
			expect(writes.length).toBeGreaterThan(0);

			const byId = new Map(ordered.map((e) => [e.id, { ...e }]));
			for (const w of writes) byId.get(w.id)!.sort_order = w.sort_order;
			const finalOrder = [...byId.values()].sort((a, b) =>
				compareSortKeys(a.sort_order, b.sort_order)
			);

			// Intended order after moving i5 to position 2: i1, i5, i2, i3, i4.
			expect(finalOrder.map((e) => e.id)).toEqual(['i1', 'i5', 'i2', 'i3', 'i4']);

			// The healed keys are clean: distinct, non-empty, strictly increasing.
			const keys = finalOrder.map((e) => e.sort_order);
			expect(new Set(keys).size).toBe(keys.length);
			expect(keys.every((k) => k.length > 0)).toBe(true);
			expect([...keys].sort()).toEqual(keys);
		});

		it('REBALANCES a degenerate all-empty-key group instead of no-oping', () => {
			const ordered = [
				{ id: 'x', sort_order: '' },
				{ id: 'y', sort_order: '' },
				{ id: 'z', sort_order: '' }
			];
			// Move x down to the end (index 2).
			let writes: ReturnType<typeof planReorder> = [];
			expect(() => {
				writes = planReorder(ordered, 'x', 2);
			}).not.toThrow();
			expect(writes.length).toBeGreaterThan(0);

			const byId = new Map(ordered.map((e) => [e.id, { ...e }]));
			for (const w of writes) byId.get(w.id)!.sort_order = w.sort_order;
			const finalOrder = [...byId.values()].sort((a, b) =>
				compareSortKeys(a.sort_order, b.sort_order)
			);
			// Intended final order after moving x to the end: y, z, x.
			expect(finalOrder.map((e) => e.id)).toEqual(['y', 'z', 'x']);
			const keys = finalOrder.map((e) => e.sort_order);
			expect(new Set(keys).size).toBe(keys.length);
			expect(keys.every((k) => k.length > 0)).toBe(true);
		});
	});
});
