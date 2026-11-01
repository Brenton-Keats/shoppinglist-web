/**
 * List-item quantity helpers.
 *
 * Quantity is a positive integer stored per `ListItem`. A stored value of
 * `null` means "never set" and is TREATED AS 1 at read time (no data
 * migration). The floor is 1 — quantity can never drop below 1 and adjusting
 * down at 1 is a no-op.
 */

/** The minimum (and default) quantity for any list item. */
export const MIN_QUANTITY = 1;

/**
 * Resolve the effective quantity for display/adjustment. A `null` (unset)
 * quantity reads as 1; any stored value is floored to a positive integer.
 */
export function effectiveQuantity(quantity: number | null | undefined): number {
	if (quantity == null) return MIN_QUANTITY;
	return clampQuantity(quantity);
}

/**
 * Clamp an arbitrary number to a valid quantity: a positive integer floored at
 * MIN_QUANTITY (1). Non-finite values fall back to the minimum.
 */
export function clampQuantity(quantity: number): number {
	if (!Number.isFinite(quantity)) return MIN_QUANTITY;
	return Math.max(MIN_QUANTITY, Math.floor(quantity));
}

/**
 * Apply a delta to the current (possibly null) quantity, treating null as 1 and
 * clamping the result to the floor. Decrementing at 1 yields 1 (no-op).
 */
export function adjustQuantity(current: number | null | undefined, delta: number): number {
	return clampQuantity(effectiveQuantity(current) + delta);
}
