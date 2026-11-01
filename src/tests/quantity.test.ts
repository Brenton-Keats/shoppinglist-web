import { describe, it, expect } from 'vitest';
import {
	MIN_QUANTITY,
	effectiveQuantity,
	clampQuantity,
	adjustQuantity
} from '$lib/utils/quantity';

/**
 * Pure quantity clamp/adjust logic backing the per-list-item quantity feature.
 * The store's setItemQuantity/adjustItemQuantity delegate to these, so the
 * locked product rules (floor at 1, integer only, null-as-1, decrement-at-1 is
 * a no-op) are verified here against the pure functions.
 */
describe('quantity helpers', () => {
	it('MIN_QUANTITY is 1', () => {
		expect(MIN_QUANTITY).toBe(1);
	});

	describe('effectiveQuantity (null treated as 1)', () => {
		it('treats null as 1', () => {
			expect(effectiveQuantity(null)).toBe(1);
		});

		it('treats undefined as 1', () => {
			expect(effectiveQuantity(undefined)).toBe(1);
		});

		it('passes through a valid value', () => {
			expect(effectiveQuantity(3)).toBe(3);
		});

		it('floors a stored value below 1 up to 1', () => {
			expect(effectiveQuantity(0)).toBe(1);
			expect(effectiveQuantity(-5)).toBe(1);
		});

		it('floors fractional stored values to integers', () => {
			expect(effectiveQuantity(2.9)).toBe(2);
		});
	});

	describe('clampQuantity (floor at 1, integer only)', () => {
		it('floors at 1', () => {
			expect(clampQuantity(1)).toBe(1);
			expect(clampQuantity(0)).toBe(1);
			expect(clampQuantity(-10)).toBe(1);
		});

		it('keeps positive integers', () => {
			expect(clampQuantity(5)).toBe(5);
		});

		it('truncates fractions (integer only)', () => {
			expect(clampQuantity(3.7)).toBe(3);
		});

		it('falls back to the minimum for NaN', () => {
			expect(clampQuantity(NaN)).toBe(1);
		});
	});

	describe('adjustQuantity (delta from current, null-as-1, floor)', () => {
		it('incrementing raises by 1', () => {
			expect(adjustQuantity(2, 1)).toBe(3);
		});

		it('incrementing from null (treated as 1) yields 2', () => {
			expect(adjustQuantity(null, 1)).toBe(2);
		});

		it('decrementing at 1 stays at 1 (floor, no-op)', () => {
			expect(adjustQuantity(1, -1)).toBe(1);
		});

		it('decrementing at null (treated as 1) stays at 1', () => {
			expect(adjustQuantity(null, -1)).toBe(1);
		});

		it('decrementing from 3 yields 2', () => {
			expect(adjustQuantity(3, -1)).toBe(2);
		});

		it('never goes below 1 for a large negative delta', () => {
			expect(adjustQuantity(2, -100)).toBe(1);
		});
	});
});
